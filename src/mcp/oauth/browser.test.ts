import { describe, expect, it } from 'vitest';
import {
  clearLoginCookie,
  loginCookie,
  readForm,
  readLoginCookie,
  redirect,
  redirectWith,
  sendHtml,
} from './browser.ts';
import { noRedirect, serving, USER } from './fixtures.ts';

describe('login cookie', () => {
  it('builds a scoped, secure, http-only cookie and its clearing twin', () => {
    expect(loginCookie(USER, 600)).toBe(
      `oauth_login=${USER}; Max-Age=600; Path=/oauth; HttpOnly; Secure; SameSite=Lax`,
    );

    expect(clearLoginCookie()).toBe(
      'oauth_login=; Max-Age=0; Path=/oauth; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('reads the session id out of the cookie header', () => {
    expect(readLoginCookie({ cookie: `other=1; oauth_login=${USER.toUpperCase()}; x=y` })).toBe(
      USER,
    );

    expect(readLoginCookie({ cookie: `oauth_login=${USER}` })).toBe(USER);
  });

  it('is undefined without exactly one well-formed cookie', () => {
    expect(readLoginCookie({})).toBeUndefined();
    expect(readLoginCookie({ cookie: 'oauth_login=not-a-uuid' })).toBeUndefined();
    expect(readLoginCookie({ cookie: 'oauth_login=' })).toBeUndefined();
    expect(readLoginCookie({ cookie: `oauth_login=${USER}; oauth_login=${USER}` })).toBeUndefined();
    expect(readLoginCookie({ cookie: `oauth_login_x=${USER}` })).toBeUndefined();
  });
});

describe('redirectWith', () => {
  it('adds the params, keeps the client query and skips undefined', () => {
    expect(
      redirectWith('https://client.example/cb?keep=1', {
        code: 'c d',
        state: undefined,
        iss: 'https://memory.example',
      }),
    ).toBe('https://client.example/cb?keep=1&code=c+d&iss=https%3A%2F%2Fmemory.example');
  });
});

describe('over http', () => {
  it('reads a form up to the cap and answers undefined over it, with the response intact', async () => {
    const forms: (URLSearchParams | undefined)[] = [];

    const server = await serving([
      {
        method: 'POST',
        path: '/f',
        async handle(req, res) {
          forms.push(await readForm(req, 16));
          req.resume();
          res.writeHead(204).end();
        },
      },
    ]);

    const chunked = (text: string): RequestInit => ({
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      }),
      duplex: 'half',
    });

    try {
      const small = await fetch(`${server.base}/f`, { method: 'POST', body: 'a=1&b=2' });

      const declared = await fetch(`${server.base}/f`, {
        method: 'POST',
        body: 'a='.padEnd(17, 'x'),
      });

      const streamed = await fetch(`${server.base}/f`, chunked('a='.padEnd(17, 'x')));
      const streamedSmall = await fetch(`${server.base}/f`, chunked('c=3'));

      expect([small.status, declared.status, streamed.status, streamedSmall.status]).toEqual([
        204, 204, 204, 204,
      ]);

      expect(forms[0]?.get('b')).toBe('2');
      expect(forms[1]).toBeUndefined();
      expect(forms[2]).toBeUndefined();
      expect(forms[3]?.get('c')).toBe('3');
    } finally {
      await server.close();
    }
  });

  it('writes a redirect and an html page with no-store headers', async () => {
    const server = await serving([
      {
        method: 'GET',
        path: '/r',
        handle(req, res) {
          redirect(req, res, 'https://client.example/cb', { 'set-cookie': 'a=b' });
        },
      },
      {
        method: 'GET',
        path: '/h',
        handle(req, res) {
          sendHtml(req, res, 403, '<p>hi</p>');
        },
      },
    ]);

    try {
      const moved = await noRedirect(`${server.base}/r`);

      expect(moved.status).toBe(302);
      expect(moved.headers.get('location')).toBe('https://client.example/cb');
      expect(moved.headers.get('cache-control')).toBe('no-store');
      expect(moved.headers.get('set-cookie')).toBe('a=b');

      const page = await fetch(`${server.base}/h`);

      expect(page.status).toBe(403);
      expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(page.headers.get('x-frame-options')).toBe('DENY');
      expect(await page.text()).toBe('<p>hi</p>');
    } finally {
      await server.close();
    }
  });
});
