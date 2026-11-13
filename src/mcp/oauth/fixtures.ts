import type { UUID } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  createLocalJWKSet,
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import type { CodeGrant } from '../../core/oauth/codes.ts';
import type {
  AuthorizeRequest,
  LoginSession,
  LoginSessions,
  TelegramUser,
} from '../../core/oauth/login-sessions.ts';
import { closeServer, createHttpServer, type HttpRoute, listenOn } from '../../http/server.ts';
import { SCOPES } from './scopes.ts';
import type { LoginInput, LoginOutcome, LoginUrlInput, TelegramOidc } from './telegram-oidc.ts';

export const ORIGIN = 'https://memory.example';

export const CLIENT_ID = 'https://client.example/oauth/client.json';

export const CALLBACK = 'https://client.example/callback';

export const USER = '11111111-1111-4111-8111-111111111111' as UUID;

export const ADMIN_ID = 123456789;

export const NOW = new Date('2026-11-13T10:00:00Z');

export const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

export const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

export const PROVIDER_STATE = 'provider-state';

export const PROVIDER_NONCE = 'provider-nonce';

export function request(overrides: Partial<AuthorizeRequest> = {}): AuthorizeRequest {
  return {
    clientId: CLIENT_ID,
    clientName: 'Example Client',
    redirectUri: CALLBACK,
    codeChallenge: CHALLENGE,
    scopes: [...SCOPES],
    resource: `${ORIGIN}/mcp`,
    state: 'client-state',
    ...overrides,
  };
}

type Row = LoginSession & { consumed: boolean };

export interface FakeSessions extends LoginSessions {
  rows: Map<UUID, Row>;
  /** Every user passed to `login`, in order. */
  users: TelegramUser[];
}

export function fakeSessions(now: () => Date = () => NOW): FakeSessions {
  const rows = new Map<UUID, Row>();
  const users: TelegramUser[] = [];

  const live = (id: UUID): Row | undefined => {
    const row = rows.get(id);

    return row !== undefined && !row.consumed && row.expiresAt > now() ? row : undefined;
  };

  const strip = ({ consumed: _consumed, ...session }: Row): LoginSession => session;

  const stripped = (row: Row | undefined) =>
    Promise.resolve(row === undefined ? undefined : strip(row));

  return {
    rows,
    users,

    start(input) {
      const id = randomUUID();

      rows.set(id, { id, ...input, consumed: false });

      return Promise.resolve(id);
    },

    find(id) {
      return stripped(live(id));
    },

    login(id, user) {
      const row = live(id);

      if (row !== undefined) {
        users.push(user);
        row.userId = USER;
      }

      return stripped(row);
    },

    consume(id) {
      const row = live(id);

      if (row !== undefined) {
        row.consumed = true;
      }

      return stripped(row);
    },

    discard(id) {
      rows.delete(id);

      return Promise.resolve();
    },
  };
}

/** A session as `/oauth/authorize` leaves it; `loggedIn` adds the user the callback binds. */
export async function startSession(
  sessions: FakeSessions,
  options: { request?: Partial<AuthorizeRequest>; loggedIn?: boolean; expiresAt?: Date } = {},
): Promise<UUID> {
  const id = await sessions.start({
    request: request(options.request),
    state: PROVIDER_STATE,
    nonce: PROVIDER_NONCE,
    codeVerifier: VERIFIER,
    expiresAt: options.expiresAt ?? new Date(NOW.getTime() + 600_000),
  });

  if (options.loggedIn === true) {
    await sessions.login(id, { telegramId: ADMIN_ID });
  }

  return id;
}

export function fakeCodes() {
  const minted: CodeGrant[] = [];

  return {
    minted,
    mint(grant: CodeGrant) {
      minted.push(grant);

      return Promise.resolve('minted-code');
    },
  };
}

export function fakeProvider(outcome: LoginOutcome) {
  const logins: LoginInput[] = [];
  const urls: LoginUrlInput[] = [];

  const provider: TelegramOidc = {
    loginUrl(input) {
      urls.push(input);

      return `https://oauth.telegram.org/auth?state=${input.state}`;
    },

    login(input) {
      logins.push(input);

      return Promise.resolve(outcome);
    },
  };

  return { ...provider, logins, urls };
}

export const cookieFor = (id: string): string => `oauth_login=${id}`;

export const noRedirect = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...init, redirect: 'manual' });

export interface Serving {
  base: string;
  close(): Promise<void>;
}

export async function serving(routes: HttpRoute[]): Promise<Serving> {
  const server: Server = createHttpServer(routes);
  const port = await listenOn(server, 0);

  return { base: `http://127.0.0.1:${String(port)}`, close: () => closeServer(server) };
}

export interface TestKeys {
  jwks: JWTVerifyGetKey;
  privateKey: CryptoKey;
  sign(
    payload: JWTPayload,
    header?: { alg?: string; kid?: string; key?: CryptoKey },
  ): Promise<string>;
}

/** One RS256 key behind a local JWKS, and a signer for ID tokens under it. */
export async function testKeys(): Promise<TestKeys> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });

  return {
    jwks,
    privateKey,
    sign: (payload, header = {}) =>
      new SignJWT(payload)
        .setProtectedHeader({ alg: header.alg ?? 'RS256', kid: header.kid ?? 'test-key' })
        .sign(header.key ?? privateKey),
  };
}
