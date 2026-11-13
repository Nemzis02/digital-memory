import { logger } from '../../core/logging/logger.ts';
import type { OAuthClient } from '../../core/oauth/clients.ts';
import type { AuthorizeRequest, LoginSessions } from '../../core/oauth/login-sessions.ts';
import { challengeFor, isCodeChallenge, newVerifier } from '../../core/oauth/pkce.ts';
import { newSecret } from '../../core/oauth/secret.ts';
import type { HttpRoute } from '../../http/server.ts';
import { loginCookie, redirect, redirectWith, sendHtml } from './browser.ts';
import { type ClientResolver, matchesRedirectUri } from './cimd.ts';
import { AUTHORIZE_PATH, CALLBACK_PATH, resourceUrl } from './metadata.ts';
import { errorPage } from './pages.ts';
import { type Scope, SCOPES } from './scopes.ts';
import type { TelegramOidc } from './telegram-oidc.ts';

const log = logger.child({ module: 'mcp' });

/** How long a browser has to finish the Telegram login and the consent. */
export const LOGIN_TTL_SECONDS = 600;

export type AuthorizeError =
  'invalid_request' | 'unsupported_response_type' | 'invalid_scope' | 'invalid_target';

export type AuthorizeParse =
  | { kind: 'ok'; request: AuthorizeRequest }
  | { kind: 'error'; error: AuthorizeError; description: string };

export interface AuthorizeContext {
  client: OAuthClient;
  /** Already matched against the client, so an error may be sent to it. */
  redirectUri: string;
  origin: string;
}

export interface AuthorizeOptions {
  origin: string;
  resolver: ClientResolver;
  sessions: Pick<LoginSessions, 'start'>;
  provider: Pick<TelegramOidc, 'loginUrl'>;
  now?: () => Date;
}

const isScope = (value: string): value is Scope => (SCOPES as readonly string[]).includes(value);

/** The requested scopes in declared order, each once; none means all; unknown means refused. */
export function parseScopes(value: string | null): Scope[] | undefined {
  const parts = (value ?? '').split(' ').filter((part) => part !== '');

  if (parts.length === 0) {
    return [...SCOPES];
  }

  if (!parts.every(isScope)) {
    return undefined;
  }

  return SCOPES.filter((scope) => parts.includes(scope));
}

/** The checks that run once the client and its redirect URI are trusted. */
export function parseAuthorizeRequest(
  query: URLSearchParams,
  context: AuthorizeContext,
): AuthorizeParse {
  const error = (code: AuthorizeError, description: string): AuthorizeParse => ({
    kind: 'error',
    error: code,
    description,
  });

  if (query.get('response_type') !== 'code') {
    return error('unsupported_response_type', 'Only response_type=code is supported.');
  }

  const codeChallenge = query.get('code_challenge') ?? '';

  if (query.get('code_challenge_method') !== 'S256' || !isCodeChallenge(codeChallenge)) {
    return error(
      'invalid_request',
      'A code_challenge with code_challenge_method=S256 is required.',
    );
  }

  if (query.get('resource') !== resourceUrl(context.origin)) {
    return error('invalid_target', `The resource must be ${resourceUrl(context.origin)}.`);
  }

  const scopes = parseScopes(query.get('scope'));

  if (scopes === undefined) {
    return error('invalid_scope', `The scopes supported are ${SCOPES.join(', ')}.`);
  }

  return {
    kind: 'ok',
    request: {
      clientId: context.client.clientId,
      clientName: context.client.name,
      redirectUri: context.redirectUri,
      codeChallenge,
      scopes,
      resource: resourceUrl(context.origin),
      state: query.get('state') ?? '',
    },
  };
}

/** The key of a parameter given more than once, if any. */
function duplicatedKey(query: URLSearchParams): string | undefined {
  return [...new Set(query.keys())].find((key) => query.getAll(key).length > 1);
}

export function authorizeRoute(options: AuthorizeOptions): HttpRoute {
  const { origin, resolver, sessions, provider } = options;
  const now = options.now ?? (() => new Date());

  return {
    method: 'GET',
    path: AUTHORIZE_PATH,
    async handle(req, res) {
      const query = new URL(req.url ?? '', origin).searchParams;

      const refuse = (title: string, description: string) => {
        sendHtml(req, res, 400, errorPage(title, description));
      };

      const duplicated = duplicatedKey(query);

      if (duplicated !== undefined) {
        refuse('Invalid request', `The parameter ${duplicated} is given more than once.`);
        return;
      }

      const clientId = query.get('client_id');

      if (clientId === null || clientId === '') {
        refuse('Invalid request', 'The client_id parameter is missing.');
        return;
      }

      const outcome = await resolver.resolve(clientId);

      if (outcome.kind === 'refused') {
        refuse('Unknown client', outcome.description);
        return;
      }

      const redirectUri = query.get('redirect_uri');

      if (redirectUri === null || !matchesRedirectUri(outcome.client, redirectUri)) {
        refuse('Invalid redirect URI', 'The redirect_uri is not one the client registered.');
        return;
      }

      const parsed = parseAuthorizeRequest(query, { client: outcome.client, redirectUri, origin });
      const state = query.get('state') ?? undefined;

      if (parsed.kind === 'error') {
        redirect(
          req,
          res,
          redirectWith(redirectUri, {
            error: parsed.error,
            error_description: parsed.description,
            state,
          }),
        );

        return;
      }

      const providerState = newSecret();
      const nonce = newSecret();
      const codeVerifier = newVerifier();

      const id = await sessions.start({
        request: parsed.request,
        state: providerState,
        nonce,
        codeVerifier,
        expiresAt: new Date(now().getTime() + LOGIN_TTL_SECONDS * 1000),
      });

      log.info('login started', { clientId });

      redirect(
        req,
        res,
        provider.loginUrl({
          redirectUri: `${origin}${CALLBACK_PATH}`,
          state: providerState,
          nonce,
          codeChallenge: challengeFor(codeVerifier),
        }),
        { 'set-cookie': loginCookie(id, LOGIN_TTL_SECONDS) },
      );
    },
  };
}
