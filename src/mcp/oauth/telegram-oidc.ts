import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { logger } from '../../core/logging/logger.ts';
import { readCapped } from '../../core/pipeline/url.ts';

const log = logger.child({ module: 'mcp' });

export const TELEGRAM_ISSUER = 'https://oauth.telegram.org';

export const TELEGRAM_AUTH_URL = `${TELEGRAM_ISSUER}/auth`;

export const TELEGRAM_TOKEN_URL = `${TELEGRAM_ISSUER}/token`;

export const TELEGRAM_JWKS_URL = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;

/** `profile` brings the numeric `id` claim; `sub` alone is an opaque identifier. */
export const TELEGRAM_SCOPE = 'openid profile';

export const TELEGRAM_TIMEOUT_MS = 5_000;

const TOKEN_RESPONSE_MAX_BYTES = 16 * 1024;

// `ES256K` is a BotFather option too, but jose does not implement secp256k1.
const ALGORITHMS = ['RS256', 'ES256', 'EdDSA'];

export interface TelegramClaims {
  sub: string;
  /** The numeric Telegram user id, from the `profile` scope. */
  id: number;
  name?: string;
  username?: string;
}

export type TelegramRefusal = 'exchange' | 'token';

export type LoginOutcome =
  | { kind: 'ok'; claims: TelegramClaims }
  | { kind: 'refused'; reason: TelegramRefusal; description: string };

type Refused = Extract<LoginOutcome, { kind: 'refused' }>;

export interface LoginUrlInput {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface LoginInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  nonce: string;
}

export interface TelegramOidc {
  loginUrl(input: LoginUrlInput): string;
  /** Exchanges the code at the token endpoint and verifies the ID token it brings. */
  login(input: LoginInput): Promise<LoginOutcome>;
}

export interface TelegramOidcOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  jwks?: JWTVerifyGetKey;
  now?: () => Date;
}

/** The OIDC client id BotFather issues is the numeric prefix of the bot token. */
export function oidcClientId(botToken: string): string {
  return botToken.split(':')[0] ?? '';
}

/** The one place that decides whether a Telegram login is the admin account. */
export function isAdmin(claims: TelegramClaims, adminId: number): boolean {
  return claims.id === adminId;
}

function claimsOf(payload: JWTPayload): TelegramClaims | undefined {
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.id !== 'number' ||
    !Number.isInteger(payload.id)
  ) {
    return undefined;
  }

  return {
    sub: payload.sub,
    id: payload.id,
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    ...(typeof payload.preferred_username === 'string'
      ? { username: payload.preferred_username }
      : {}),
  };
}

export function createTelegramOidc(options: TelegramOidcOptions): TelegramOidc {
  const fetchImpl = options.fetch ?? fetch;
  const jwks = options.jwks ?? createRemoteJWKSet(new URL(TELEGRAM_JWKS_URL));
  const now = options.now ?? (() => new Date());

  const basic = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`;

  const refused = (reason: TelegramRefusal, description: string): Refused => {
    log.warn('telegram login refused', { reason, description });

    return { kind: 'refused', reason, description };
  };

  async function exchange(input: LoginInput): Promise<{ kind: 'ok'; idToken: string } | Refused> {
    // Not `AbortSignal.timeout()`: its timer is internal to Node, so a test cannot fake it.
    const budget = new AbortController();

    const timer = setTimeout(() => {
      budget.abort(new DOMException('The token request ran out of time', 'TimeoutError'));
    }, TELEGRAM_TIMEOUT_MS);

    try {
      let response: Response;

      try {
        response = await fetchImpl(TELEGRAM_TOKEN_URL, {
          method: 'POST',
          signal: budget.signal,
          headers: {
            authorization: basic,
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: input.code,
            redirect_uri: input.redirectUri,
            client_id: options.clientId,
            code_verifier: input.codeVerifier,
          }).toString(),
        });
      } catch (error) {
        return refused('exchange', `The token request failed: ${String(error)}`);
      }

      if (response.status !== 200) {
        await response.body?.cancel();

        return refused('exchange', `The token endpoint answered ${String(response.status)}.`);
      }

      let json: unknown;

      try {
        const bytes =
          response.body === null
            ? new Uint8Array()
            : await readCapped(response.body, TOKEN_RESPONSE_MAX_BYTES);

        json = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return refused('exchange', 'The token response is not JSON or is too large.');
      }

      const idToken =
        typeof json === 'object' && json !== null
          ? (json as { id_token?: unknown }).id_token
          : undefined;

      if (typeof idToken !== 'string' || idToken === '') {
        return refused('exchange', 'The token response has no id_token.');
      }

      return { kind: 'ok', idToken };
    } finally {
      clearTimeout(timer);
    }
  }

  async function verify(idToken: string, nonce: string): Promise<LoginOutcome> {
    let payload: JWTPayload;

    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        issuer: TELEGRAM_ISSUER,
        audience: options.clientId,
        algorithms: ALGORITHMS,
        currentDate: now(),
      }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      return refused('token', `The ID token did not verify: ${reason}`);
    }

    if (payload.nonce === undefined) {
      // Telegram does not document `nonce` on /auth; the session is still bound by state and PKCE.
      log.warn('telegram id token carries no nonce');
    } else if (payload.nonce !== nonce) {
      return refused('token', 'The ID token nonce does not match the login.');
    }

    const claims = claimsOf(payload);

    if (claims === undefined) {
      return refused('token', 'The ID token has no numeric id claim.');
    }

    return { kind: 'ok', claims };
  }

  return {
    loginUrl(input) {
      const url = new URL(TELEGRAM_AUTH_URL);

      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: input.redirectUri,
        response_type: 'code',
        scope: TELEGRAM_SCOPE,
        state: input.state,
        nonce: input.nonce,
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
      }).toString();

      return url.href;
    },

    async login(input) {
      const exchanged = await exchange(input);

      if (exchanged.kind === 'refused') {
        return exchanged;
      }

      return verify(exchanged.idToken, input.nonce);
    },
  };
}
