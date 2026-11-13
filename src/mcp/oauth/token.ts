import type { IncomingMessage } from 'node:http';
import { logger } from '../../core/logging/logger.ts';
import type { AuthorizationCodes } from '../../core/oauth/codes.ts';
import { challengeFor, isCodeChallenge } from '../../core/oauth/pkce.ts';
import type { IssuedTokens, OAuthTokens } from '../../core/oauth/tokens.ts';
import { hashRef } from '../../core/telemetry/attributes.ts';
import { type HttpRoute, oneHeader } from '../../http/server.ts';
import { parseScopes } from './authorize.ts';
import { FORM_MAX_BYTES, readForm, sendJson } from './browser.ts';
import { resourceUrl, TOKEN_PATH } from './metadata.ts';

const log = logger.child({ module: 'mcp' });

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

export type TokenError =
  | 'invalid_request'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_target';

export interface TokenOptions {
  origin: string;
  codes: Pick<AuthorizationCodes, 'consume'>;
  tokens: Pick<OAuthTokens, 'issue' | 'refresh'>;
  now?: () => Date;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

type Outcome =
  { kind: 'ok'; tokens: IssuedTokens } | { kind: 'error'; error: TokenError; description: string };

type Params<N extends string> = { kind: 'params'; params: Record<N, string> };

const refuse = (error: TokenError, description: string): Outcome => ({
  kind: 'error',
  error,
  description,
});

/** The value of a parameter; an empty value counts as absent. */
function param(form: URLSearchParams, name: string): string | undefined {
  const value = form.get(name);

  return value === null || value === '' ? undefined : value;
}

function requireParams<N extends string>(
  form: URLSearchParams,
  names: readonly N[],
): Params<N> | Outcome {
  const params = {} as Record<N, string>;

  for (const name of names) {
    const value = param(form, name);

    if (value === undefined) {
      return refuse('invalid_request', `The parameter ${name} is required.`);
    }

    params[name] = value;
  }

  return { kind: 'params', params };
}

/** The first parameter sent more than once (RFC 6749 §3.2 forbids it). */
function repeated(form: URLSearchParams): string | undefined {
  return [...new Set(form.keys())].find((name) => form.getAll(name).length > 1);
}

export function tokenResponse(tokens: IssuedTokens): TokenResponse {
  return {
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: tokens.scopes.join(' '),
  };
}

export function tokenRoute(options: TokenOptions): HttpRoute {
  const { origin, codes, tokens } = options;
  const now = options.now ?? (() => new Date());
  const resource = resourceUrl(origin);

  const codeGrant = async (form: URLSearchParams): Promise<Outcome> => {
    const parsed = requireParams(form, [
      'code',
      'client_id',
      'redirect_uri',
      'code_verifier',
      'resource',
    ]);

    if (parsed.kind !== 'params') {
      return parsed;
    }

    const { params } = parsed;

    if (!isCodeChallenge(params.code_verifier)) {
      return refuse(
        'invalid_request',
        'The code verifier must be 43 to 128 unreserved characters.',
      );
    }

    if (params.resource !== resource) {
      return refuse('invalid_target', `The resource must be ${resource}.`);
    }

    // The code is burnt before the checks below, so a failed exchange cannot be retried.
    const code = await codes.consume(params.code);

    if (code === undefined) {
      log.warn('code rejected', { clientId: params.client_id, reason: 'unknown' });

      return refuse('invalid_grant', 'The code is unknown or was already used.');
    }

    const checks: [boolean, string, string][] = [
      [code.clientId !== params.client_id, 'client', 'The code was issued to another client.'],
      [
        code.redirectUri !== params.redirect_uri,
        'redirect_uri',
        'The redirect URI does not match the code.',
      ],
      [code.expiresAt <= now(), 'expired', 'The code has expired.'],
      [
        challengeFor(params.code_verifier) !== code.codeChallenge,
        'verifier',
        'The code verifier does not match the challenge.',
      ],
    ];

    const failed = checks.find(([mismatch]) => mismatch);

    if (failed !== undefined) {
      log.warn('code rejected', { clientId: params.client_id, reason: failed[1] });

      return refuse('invalid_grant', failed[2]);
    }

    const issued = await tokens.issue({
      clientId: code.clientId,
      userId: code.userId,
      scopes: code.scopes,
      resource: code.resource,
    });

    log.info('token issued', {
      clientId: code.clientId,
      scopes: issued.scopes,
      familyId: issued.familyId,
      userRef: hashRef(code.userId),
    });

    return { kind: 'ok', tokens: issued };
  };

  const refreshGrant = async (form: URLSearchParams): Promise<Outcome> => {
    const parsed = requireParams(form, ['refresh_token', 'client_id']);

    if (parsed.kind !== 'params') {
      return parsed;
    }

    const clientId = parsed.params.client_id;
    const scope = param(form, 'scope');
    const scopes = scope === undefined ? undefined : parseScopes(scope);

    if (scope !== undefined && scopes === undefined) {
      return refuse('invalid_scope', 'The scope has a value this server does not know.');
    }

    const outcome = await tokens.refresh(parsed.params.refresh_token, {
      clientId,
      ...(scopes === undefined ? {} : { scopes }),
    });

    switch (outcome.kind) {
      case 'issued': {
        const issued = outcome.tokens;

        log.info('token refreshed', {
          clientId,
          scopes: issued.scopes,
          familyId: issued.familyId,
          userRef: hashRef(issued.userId),
        });

        return { kind: 'ok', tokens: issued };
      }

      case 'reused':
        log.info('family revoked', {
          clientId,
          familyId: outcome.familyId,
          userRef: hashRef(outcome.userId),
        });

        return refuse('invalid_grant', 'The refresh token was already used.');
      case 'invalid_scope':
        return refuse('invalid_scope', 'The scope must be within the scopes of the refresh token.');
      case 'rejected':
        log.warn('refresh rejected', { clientId });

        return refuse('invalid_grant', 'The refresh token is not valid.');
    }
  };

  const exchange = async (req: IncomingMessage): Promise<Outcome> => {
    const contentType = oneHeader(req.headers['content-type'])?.toLowerCase() ?? '';

    if (!contentType.startsWith(FORM_CONTENT_TYPE)) {
      return refuse('invalid_request', `The body must be ${FORM_CONTENT_TYPE}.`);
    }

    const form = await readForm(req, FORM_MAX_BYTES);

    if (form === undefined) {
      return refuse('invalid_request', 'The body is too large or not readable.');
    }

    const twice = repeated(form);

    if (twice !== undefined) {
      return refuse('invalid_request', `The parameter ${twice} is sent more than once.`);
    }

    switch (param(form, 'grant_type')) {
      case 'authorization_code':
        return codeGrant(form);
      case 'refresh_token':
        return refreshGrant(form);
      default:
        return refuse(
          'unsupported_grant_type',
          'The grant type must be authorization_code or refresh_token.',
        );
    }
  };

  return {
    method: 'POST',
    path: TOKEN_PATH,
    async handle(req, res) {
      const outcome = await exchange(req);

      if (outcome.kind === 'ok') {
        sendJson(req, res, 200, tokenResponse(outcome.tokens));
        return;
      }

      sendJson(req, res, 400, { error: outcome.error, error_description: outcome.description });
    },
  };
}
