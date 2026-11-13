import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashSecret } from '../../core/oauth/secret.ts';
import { callbackRoute } from './callback.ts';
import {
  ADMIN_ID,
  CALLBACK,
  cookieFor,
  fakeProvider,
  fakeSessions,
  ORIGIN,
  PROVIDER_NONCE,
  PROVIDER_STATE,
  type FakeSessions,
  type Serving,
  serving,
  startSession,
  noRedirect,
  VERIFIER,
} from './fixtures.ts';
import type { LoginOutcome } from './telegram-oidc.ts';

const ADMIN: LoginOutcome = {
  kind: 'ok',
  claims: { sub: 'opaque-subject', id: ADMIN_ID, name: 'Kirill' },
};

const servers: Serving[] = [];

async function harness(outcome: LoginOutcome = ADMIN, sessions: FakeSessions = fakeSessions()) {
  const provider = fakeProvider(outcome);

  const server = await serving([
    callbackRoute({ origin: ORIGIN, sessions, provider, adminId: ADMIN_ID }),
  ]);

  servers.push(server);

  const get = (search: string, cookie?: string) =>
    noRedirect(`${server.base}/oauth/callback?${search}`, {
      headers: cookie === undefined ? {} : { cookie },
    });

  return { sessions, provider, get };
}

const fromTelegram = (overrides: Record<string, string> = {}) =>
  new URLSearchParams({ code: 'the-code', state: PROVIDER_STATE, ...overrides }).toString();

const CLEARED = 'oauth_login=; Max-Age=0; Path=/oauth; HttpOnly; Secure; SameSite=Lax';

const capture = (stream: 'stdout' | 'stderr') =>
  vi.spyOn(process[stream], 'write').mockImplementation(() => true);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('without a live session', () => {
  it('answers a page and clears the cookie', async () => {
    const h = await harness();
    const missing = await h.get(fromTelegram());

    expect(missing.status).toBe(400);
    expect(missing.headers.get('set-cookie')).toBe(CLEARED);
    expect(await missing.text()).toContain('Login expired');

    const unknown = await h.get(fromTelegram(), cookieFor('11111111-1111-4111-8111-111111111111'));

    expect(unknown.status).toBe(400);
    expect(h.provider.logins).toEqual([]);
  });

  it('treats an expired session as missing', async () => {
    const h = await harness();
    const id = await startSession(h.sessions, { expiresAt: new Date(Date.now() - 1000) });

    expect((await h.get(fromTelegram(), cookieFor(id))).status).toBe(400);
  });
});

describe('with a bad answer from Telegram', () => {
  it('drops the session on a state mismatch without touching the client', async () => {
    const h = await harness();
    const id = await startSession(h.sessions);
    const response = await h.get(fromTelegram({ state: 'forged' }), cookieFor(id));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('does not belong to this session');
    expect(h.sessions.rows.has(id)).toBe(false);
    expect(h.provider.logins).toEqual([]);
  });

  it('sends access_denied to the client when the login was cancelled or brought no code', async () => {
    capture('stdout');

    const h = await harness();

    for (const search of [
      fromTelegram({ error: 'access_denied', code: '' }),
      new URLSearchParams({ state: PROVIDER_STATE }).toString(),
    ]) {
      const id = await startSession(h.sessions);
      const response = await h.get(search, cookieFor(id));
      const location = new URL(response.headers.get('location') ?? '');

      expect(response.status).toBe(302);
      expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);

      expect(Object.fromEntries(location.searchParams)).toEqual({
        error: 'access_denied',
        error_description: 'The Telegram login was not completed.',
        state: 'client-state',
      });

      expect(response.headers.get('set-cookie')).toBe(CLEARED);
      expect(h.sessions.rows.has(id)).toBe(false);
    }

    expect(h.provider.logins).toEqual([]);
  });

  it('sends server_error to the client when the exchange or the token is refused', async () => {
    const h = await harness({
      kind: 'refused',
      reason: 'token',
      description: 'The ID token did not verify: bad.',
    });

    const id = await startSession(h.sessions, { request: { state: '' } });
    const response = await h.get(fromTelegram(), cookieFor(id));
    const location = new URL(response.headers.get('location') ?? '');

    expect(response.status).toBe(302);

    expect(Object.fromEntries(location.searchParams)).toEqual({
      error: 'server_error',
      error_description: 'The ID token did not verify: bad.',
    });

    expect(h.sessions.rows.has(id)).toBe(false);
  });
});

describe('with another Telegram account', () => {
  it('shows the fixed refusal page, stores nothing and logs only a hash prefix', async () => {
    const stdout = capture('stdout');

    const h = await harness({
      kind: 'ok',
      claims: { sub: 'stranger-subject', id: 42, name: 'Eve' },
    });

    const id = await startSession(h.sessions);
    const response = await h.get(fromTelegram(), cookieFor(id));

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBe(CLEARED);
    expect(await response.text()).toContain('Nothing about you was stored.');
    expect(h.sessions.rows.has(id)).toBe(false);
    expect(h.sessions.users).toEqual([]);

    const line = String(stdout.mock.calls[0]?.[0]);
    const record = JSON.parse(line) as Record<string, unknown>;

    expect(record).toMatchObject({
      level: 'info',
      message: 'login refused',
      clientId: 'https://client.example/oauth/client.json',
      subPrefix: hashSecret('stranger-subject').slice(0, 8),
    });

    expect(line).not.toContain('stranger-subject');
    expect(line).not.toContain('Eve');
  });
});

describe('with the admin account', () => {
  it('exchanges the code with the session verifier, binds the user and goes to consent', async () => {
    const h = await harness();
    const id = await startSession(h.sessions);
    const response = await h.get(fromTelegram(), cookieFor(id));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/oauth/consent`);
    expect(response.headers.get('set-cookie')).toBeNull();

    expect(h.provider.logins).toEqual([
      {
        code: 'the-code',
        codeVerifier: VERIFIER,
        redirectUri: `${ORIGIN}/oauth/callback`,
        nonce: PROVIDER_NONCE,
      },
    ]);

    expect(h.sessions.users).toEqual([{ telegramId: ADMIN_ID, displayName: 'Kirill' }]);
    expect(h.sessions.rows.get(id)?.userId).toBeDefined();
  });

  it('binds the user without a display name when the token has none', async () => {
    const h = await harness({ kind: 'ok', claims: { sub: 'opaque-subject', id: ADMIN_ID } });
    const id = await startSession(h.sessions);

    await h.get(fromTelegram(), cookieFor(id));

    expect(h.sessions.users).toEqual([{ telegramId: ADMIN_ID }]);
    expect(h.sessions.users[0]).not.toHaveProperty('displayName');
  });

  it('answers a page when the session ends during the exchange', async () => {
    const sessions = fakeSessions();
    const h = await harness(ADMIN, { ...sessions, login: async () => undefined });
    const id = await startSession(sessions);
    const response = await h.get(fromTelegram(), cookieFor(id));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Login expired');
  });
});
