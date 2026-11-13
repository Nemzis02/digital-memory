import type { UUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

export const LOGIN_COOKIE = 'oauth_login';

const COOKIE_PATH = '/oauth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** The `Set-Cookie` value that carries the login session id for its lifetime. */
export function loginCookie(id: string, maxAgeSeconds: number): string {
  return `${LOGIN_COOKIE}=${id}; Max-Age=${String(maxAgeSeconds)}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearLoginCookie(): string {
  return loginCookie('', 0);
}

/** The login session id from the cookies, when there is exactly one and it is a UUID. */
export function readLoginCookie(headers: IncomingHttpHeaders): UUID | undefined {
  const prefix = `${LOGIN_COOKIE}=`;

  const values = (headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix))
    .map((part) => part.slice(prefix.length));

  const [value] = values;

  return values.length === 1 && value !== undefined && UUID_PATTERN.test(value)
    ? (value.toLowerCase() as UUID)
    : undefined;
}

/**
 * The fields of a form POST, or `undefined` once the body passes the cap. The request is never
 * destroyed: that would reset the socket before any answer reaches the browser.
 */
export function readForm(
  req: IncomingMessage,
  maxBytes: number,
): Promise<URLSearchParams | undefined> {
  const declared = Number(req.headers['content-length']);

  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;

      if (size > maxBytes) {
        chunks.length = 0;
        resolve(undefined);
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(size > maxBytes ? undefined : new URLSearchParams(Buffer.concat(chunks).toString()));
    });

    req.on('error', () => {
      resolve(undefined);
    });
  });
}

/** The redirect URI with the params added; a query the client registered survives. */
export function redirectWith(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return url.href;
}

export function redirect(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  headers: Record<string, string> = {},
): void {
  req.resume();
  res.writeHead(302, { ...NO_STORE, location: url, ...headers });
  res.end();
}

export function sendHtml(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void {
  req.resume();

  res.writeHead(status, {
    ...NO_STORE,
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-frame-options': 'DENY',
    ...headers,
  });

  res.end(html);
}
