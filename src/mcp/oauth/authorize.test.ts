import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OAuthClient } from '../../core/oauth/clients.ts';
import { challengeFor } from '../../core/oauth/pkce.ts';
import { authorizeRoute, parseScopes } from './authorize.ts';
import type { ClientResolver } from './cimd.ts';
import {
  CALLBACK,
  CHALLENGE,
  CLIENT_ID,
  fakeProvider,
  fakeSessions,
  NOW,
  noRedirect,
  ORIGIN,
  request,
  type Serving,
  serving,
} from './fixtures.ts';

const client: OAuthClient = {
  clientId: CLIENT_ID,
  name: 'Example Client',
  redirectUris: [CALLBACK, 'http://127.0.0.1/cb'],
  kind: 'cimd',
};

const resolver: ClientResolver = {
  resolve: async (clientId) =>
    clientId === CLIENT_ID
      ? { kind: 'ok', client }
      : {
          kind: 'refused',
          reason: 'unknown_client',
          description: 'The client id is not registered.',
        },
};

const GOOD = {
  response_type: 'code',
  client_id: CLIENT_ID,
  redirect_uri: CALLBACK,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'client-state',
  scope: 'memory:read memory:write',
  resource: `${ORIGIN}/mcp`,
};

function query(overrides: Record<string, string | undefined> = {}): string {
  const merged = Object.entries({ ...GOOD, ...overrides }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );

  return new URLSearchParams(merged).toString();
}

const servers: Serving[] = [];

const provider = () =>
  fakeProvider({ kind: 'refused', reason: 'exchange', description: 'unused here' });

async function harness() {
  const sessions = fakeSessions();
  const telegram = provider();

  const server = await serving([
    authorizeRoute({ origin: ORIGIN, resolver, sessions, provider: telegram, now: () => NOW }),
  ]);

  servers.push(server);

  return {
    sessions,
    telegram,
    get: (search: string) => noRedirect(`${server.base}/oauth/authorize?${search}`),
  };
}

const capture = (stream: 'stdout' | 'stderr') =>
  vi.spyOn(process[stream], 'write').mockImplementation(() => true);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('parseScopes', () => {
  it('returns the known scopes in declared order, once each, or all when empty', () => {
    expect(parseScopes('memory:write memory:read memory:write')).toEqual([
      'memory:read',
      'memory:write',
    ]);

    expect(parseScopes(null)).toEqual(['memory:read', 'memory:write', 'memory:delete']);
    expect(parseScopes('  ')).toEqual(['memory:read', 'memory:write', 'memory:delete']);
  });

  it('is undefined when any scope is unknown', () => {
    expect(parseScopes('memory:read admin')).toBeUndefined();
    expect(parseScopes('MEMORY:READ')).toBeUndefined();
  });
});

describe('a valid request', () => {
  it('stores the session, sets the cookie and sends the browser to Telegram', async () => {
    const stdout = capture('stdout');
    const h = await harness();
    const response = await h.get(query());

    expect(response.status).toBe(302);

    const [row] = [...h.sessions.rows.values()];

    expect(row).toBeDefined();

    expect(row?.request).toEqual(request({ scopes: ['memory:read', 'memory:write'] }));
    expect(row?.expiresAt).toEqual(new Date(NOW.getTime() + 600_000));
    expect(row?.state).toHaveLength(43);
    expect(row?.nonce).toHaveLength(43);
    expect(row?.codeVerifier).toHaveLength(43);

    expect(h.telegram.urls).toEqual([
      {
        redirectUri: `${ORIGIN}/oauth/callback`,
        state: row?.state,
        nonce: row?.nonce,
        codeChallenge: challengeFor(row?.codeVerifier ?? ''),
      },
    ]);

    expect(response.headers.get('location')).toBe(
      `https://oauth.telegram.org/auth?state=${row?.state ?? ''}`,
    );

    expect(response.headers.get('set-cookie')).toBe(
      `oauth_login=${row?.id ?? ''}; Max-Age=600; Path=/oauth; HttpOnly; Secure; SameSite=Lax`,
    );

    expect(response.headers.get('cache-control')).toBe('no-store');

    const record = JSON.parse(String(stdout.mock.calls[0]?.[0])) as Record<string, unknown>;

    expect(record).toMatchObject({ level: 'info', message: 'login started', clientId: CLIENT_ID });
  });

  it('grants every scope when none is asked for, and keeps an absent state absent', async () => {
    capture('stdout');

    const h = await harness();

    expect((await h.get(query({ scope: undefined, state: undefined }))).status).toBe(302);

    const [row] = [...h.sessions.rows.values()];

    expect(row?.request.scopes).toEqual(['memory:read', 'memory:write', 'memory:delete']);
    expect(row?.request.state).toBe('');
  });

  it('accepts a loopback redirect URI on any port', async () => {
    capture('stdout');

    const h = await harness();

    const response = await h.get(query({ redirect_uri: 'http://127.0.0.1:51234/cb' }));

    expect(response.status).toBe(302);
    expect([...h.sessions.rows.values()][0]?.request.redirectUri).toBe('http://127.0.0.1:51234/cb');
  });
});

describe('before the client is trusted', () => {
  const page = async (search: string) => {
    const h = await harness();
    const response = await h.get(search);

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('location')).toBeNull();
    expect(h.sessions.rows.size).toBe(0);
    expect(h.telegram.urls).toEqual([]);

    return response.text();
  };

  it('answers a page for a missing or unknown client', async () => {
    capture('stderr');

    expect(await page(query({ client_id: undefined }))).toContain('client_id parameter is missing');

    expect(await page(query({ client_id: 'nobody' }))).toContain(
      'The client id is not registered.',
    );
  });

  it('answers a page for a redirect URI the client did not register', async () => {
    expect(await page(query({ redirect_uri: undefined }))).toContain('Invalid redirect URI');

    expect(await page(query({ redirect_uri: 'https://evil.example/cb' }))).toContain(
      'Invalid redirect URI',
    );

    expect(await page(query({ redirect_uri: `${CALLBACK}?x=1` }))).toContain(
      'Invalid redirect URI',
    );
  });

  it('answers a page when a parameter is given twice', async () => {
    expect(await page(`${query()}&redirect_uri=https://evil.example/cb`)).toContain(
      'redirect_uri is given more than once',
    );
  });
});

describe('after the client is trusted', () => {
  const sentBack = async (search: string) => {
    const h = await harness();
    const response = await h.get(search);

    expect(response.status).toBe(302);
    expect(h.sessions.rows.size).toBe(0);

    const location = new URL(response.headers.get('location') ?? '');

    expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);

    return Object.fromEntries(location.searchParams);
  };

  it('sends unsupported_response_type back with the state', async () => {
    expect(await sentBack(query({ response_type: 'token' }))).toEqual({
      error: 'unsupported_response_type',
      error_description: 'Only response_type=code is supported.',
      state: 'client-state',
    });

    expect(await sentBack(query({ response_type: undefined }))).toMatchObject({
      error: 'unsupported_response_type',
    });
  });

  it('sends invalid_request for a missing, short or plain challenge', async () => {
    expect(await sentBack(query({ code_challenge_method: 'plain' }))).toMatchObject({
      error: 'invalid_request',
    });

    expect(await sentBack(query({ code_challenge_method: undefined }))).toMatchObject({
      error: 'invalid_request',
    });

    expect(await sentBack(query({ code_challenge: 'short' }))).toMatchObject({
      error: 'invalid_request',
    });

    expect(await sentBack(query({ code_challenge: undefined }))).toMatchObject({
      error: 'invalid_request',
    });
  });

  it('sends invalid_target for any resource but this server', async () => {
    expect(await sentBack(query({ resource: 'https://other.example/mcp' }))).toMatchObject({
      error: 'invalid_target',
      error_description: `The resource must be ${ORIGIN}/mcp.`,
    });

    expect(await sentBack(query({ resource: undefined }))).toMatchObject({
      error: 'invalid_target',
    });
  });

  it('sends invalid_scope for an unknown scope, without a state when none came', async () => {
    expect(await sentBack(query({ scope: 'memory:read admin', state: undefined }))).toEqual({
      error: 'invalid_scope',
      error_description: 'The scopes supported are memory:read, memory:write, memory:delete.',
    });
  });
});
