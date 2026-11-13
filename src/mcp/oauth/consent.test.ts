import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashRef } from '../../core/telemetry/attributes.ts';
import { consentRoutes } from './consent.ts';
import {
  CALLBACK,
  CHALLENGE,
  CLIENT_ID,
  cookieFor,
  fakeCodes,
  fakeSessions,
  NOW,
  noRedirect,
  ORIGIN,
  type Serving,
  serving,
  startSession,
  USER,
} from './fixtures.ts';

const servers: Serving[] = [];

const CLEARED = 'oauth_login=; Max-Age=0; Path=/oauth; HttpOnly; Secure; SameSite=Lax';

async function harness() {
  const sessions = fakeSessions();
  const codes = fakeCodes();

  const server = await serving(consentRoutes({ origin: ORIGIN, sessions, codes, now: () => NOW }));

  servers.push(server);

  const get = (cookie?: string) =>
    fetch(`${server.base}/oauth/consent`, { headers: cookie === undefined ? {} : { cookie } });

  const post = (fields: Record<string, string | string[]>, cookie?: string, body?: string) => {
    const form = new URLSearchParams();

    for (const [key, value] of Object.entries(fields)) {
      for (const one of Array.isArray(value) ? value : [value]) {
        form.append(key, one);
      }
    }

    return noRedirect(`${server.base}/oauth/consent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: body ?? form.toString(),
    });
  };

  return { sessions, codes, get, post };
}

const approval = (
  id: string,
  scopes: string[] = ['memory:read', 'memory:write', 'memory:delete'],
) => ({
  session: id,
  decision: 'approve',
  scope: scopes,
});

const sentTo = (response: Response): Record<string, string> => {
  const location = new URL(response.headers.get('location') ?? '');

  expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);

  return Object.fromEntries(location.searchParams);
};

const capture = (stream: 'stdout' | 'stderr') =>
  vi.spyOn(process[stream], 'write').mockImplementation(() => true);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('GET /oauth/consent', () => {
  it('answers a page before the Telegram login', async () => {
    const h = await harness();
    const missing = await h.get();

    expect(missing.status).toBe(400);
    expect(missing.headers.get('set-cookie')).toBe(CLEARED);
    expect(await missing.text()).toContain('Login expired');

    const notLoggedIn = await h.get(cookieFor(await startSession(h.sessions)));

    expect(notLoggedIn.status).toBe(400);
  });

  it('renders the client, the host, the requested scopes and the session', async () => {
    const h = await harness();

    const id = await startSession(h.sessions, {
      loggedIn: true,
      request: { scopes: ['memory:read', 'memory:delete'] },
    });

    const response = await h.get(cookieFor(id));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(html).toContain('<strong>Example Client</strong>');
    expect(html).toContain('<code>client.example</code>');
    expect(html).toContain(`name="session" value="${id}"`);
    expect(html).toContain('value="memory:read" checked');
    expect(html).toContain('value="memory:delete" checked');
    expect(html).not.toContain('memory:write');
  });
});

describe('POST /oauth/consent', () => {
  it('mints a code for the approved scopes and sends it back with state and iss', async () => {
    const stdout = capture('stdout');
    const h = await harness();
    const id = await startSession(h.sessions, { loggedIn: true });
    const response = await h.post(approval(id), cookieFor(id));

    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toBe(CLEARED);
    expect(sentTo(response)).toEqual({ code: 'minted-code', state: 'client-state', iss: ORIGIN });

    expect(h.codes.minted).toEqual([
      {
        clientId: CLIENT_ID,
        userId: USER,
        redirectUri: CALLBACK,
        codeChallenge: CHALLENGE,
        scopes: ['memory:read', 'memory:write', 'memory:delete'],
        resource: `${ORIGIN}/mcp`,
        expiresAt: new Date(NOW.getTime() + 600_000),
      },
    ]);

    expect(await h.sessions.find(id)).toBeUndefined();

    const line = String(stdout.mock.calls[0]?.[0]);
    const record = JSON.parse(line) as Record<string, unknown>;

    expect(record).toMatchObject({
      level: 'info',
      message: 'consent given',
      clientId: CLIENT_ID,
      scopes: ['memory:read', 'memory:write', 'memory:delete'],
      userRef: hashRef(USER),
    });

    expect(line).not.toContain(USER);
    expect(line).not.toContain('minted-code');
  });

  it('narrows to the boxes left checked and ignores a scope that was not requested', async () => {
    capture('stdout');

    const h = await harness();

    const id = await startSession(h.sessions, {
      loggedIn: true,
      request: { scopes: ['memory:read', 'memory:write'], state: '' },
    });

    const response = await h.post(approval(id, ['memory:write', 'memory:delete']), cookieFor(id));

    expect(sentTo(response)).toEqual({ code: 'minted-code', iss: ORIGIN });
    expect(h.codes.minted[0]?.scopes).toEqual(['memory:write']);
  });

  it('sends access_denied on deny or on an approval with nothing checked, and consumes the session', async () => {
    capture('stdout');

    const h = await harness();

    for (const fields of [
      { session: '', decision: 'deny', scope: ['memory:read'] },
      { session: '', decision: 'approve' },
      { session: '', decision: 'approve', scope: ['memory:admin'] },
    ]) {
      const id = await startSession(h.sessions, { loggedIn: true });
      const response = await h.post({ ...fields, session: id }, cookieFor(id));

      expect(response.status).toBe(302);
      expect(response.headers.get('set-cookie')).toBe(CLEARED);

      expect(sentTo(response)).toEqual({
        error: 'access_denied',
        error_description: 'The user denied the request.',
        state: 'client-state',
      });

      expect(await h.sessions.find(id)).toBeUndefined();
    }

    expect(h.codes.minted).toEqual([]);
  });

  it('refuses a second submit, a form without the login, and a form for another session', async () => {
    capture('stdout');

    const h = await harness();
    const id = await startSession(h.sessions, { loggedIn: true });

    expect((await h.post(approval(id), cookieFor(id))).status).toBe(302);

    const again = await h.post(approval(id), cookieFor(id));

    expect(again.status).toBe(400);
    expect(await again.text()).toContain('Login expired');

    const fresh = await startSession(h.sessions, { loggedIn: true });
    const other = await startSession(h.sessions, { loggedIn: true });

    expect((await h.post(approval(fresh))).status).toBe(400);
    expect((await h.post(approval(other), cookieFor(fresh))).status).toBe(400);
    expect(await h.sessions.find(fresh)).toBeDefined();

    const notLoggedIn = await startSession(h.sessions);

    expect((await h.post(approval(notLoggedIn), cookieFor(notLoggedIn))).status).toBe(400);
    expect(h.codes.minted).toHaveLength(1);
  });

  it('refuses a form over 4 KB', async () => {
    const h = await harness();
    const id = await startSession(h.sessions, { loggedIn: true });
    const response = await h.post({}, cookieFor(id), `session=${id}&pad=${'x'.repeat(4096)}`);

    expect(response.status).toBe(413);
    expect(await h.sessions.find(id)).toBeDefined();
  });
});
