import type { HttpRoute } from '../../http/server.ts';
import { SCOPES, type Scope } from './scopes.ts';

export const MCP_PATH = '/mcp';

export const AUTHORIZE_PATH = '/oauth/authorize';

export const TOKEN_PATH = '/oauth/token';

export const CALLBACK_PATH = '/oauth/callback';

export const CONSENT_PATH = '/oauth/consent';

export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

export const PROTECTED_RESOURCE_MCP_PATH = `${PROTECTED_RESOURCE_PATH}${MCP_PATH}`;

export const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';

/** `PUBLIC_URL` without its path: the issuer, and the base of every OAuth and MCP URL. */
export function publicOrigin(publicUrl: string): string {
  return new URL(publicUrl).origin;
}

export function resourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}${PROTECTED_RESOURCE_PATH}`;
}

export interface ProtectedResourceDocument {
  resource: string;
  authorization_servers: string[];
  scopes_supported: Scope[];
  bearer_methods_supported: ['header'];
}

export interface AuthorizationServerDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  response_types_supported: ['code'];
  grant_types_supported: ['authorization_code', 'refresh_token'];
  code_challenge_methods_supported: ['S256'];
  token_endpoint_auth_methods_supported: ['none'];
  client_id_metadata_document_supported: true;
  authorization_response_iss_parameter_supported: true;
  scopes_supported: Scope[];
}

export function protectedResourceDocument(origin: string): ProtectedResourceDocument {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
  };
}

export function authorizationServerDocument(origin: string): AuthorizationServerDocument {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [...SCOPES],
  };
}

function documentRoute(path: string, document: unknown): HttpRoute {
  const body = JSON.stringify(document);

  return {
    method: 'GET',
    path,
    handle(req, res) {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    },
  };
}

export function metadataRoutes(origin: string): HttpRoute[] {
  const resource = protectedResourceDocument(origin);

  return [
    documentRoute(PROTECTED_RESOURCE_PATH, resource),
    documentRoute(PROTECTED_RESOURCE_MCP_PATH, resource),
    documentRoute(AUTHORIZATION_SERVER_PATH, authorizationServerDocument(origin)),
  ];
}
