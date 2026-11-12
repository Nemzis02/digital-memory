import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { closeServer, createHttpServer, listenOn } from '../../http/server.ts';
import {
  authorizationServerDocument,
  metadataRoutes,
  protectedResourceDocument,
  publicOrigin,
  resourceMetadataUrl,
  resourceUrl,
} from './metadata.ts';

const ORIGIN = 'https://memory.example';

describe('publicOrigin', () => {
  it('keeps the scheme, host and port and drops the rest', () => {
    expect(publicOrigin('https://memory.example/some/path?q=1#x')).toBe(ORIGIN);
    expect(publicOrigin('https://memory.example:8443/')).toBe('https://memory.example:8443');
    expect(publicOrigin('http://localhost:8080/bot')).toBe('http://localhost:8080');
  });

  it('derives the resource and its metadata URL from the origin', () => {
    expect(resourceUrl(ORIGIN)).toBe('https://memory.example/mcp');

    expect(resourceMetadataUrl(ORIGIN)).toBe(
      'https://memory.example/.well-known/oauth-protected-resource',
    );
  });
});

describe('metadata documents', () => {
  it('describes the protected resource', () => {
    expect(protectedResourceDocument(ORIGIN)).toEqual({
      resource: 'https://memory.example/mcp',
      authorization_servers: ['https://memory.example'],
      scopes_supported: ['memory:read', 'memory:write', 'memory:delete'],
      bearer_methods_supported: ['header'],
    });
  });

  it('describes the authorization server without a registration endpoint', () => {
    const document = authorizationServerDocument(ORIGIN);

    expect(document).toEqual({
      issuer: 'https://memory.example',
      authorization_endpoint: 'https://memory.example/oauth/authorize',
      token_endpoint: 'https://memory.example/oauth/token',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      scopes_supported: ['memory:read', 'memory:write', 'memory:delete'],
    });

    expect(document).not.toHaveProperty('registration_endpoint');
  });
});

describe('metadata routes', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  async function serve(): Promise<string> {
    const server = createHttpServer(metadataRoutes(ORIGIN));

    servers.push(server);

    return `http://127.0.0.1:${await listenOn(server, 0)}`;
  }

  it('serves the protected resource document at both well-known paths', async () => {
    const base = await serve();
    const root = await fetch(`${base}/.well-known/oauth-protected-resource`);
    const suffixed = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);

    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toBe('application/json');
    expect(suffixed.status).toBe(200);

    const body = await root.text();

    expect(await suffixed.text()).toBe(body);
    expect(JSON.parse(body)).toEqual(protectedResourceDocument(ORIGIN));
  });

  it('serves the authorization server document', async () => {
    const base = await serve();
    const response = await fetch(`${base}/.well-known/oauth-authorization-server`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual(authorizationServerDocument(ORIGIN));
  });

  it('answers only GET', async () => {
    const base = await serve();

    const response = await fetch(`${base}/.well-known/oauth-authorization-server`, {
      method: 'POST',
    });

    expect(response.status).toBe(404);
  });
});
