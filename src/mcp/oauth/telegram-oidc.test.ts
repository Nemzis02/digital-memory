import { generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_ID,
  NOW,
  ORIGIN,
  PROVIDER_NONCE,
  type TestKeys,
  testKeys,
  VERIFIER,
} from './fixtures.ts';
import {
  createTelegramOidc,
  isAdmin,
  type LoginOutcome,
  oidcClientId,
  TELEGRAM_ISSUER,
  TELEGRAM_TOKEN_URL,
} from './telegram-oidc.ts';

const CLIENT = '123456789';
const SUB = '1234123412341234123';
const REDIRECT = `${ORIGIN}/oauth/callback`;
const SECONDS = Math.floor(NOW.getTime() / 1000);

let keys: TestKeys;

beforeAll(async () => {
  keys = await testKeys();
});

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: TELEGRAM_ISSUER,
    aud: CLIENT,
    sub: SUB,
    id: ADMIN_ID,
    name: 'Kirill',
    preferred_username: 'kirill',
    iat: SECONDS,
    exp: SECONDS + 3600,
    nonce: PROVIDER_NONCE,
    ...overrides,
  };
}

const tokenResponse = (idToken: unknown, status = 200): Response =>
  new Response(
    JSON.stringify({
      access_token: 'opaque',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );

function provider(fetchImpl: typeof fetch, now: () => Date = () => NOW) {
  return createTelegramOidc({
    clientId: CLIENT,
    clientSecret: 'the-secret',
    jwks: keys.jwks,
    fetch: fetchImpl,
    now,
  });
}

const input = {
  code: 'the-code',
  codeVerifier: VERIFIER,
  redirectUri: REDIRECT,
  nonce: PROVIDER_NONCE,
};

async function loginWith(
  payload: Record<string, unknown>,
  header?: Parameters<TestKeys['sign']>[1],
) {
  const idToken = await keys.sign(payload, header);

  return provider(async () => tokenResponse(idToken)).login(input);
}

const refusal = (outcome: LoginOutcome) =>
  outcome.kind === 'refused' ? outcome.reason : undefined;

const capture = (stream: 'stdout' | 'stderr') =>
  vi.spyOn(process[stream], 'write').mockImplementation(() => true);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('oidcClientId', () => {
  it('is the numeric prefix of the bot token', () => {
    expect(oidcClientId('123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe('123456789');
    expect(oidcClientId('')).toBe('');
  });
});

describe('isAdmin', () => {
  it('is true only for the exact numeric id', () => {
    expect(isAdmin({ sub: SUB, id: ADMIN_ID }, ADMIN_ID)).toBe(true);
    expect(isAdmin({ sub: SUB, id: ADMIN_ID + 1 }, ADMIN_ID)).toBe(false);
    expect(isAdmin({ sub: String(ADMIN_ID), id: 42 }, ADMIN_ID)).toBe(false);
  });
});

describe('loginUrl', () => {
  it('points at the Telegram authorization endpoint with every parameter', () => {
    const url = new URL(
      provider(fetch).loginUrl({
        redirectUri: REDIRECT,
        state: 'st',
        nonce: 'no',
        codeChallenge: 'ch',
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe('https://oauth.telegram.org/auth');

    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid profile',
      state: 'st',
      nonce: 'no',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });
});

describe('login', () => {
  it('posts the code with Basic auth and returns the claims of a good ID token', async () => {
    const idToken = await keys.sign(claims());
    const fetchFake = vi.fn<typeof fetch>(async () => tokenResponse(idToken));
    const outcome = await provider(fetchFake).login(input);

    expect(outcome).toEqual({
      kind: 'ok',
      claims: { sub: SUB, id: ADMIN_ID, name: 'Kirill', username: 'kirill' },
    });

    const [target, init] = fetchFake.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;

    expect(target).toBe(TELEGRAM_TOKEN_URL);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(headers.authorization).toBe(`Basic ${btoa(`${CLIENT}:the-secret`)}`);
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');

    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      code_verifier: VERIFIER,
    });
  });

  it('omits the name and username keys when the token has none', async () => {
    const outcome = await loginWith(claims({ name: undefined, preferred_username: 7 }));

    expect(outcome.kind === 'ok' && outcome.claims).toEqual({ sub: SUB, id: ADMIN_ID });
  });

  it('refuses a token endpoint that fails, answers non-200, or sends no id_token', async () => {
    capture('stderr');

    const failing = provider(async () => {
      throw new TypeError('fetch failed');
    });

    expect(refusal(await failing.login(input))).toBe('exchange');

    expect(refusal(await provider(async () => tokenResponse('x', 400)).login(input))).toBe(
      'exchange',
    );

    expect(refusal(await provider(async () => tokenResponse(undefined)).login(input))).toBe(
      'exchange',
    );

    expect(refusal(await provider(async () => tokenResponse('')).login(input))).toBe('exchange');

    const notJson = provider(async () => new Response('<html>', { status: 200 }));

    expect(refusal(await notJson.login(input))).toBe('exchange');
  });

  it('gives up on the token endpoint after 5 seconds', async () => {
    capture('stderr');
    vi.useFakeTimers();

    const slow = provider(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        }),
    );

    const pending = slow.login(input);

    await vi.advanceTimersByTimeAsync(5_000);

    const outcome = await pending;

    expect(outcome).toMatchObject({ kind: 'refused', reason: 'exchange' });
    expect(outcome.kind === 'refused' && outcome.description).toContain('ran out of time');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a token signed by another key, or with a wrong iss, aud, exp or nonce', async () => {
    capture('stderr');

    const other = await generateKeyPair('RS256');

    expect(refusal(await loginWith(claims(), { key: other.privateKey }))).toBe('token');
    expect(refusal(await loginWith(claims({ iss: 'https://evil.example' })))).toBe('token');
    expect(refusal(await loginWith(claims({ aud: '987654321' })))).toBe('token');
    expect(refusal(await loginWith(claims({ exp: SECONDS - 1 })))).toBe('token');
    expect(refusal(await loginWith(claims({ nonce: 'another' })))).toBe('token');
  });

  it('accepts a token without a nonce claim and warns about it', async () => {
    const stderr = capture('stderr');
    const outcome = await loginWith(claims({ nonce: undefined }));

    expect(outcome.kind).toBe('ok');

    const record = JSON.parse(String(stderr.mock.calls[0]?.[0])) as Record<string, unknown>;

    expect(record).toMatchObject({ level: 'warn', message: 'telegram id token carries no nonce' });
  });

  it('refuses a token without a numeric id claim', async () => {
    capture('stderr');

    expect(refusal(await loginWith(claims({ id: undefined })))).toBe('token');
    expect(refusal(await loginWith(claims({ id: String(ADMIN_ID) })))).toBe('token');
    expect(refusal(await loginWith(claims({ id: 1.5 })))).toBe('token');
    expect(refusal(await loginWith(claims({ sub: undefined })))).toBe('token');
  });

  it('never writes the ID token or the secret into a log line', async () => {
    const stderr = capture('stderr');
    const idToken = await keys.sign(claims({ aud: 'wrong' }));

    await provider(async () => tokenResponse(idToken)).login(input);

    const lines = stderr.mock.calls.map((call) => String(call[0]));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"reason":"token"');
    expect(lines[0]).not.toContain(idToken);
    expect(lines[0]).not.toContain('the-secret');
  });
});
