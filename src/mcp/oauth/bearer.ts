import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../../core/logging/logger.ts';
import { hashSecret } from '../../core/oauth/secret.ts';
import type { AccessGrant, OAuthTokens } from '../../core/oauth/tokens.ts';
import { oneHeader } from '../../http/server.ts';
import { resourceMetadataUrl, resourceUrl } from './metadata.ts';
import { missingScopes, requiredScopes, type ToolCall } from './scopes.ts';

const log = logger.child({ module: 'mcp' });

export interface Challenge {
  status: 401 | 403;
  /** The full `WWW-Authenticate` value. */
  header: string;
  error?: 'invalid_token' | 'insufficient_scope';
  description: string;
}

export type BearerOutcome =
  { kind: 'ok'; grant: AccessGrant } | { kind: 'challenge'; challenge: Challenge };

export interface BearerCheck {
  authenticate(headers: IncomingHttpHeaders): Promise<BearerOutcome>;
  /** The 403 challenge when the grant lacks a scope one of the calls needs. */
  authorize(grant: AccessGrant, calls: readonly ToolCall[]): Challenge | undefined;
}

export interface BearerCheckOptions {
  tokens: Pick<OAuthTokens, 'authenticate'>;
  origin: string;
}

const BEARER = /^Bearer\s+(\S+)$/i;

export function parseBearer(authorization: string | string[] | undefined): string | undefined {
  return BEARER.exec(oneHeader(authorization) ?? '')?.[1];
}

export function toolCallsFromHeaders(headers: IncomingHttpHeaders): ToolCall[] {
  const method = oneHeader(headers['mcp-method']);

  if (method === undefined) {
    return [];
  }

  const name = oneHeader(headers['mcp-name']);

  return [{ method, ...(name === undefined ? {} : { name }) }];
}

function toolCall(value: unknown): ToolCall | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const { method, params } = value as { method?: unknown; params?: unknown };

  const name =
    typeof params === 'object' && params !== null ? (params as { name?: unknown }).name : undefined;

  return {
    ...(typeof method === 'string' ? { method } : {}),
    ...(typeof name === 'string' ? { name } : {}),
  };
}

/** The requests in a parsed JSON-RPC body: one object, or a 2025-03-26 batch array. */
export function toolCallsFromBody(json: unknown): ToolCall[] {
  const items = Array.isArray(json) ? json : [json];

  return items.map(toolCall).filter((call) => call !== undefined);
}

export function createBearerCheck({ tokens, origin }: BearerCheckOptions): BearerCheck {
  const resource = resourceUrl(origin);
  const metadata = `resource_metadata="${resourceMetadataUrl(origin)}"`;

  const rejected = (token: string, reason: string, description: string): BearerOutcome => {
    log.warn('bearer rejected', { reason, hashPrefix: hashSecret(token).slice(0, 8) });

    return {
      kind: 'challenge',
      challenge: {
        status: 401,
        header: `Bearer error="invalid_token", ${metadata}`,
        error: 'invalid_token',
        description,
      },
    };
  };

  return {
    async authenticate(headers) {
      const token = parseBearer(headers.authorization);

      if (token === undefined) {
        log.debug('bearer missing');

        return {
          kind: 'challenge',
          challenge: {
            status: 401,
            header: `Bearer ${metadata}`,
            description: 'A bearer token is required.',
          },
        };
      }

      const grant = await tokens.authenticate(token);

      if (grant === undefined) {
        return rejected(token, 'unknown', 'The token is not valid.');
      }

      if (grant.resource !== resource) {
        return rejected(token, 'resource', 'The token is for a different resource.');
      }

      return { kind: 'ok', grant };
    },

    authorize(grant, calls) {
      const missing = missingScopes(grant.scopes, requiredScopes(calls));

      if (missing.length === 0) {
        return undefined;
      }

      return {
        status: 403,
        header: `Bearer error="insufficient_scope", scope="${missing.join(' ')}", ${metadata}`,
        error: 'insufficient_scope',
        description: 'The token does not have the scope for this tool.',
      };
    },
  };
}

export function sendChallenge(
  req: IncomingMessage,
  res: ServerResponse,
  challenge: Challenge,
): void {
  req.resume();

  res.writeHead(challenge.status, {
    'www-authenticate': challenge.header,
    'content-type': 'application/json',
  });

  res.end(
    JSON.stringify({
      ...(challenge.error === undefined ? {} : { error: challenge.error }),
      error_description: challenge.description,
    }),
  );
}
