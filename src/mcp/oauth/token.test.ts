import type { UUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationCode } from '../../core/oauth/codes.ts';
import type {
  IssuedTokens,
  RefreshOutcome,
  RefreshRequest,
  TokenGrant,
} from '../../core/oauth/tokens.ts';
import {
  CALLBACK,
  CHALLENGE,
  CLIENT_ID,
  NOW,
  ORIGIN,
  type Serving,
  serving,
  USER,
  VERIFIER,
} from './fixtures.ts';
import { tokenRoute } from './token.ts';

const FAMILY = '22222222-2222-4222-8222-222222222222' as UUID;

const RESOURCE = `${ORIGIN}/mcp`;

const CODE = 'minted-code';

const FORM = 'application/x-www-form-urlencoded';

function issuedTokens(scopes: string[] = ['memory:read', 'memory:write']): IssuedTokens {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: 3600,
    scopes,
    familyId: FAMILY,
    userId: USER,
  };
}

function codeRow(overrides: Partial<AuthorizationCode> = {}): AuthorizationCode {
  return {
    clientId: CLIENT_ID,
    userId: USER,
    redirectUri: CALLBACK,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    scopes: ['memory:read', 'memory:write'],
    resource: RESOURCE,
    expiresAt: new Date(NOW.getTime() + 600_000),
    ...overrides,
  };
}

function fakeCodes(rows: Map<string, AuthorizationCode>) {
  const consumed: string[] = [];

  return {
    consumed,
    consume(code: string) {
      consumed.push(code);

      const row = rows.get(code);

      rows.delete(code);

      return Promise.resolve(row);
    },
  };
}

function fakeTokens(outcome: RefreshOutcome) {
  const issued: TokenGrant[] = [];
  const refreshed: { token: string; request: RefreshRequest }[] = [];

  return {
    issued,
    refreshed,
    issue(grant: TokenGrant) {
      issued.push(grant);

      return Promise.resolve(issuedTokens([...grant.scopes]));
    },
    refresh(token: string, request: RefreshRequest) {
      refreshed.push({ token, request });

      return Promise.resolve(outcome);
    },
  };
}

const GOOD_CODE = {
  grant_type: 'authorization_code',
  code: CODE,
  client_id: CLIENT_ID,
  redirect_uri: CALLBACK,
  code_verifier: VERIFIER,
  resource: RESOURCE,
};

const GOOD_REFRESH = {
  grant_type: 'refresh_token',
  refresh_token: 'refresh-0',
  client_id: CLIENT_ID,
};

const servers: Serving[] = [];

interface HarnessOptions {
  code?: AuthorizationCode;
  refresh?: RefreshOutcome;
  now?: () => Date;
}

async function harness(options: HarnessOptions = {}) {
  const codes = fakeCodes(new Map([[CODE, options.code ?? codeRow()]]));
  const tokens = fakeTokens(options.refresh ?? { kind: 'issued', tokens: issuedTokens() });

  const server = await serving([
    tokenRoute({ origin: ORIGIN, codes, tokens, now: options.now ?? (() => NOW) }),
  ]);

  servers.push(server);

  const raw = (body: string, contentType: string = FORM) =>
    fetch(`${server.base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });

  const post = (body: Record<string, string | undefined>) => {
    const entries = Object.entries(body).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );

    return raw(new URLSearchParams(entries).toString());
  };

  return { codes, tokens, raw, post };
}

const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;

const capture = (stream: 'stdout' | 'stderr') =>
  vi.spyOn(process[stream], 'write').mockImplementation(() => true);

const lines = (write: ReturnType<typeof capture>) =>
  write.mock.calls.map(([chunk]) => JSON.parse(String(chunk)) as Record<string, unknown>);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('POST /oauth/token', () => {
  it('refuses a body that is not a form', async () => {
    const { raw } = await harness();
    const response = await raw(JSON.stringify(GOOD_CODE), 'application/json');

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await json(response)).toMatchObject({ error: 'invalid_request' });
  });

  it('refuses a body over the cap', async () => {
    const { raw, codes } = await harness();

    const response = await raw(
      `${new URLSearchParams(GOOD_CODE).toString()}&pad=${'x'.repeat(5000)}`,
    );

    expect(await json(response)).toMatchObject({ error: 'invalid_request' });
    expect(codes.consumed).toEqual([]);
  });

  it('refuses a parameter sent more than once', async () => {
    const { raw } = await harness();
    const response = await raw('grant_type=authorization_code&grant_type=refresh_token');

    expect(await json(response)).toEqual({
      error: 'invalid_request',
      error_description: 'The parameter grant_type is sent more than once.',
    });
  });

  it('refuses a missing or unknown grant type', async () => {
    const { post } = await harness();

    for (const grant_type of [undefined, 'password', '']) {
      const response = await post({ ...GOOD_CODE, grant_type });

      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ error: 'unsupported_grant_type' });
    }
  });
});

describe('authorization_code grant', () => {
  it('requires every parameter before touching the code', async () => {
    const { post, codes } = await harness();

    for (const name of ['code', 'client_id', 'redirect_uri', 'code_verifier', 'resource']) {
      const response = await post({ ...GOOD_CODE, [name]: undefined });

      expect(await json(response)).toEqual({
        error: 'invalid_request',
        error_description: `The parameter ${name} is required.`,
      });
    }

    expect(codes.consumed).toEqual([]);
  });

  it('refuses a malformed verifier and a foreign resource before touching the code', async () => {
    const { post, codes } = await harness();

    expect(await json(await post({ ...GOOD_CODE, code_verifier: 'short' }))).toMatchObject({
      error: 'invalid_request',
    });

    expect(await json(await post({ ...GOOD_CODE, resource: 'https://other.example/mcp' }))).toEqual(
      {
        error: 'invalid_target',
        error_description: `The resource must be ${RESOURCE}.`,
      },
    );

    expect(codes.consumed).toEqual([]);
  });

  it('answers invalid_grant for an unknown code', async () => {
    const { post, tokens } = await harness();
    const stderr = capture('stderr');
    const response = await post({ ...GOOD_CODE, code: 'nope' });

    expect(await json(response)).toMatchObject({ error: 'invalid_grant' });
    expect(tokens.issued).toEqual([]);

    expect(lines(stderr)).toContainEqual(
      expect.objectContaining({ message: 'code rejected', reason: 'unknown', clientId: CLIENT_ID }),
    );
  });

  it('burns the code on a client, redirect URI, expiry or verifier mismatch', async () => {
    const cases: { body?: Partial<typeof GOOD_CODE>; now?: () => Date; reason: string }[] = [
      { body: { client_id: 'https://other.example/client.json' }, reason: 'client' },
      { body: { redirect_uri: 'https://client.example/other' }, reason: 'redirect_uri' },
      { now: () => new Date(NOW.getTime() + 600_000), reason: 'expired' },
      { body: { code_verifier: 'a'.repeat(43) }, reason: 'verifier' },
    ];

    for (const { body, now, reason } of cases) {
      const { post, codes, tokens } = await harness(now === undefined ? {} : { now });
      const stderr = capture('stderr');
      const response = await post({ ...GOOD_CODE, ...body });

      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ error: 'invalid_grant' });
      expect(codes.consumed).toEqual([CODE]);
      expect(tokens.issued).toEqual([]);

      expect(lines(stderr)).toContainEqual(
        expect.objectContaining({ message: 'code rejected', reason }),
      );

      expect(await json(await post(GOOD_CODE))).toMatchObject({ error: 'invalid_grant' });
      stderr.mockRestore();
    }
  });

  it('issues a family and answers the token response once', async () => {
    const { post, tokens } = await harness();
    const stdout = capture('stdout');
    const response = await post(GOOD_CODE);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(await json(response)).toEqual({
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-1',
      scope: 'memory:read memory:write',
    });

    expect(tokens.issued).toEqual([
      {
        clientId: CLIENT_ID,
        userId: USER,
        scopes: ['memory:read', 'memory:write'],
        resource: RESOURCE,
      },
    ]);

    const logged = lines(stdout).find((line) => line.message === 'token issued');

    expect(logged).toMatchObject({ clientId: CLIENT_ID, familyId: FAMILY });
    expect(logged).toHaveProperty('userRef');
    expect(JSON.stringify(logged)).not.toMatch(/access-1|refresh-1|minted-code/);

    expect(await json(await post(GOOD_CODE))).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('refresh_token grant', () => {
  it('requires the refresh token and the client id', async () => {
    const { post, tokens } = await harness();

    for (const name of ['refresh_token', 'client_id']) {
      expect(await json(await post({ ...GOOD_REFRESH, [name]: undefined }))).toEqual({
        error: 'invalid_request',
        error_description: `The parameter ${name} is required.`,
      });
    }

    expect(tokens.refreshed).toEqual([]);
  });

  it('refuses a scope this server does not know', async () => {
    const { post, tokens } = await harness();
    const response = await post({ ...GOOD_REFRESH, scope: 'memory:read memory:admin' });

    expect(await json(response)).toMatchObject({ error: 'invalid_scope' });
    expect(tokens.refreshed).toEqual([]);
  });

  it('rotates the pair and passes a narrowed scope through', async () => {
    const { post, tokens } = await harness({
      refresh: { kind: 'issued', tokens: issuedTokens(['memory:read']) },
    });

    const stdout = capture('stdout');
    const response = await post({ ...GOOD_REFRESH, scope: 'memory:read' });

    expect(response.status).toBe(200);

    expect(await json(response)).toMatchObject({
      scope: 'memory:read',
      refresh_token: 'refresh-1',
    });

    expect(tokens.refreshed).toEqual([
      { token: 'refresh-0', request: { clientId: CLIENT_ID, scopes: ['memory:read'] } },
    ]);

    const logged = lines(stdout).find((line) => line.message === 'token refreshed');

    expect(logged).toMatchObject({
      clientId: CLIENT_ID,
      familyId: FAMILY,
      scopes: ['memory:read'],
    });

    expect(JSON.stringify(logged)).not.toMatch(/refresh-0|refresh-1|access-1/);
  });

  it('passes no scope when the parameter is absent or empty', async () => {
    const { post, tokens } = await harness();

    await post(GOOD_REFRESH);
    await post({ ...GOOD_REFRESH, scope: '' });

    expect(tokens.refreshed.map(({ request }) => request)).toEqual([
      { clientId: CLIENT_ID },
      { clientId: CLIENT_ID },
    ]);
  });

  it('answers invalid_grant for a rejected token', async () => {
    const { post } = await harness({ refresh: { kind: 'rejected' } });
    const stderr = capture('stderr');

    expect(await json(await post(GOOD_REFRESH))).toEqual({
      error: 'invalid_grant',
      error_description: 'The refresh token is not valid.',
    });

    expect(lines(stderr)).toContainEqual(
      expect.objectContaining({ message: 'refresh rejected', clientId: CLIENT_ID }),
    );
  });

  it('answers invalid_grant and logs the revoked family on reuse', async () => {
    const { post } = await harness({ refresh: { kind: 'reused', familyId: FAMILY, userId: USER } });
    const stdout = capture('stdout');

    expect(await json(await post(GOOD_REFRESH))).toEqual({
      error: 'invalid_grant',
      error_description: 'The refresh token was already used.',
    });

    expect(lines(stdout)).toContainEqual(
      expect.objectContaining({
        message: 'family revoked',
        clientId: CLIENT_ID,
        familyId: FAMILY,
      }),
    );

    expect(lines(stdout).find((line) => line.message === 'family revoked')).toHaveProperty(
      'userRef',
    );
  });

  it('answers invalid_scope when the store refuses the narrowing', async () => {
    const { post } = await harness({
      refresh: { kind: 'invalid_scope', granted: ['memory:read'] },
    });

    expect(await json(await post({ ...GOOD_REFRESH, scope: 'memory:write' }))).toMatchObject({
      error: 'invalid_scope',
    });
  });
});
