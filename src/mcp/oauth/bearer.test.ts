import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashSecret } from '../../core/oauth/secret.ts';
import type { AccessGrant } from '../../core/oauth/tokens.ts';
import { closeServer, createHttpServer, listenOn } from '../../http/server.ts';
import {
  type BearerCheck,
  createBearerCheck,
  parseBearer,
  sendChallenge,
  toolCallsFromBody,
  toolCallsFromHeaders,
} from './bearer.ts';

const ORIGIN = 'https://memory.example';
const METADATA = 'resource_metadata="https://memory.example/.well-known/oauth-protected-resource"';
const GOOD = 'good-token-7f3a9c';
const FOREIGN = 'foreign-token-1b2c3d';
const USER = '11111111-1111-4111-8111-111111111111' as const;

const grant: AccessGrant = {
  clientId: 'client-1',
  userId: USER,
  scopes: ['memory:read'],
  resource: 'https://memory.example/mcp',
};

const check = (): BearerCheck =>
  createBearerCheck({
    origin: ORIGIN,
    tokens: {
      authenticate: (token) =>
        Promise.resolve(
          token === GOOD
            ? grant
            : token === FOREIGN
              ? { ...grant, resource: 'https://other.example/mcp' }
              : undefined,
        ),
    },
  });

const capture = (stream: 'stdout' | 'stderr') =>
  vi.spyOn(process[stream], 'write').mockImplementation(() => true);

const parse = (write: ReturnType<typeof capture>): Record<string, unknown> =>
  JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseBearer', () => {
  it('takes the token after a Bearer scheme in any case', () => {
    expect(parseBearer('Bearer abc')).toBe('abc');
    expect(parseBearer('bearer abc')).toBe('abc');
    expect(parseBearer('Bearer   abc')).toBe('abc');
  });

  it('treats any other value as no credentials', () => {
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer('')).toBeUndefined();
    expect(parseBearer('Bearer')).toBeUndefined();
    expect(parseBearer('Bearer ')).toBeUndefined();
    expect(parseBearer('Basic abc')).toBeUndefined();
    expect(parseBearer('Bearer a b')).toBeUndefined();
    expect(parseBearer(['Bearer a', 'Bearer b'])).toBeUndefined();
  });
});

describe('toolCallsFromHeaders', () => {
  it('reads the method and the name', () => {
    expect(toolCallsFromHeaders({ 'mcp-method': 'tools/call', 'mcp-name': 'save_memory' })).toEqual(
      [{ method: 'tools/call', name: 'save_memory' }],
    );
  });

  it('omits the name key when the header is absent', () => {
    const [call] = toolCallsFromHeaders({ 'mcp-method': 'initialize' });

    expect(call).toEqual({ method: 'initialize' });
    expect(call).not.toHaveProperty('name');
  });

  it('yields nothing without a method header', () => {
    expect(toolCallsFromHeaders({ 'mcp-name': 'save_memory' })).toEqual([]);
    expect(toolCallsFromHeaders({})).toEqual([]);
  });
});

describe('toolCallsFromBody', () => {
  it('reads one request', () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_memory' } };

    expect(toolCallsFromBody(body)).toEqual([{ method: 'tools/call', name: 'save_memory' }]);
  });

  it('reads every request of a batch', () => {
    const body = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'forget_memory' } },
      'not a request',
    ];

    expect(toolCallsFromBody(body)).toEqual([
      { method: 'initialize' },
      { method: 'tools/call', name: 'forget_memory' },
    ]);
  });

  it('yields nothing for a body that is not a request', () => {
    expect(toolCallsFromBody(undefined)).toEqual([]);
    expect(toolCallsFromBody(null)).toEqual([]);
    expect(toolCallsFromBody('x')).toEqual([]);
    expect(toolCallsFromBody(42)).toEqual([]);
    expect(toolCallsFromBody({ method: 7, params: { name: 7 } })).toEqual([{}]);
  });
});

describe('authenticate', () => {
  it('challenges a request without credentials and names the resource metadata', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug');

    const stderr = capture('stderr');
    const stdout = capture('stdout');
    const outcome = await check().authenticate({});

    expect(outcome).toEqual({
      kind: 'challenge',
      challenge: {
        status: 401,
        header: `Bearer ${METADATA}`,
        description: 'A bearer token is required.',
      },
    });

    expect(outcome.kind === 'challenge' && outcome.challenge).not.toHaveProperty('error');
    expect(stderr).not.toHaveBeenCalled();
    expect(parse(stdout)).toMatchObject({ level: 'debug', message: 'bearer missing' });
    expect(parse(stdout)).not.toHaveProperty('hashPrefix');
  });

  it('rejects an unknown token and logs only a hash prefix', async () => {
    const stderr = capture('stderr');
    const token = 'expired-or-made-up';
    const outcome = await check().authenticate({ authorization: `Bearer ${token}` });

    expect(outcome).toEqual({
      kind: 'challenge',
      challenge: {
        status: 401,
        header: `Bearer error="invalid_token", ${METADATA}`,
        error: 'invalid_token',
        description: 'The token is not valid.',
      },
    });

    const line = String(stderr.mock.calls[0]?.[0]);
    const record = parse(stderr);

    expect(record).toMatchObject({
      level: 'warn',
      module: 'mcp',
      message: 'bearer rejected',
      reason: 'unknown',
      hashPrefix: hashSecret(token).slice(0, 8),
    });

    expect(String(record.hashPrefix)).toHaveLength(8);
    expect(line).not.toContain(token);
  });

  it('rejects a token issued for another resource', async () => {
    const stderr = capture('stderr');
    const outcome = await check().authenticate({ authorization: `Bearer ${FOREIGN}` });

    expect(outcome.kind).toBe('challenge');

    expect(outcome.kind === 'challenge' && outcome.challenge).toMatchObject({
      status: 401,
      error: 'invalid_token',
      description: 'The token is for a different resource.',
    });

    expect(parse(stderr)).toMatchObject({ reason: 'resource' });
  });

  it('returns the grant behind a live token', async () => {
    const stderr = capture('stderr');

    expect(await check().authenticate({ authorization: `bearer ${GOOD}` })).toEqual({
      kind: 'ok',
      grant,
    });

    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('authorize', () => {
  it('challenges a tool call outside the granted scopes with every missing scope', () => {
    const stderr = capture('stderr');

    expect(check().authorize(grant, [{ method: 'tools/call', name: 'forget_memory' }])).toEqual({
      status: 403,
      header: `Bearer error="insufficient_scope", scope="memory:delete", ${METADATA}`,
      error: 'insufficient_scope',
      description: 'The token does not have the scope for this tool.',
    });

    const both = check().authorize(grant, [
      { method: 'tools/call', name: 'forget_memory' },
      { method: 'tools/call', name: 'save_memory' },
    ]);

    expect(both?.header).toBe(
      `Bearer error="insufficient_scope", scope="memory:write memory:delete", ${METADATA}`,
    );

    expect(stderr).not.toHaveBeenCalled();
  });

  it('passes a call the grant covers, and any method that is not a tool call', () => {
    expect(check().authorize(grant, [{ method: 'tools/call', name: 'search_memory' }])).toBe(
      undefined,
    );

    expect(check().authorize(grant, [{ method: 'initialize' }])).toBeUndefined();
    expect(check().authorize(grant, [])).toBeUndefined();
  });

  it('checks the header hint and the body hint together', () => {
    const calls = [{ method: 'ping' }, { method: 'tools/call', name: 'save_memory' }];

    expect(check().authorize(grant, calls)?.header).toContain('scope="memory:write"');
  });
});

describe('sendChallenge', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  async function serve(): Promise<string> {
    const bearer = check();

    const server = createHttpServer([
      {
        method: 'POST',
        path: '/mcp',
        async handle(req, res) {
          const outcome = await bearer.authenticate(req.headers);

          if (outcome.kind === 'challenge') {
            sendChallenge(req, res, outcome.challenge);
            return;
          }

          const challenge = bearer.authorize(outcome.grant, toolCallsFromHeaders(req.headers));

          if (challenge !== undefined) {
            sendChallenge(req, res, challenge);
            return;
          }

          req.resume();
          res.writeHead(204).end();
        },
      },
    ]);

    servers.push(server);

    return `http://127.0.0.1:${await listenOn(server, 0)}`;
  }

  it('writes the 401 with the challenge header and a JSON body', async () => {
    const base = await serve();
    const response = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(`Bearer ${METADATA}`);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error_description: 'A bearer token is required.' });
  });

  it('writes the 403 with the error code and drains the body', async () => {
    capture('stderr');

    const base = await serve();

    const headers = {
      authorization: `Bearer ${GOOD}`,
      'mcp-method': 'tools/call',
      'mcp-name': 'forget_memory',
    };

    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers,
      body: 'x'.repeat(65_536),
    });

    expect(response.status).toBe(403);

    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="memory:delete", ${METADATA}`,
    );

    expect(await response.json()).toEqual({
      error: 'insufficient_scope',
      error_description: 'The token does not have the scope for this tool.',
    });

    const next = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...headers, 'mcp-name': 'search_memory' },
    });

    expect(next.status).toBe(204);
  });
});
