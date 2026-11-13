import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CachedMetadataInput, OAuthClient } from '../../core/oauth/clients.ts';
import type { Lookup } from './address.ts';
import {
  CIMD_MAX_AGE_SECONDS,
  type ClientOutcome,
  type ClientRefusal,
  createClientResolver,
  freshnessSeconds,
  isLoopbackRedirect,
  matchesRedirectUri,
  parseClientIdUrl,
} from './cimd.ts';

const CLIENT_ID = 'https://client.example/oauth/client.json';
const CALLBACK = 'https://client.example/callback';
const NOW = new Date('2026-11-13T10:00:00Z');
const PUBLIC = [{ address: '93.184.216.34', family: 4 as const }];

function document(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    client_id: CLIENT_ID,
    client_name: 'Example Client',
    redirect_uris: [CALLBACK, 'http://127.0.0.1/callback'],
    ...overrides,
  });
}

function reply(body: string | ReadableStream<Uint8Array> | null, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' },
    ...init,
  });
}

function fakeClients(rows: OAuthClient[] = []) {
  const map = new Map(rows.map((row) => [row.clientId, row]));
  const cached: CachedMetadataInput[] = [];

  return {
    cached,
    rows: map,
    find: async (clientId: string) => map.get(clientId),
    cacheMetadata: async (input: CachedMetadataInput) => {
      cached.push(input);

      const row: OAuthClient = {
        clientId: input.clientId,
        name: input.name,
        redirectUris: [...input.redirectUris],
        kind: 'cimd',
        metadataUrl: input.clientId,
        fetchedAt: input.fetchedAt,
        cacheUntil: input.cacheUntil,
        ...(input.etag === undefined ? {} : { etag: input.etag }),
      };

      map.set(row.clientId, row);

      return row;
    },
  };
}

interface Harness {
  clients: ReturnType<typeof fakeClients>;
  fetch: ReturnType<typeof vi.fn<typeof fetch>>;
  lookup: ReturnType<typeof vi.fn<Lookup>>;
  resolve: (clientId?: string) => Promise<ClientOutcome>;
}

function harness(
  options: {
    rows?: OAuthClient[];
    fetch?: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;
    lookup?: Lookup;
    now?: () => Date;
  } = {},
): Harness {
  const clients = fakeClients(options.rows);
  const fetchFake = vi.fn<typeof fetch>(options.fetch ?? (async () => reply(document())));
  const lookup = vi.fn<Lookup>(options.lookup ?? (async () => PUBLIC));

  const resolver = createClientResolver({
    clients,
    fetch: fetchFake,
    lookup,
    now: options.now ?? (() => NOW),
  });

  return { clients, fetch: fetchFake, lookup, resolve: (id = CLIENT_ID) => resolver.resolve(id) };
}

const stale: OAuthClient = {
  clientId: CLIENT_ID,
  name: 'Stale Name',
  redirectUris: [CALLBACK],
  kind: 'cimd',
  metadataUrl: CLIENT_ID,
  fetchedAt: new Date('2026-11-12T10:00:00Z'),
  cacheUntil: new Date('2026-11-12T11:00:00Z'),
  etag: '"v1"',
};

const registered: OAuthClient = {
  clientId: 'ZmFrZS1yZWdpc3RlcmVk',
  name: 'Cursor',
  redirectUris: ['http://localhost/callback'],
  kind: 'registered',
};

const refusal = (outcome: ClientOutcome): ClientRefusal | undefined =>
  outcome.kind === 'refused' ? outcome.reason : undefined;

const capture = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('parseClientIdUrl', () => {
  it('accepts an https URL with a non-root path', () => {
    expect(parseClientIdUrl(CLIENT_ID)?.href).toBe(CLIENT_ID);
    expect(parseClientIdUrl('https://client.example:8443/id?v=2')?.port).toBe('8443');
  });

  it('is undefined for anything that is not an https URL', () => {
    expect(parseClientIdUrl(registered.clientId)).toBeUndefined();
    expect(parseClientIdUrl('http://client.example/oauth/client.json')).toBeUndefined();
    expect(parseClientIdUrl('')).toBeUndefined();
  });

  it('is undefined for an https URL that breaks a rule', () => {
    expect(parseClientIdUrl('https://client.example')).toBeUndefined();
    expect(parseClientIdUrl('https://client.example/')).toBeUndefined();
    expect(parseClientIdUrl('https://client.example/a/../b')).toBeUndefined();
    expect(parseClientIdUrl('https://client.example/a/./b')).toBeUndefined();
    expect(parseClientIdUrl('https://client.example/a#frag')).toBeUndefined();
    expect(parseClientIdUrl('https://client.example/a#')).toBeUndefined();
    expect(parseClientIdUrl('https://user:pw@client.example/a')).toBeUndefined();
    expect(parseClientIdUrl('https://user@client.example/a')).toBeUndefined();
  });
});

describe('isLoopbackRedirect', () => {
  it('is true only for http on a loopback host', () => {
    expect(isLoopbackRedirect(new URL('http://127.0.0.1:5000/cb'))).toBe(true);
    expect(isLoopbackRedirect(new URL('http://localhost/cb'))).toBe(true);
    expect(isLoopbackRedirect(new URL('http://[::1]/cb'))).toBe(true);
    expect(isLoopbackRedirect(new URL('https://127.0.0.1/cb'))).toBe(false);
    expect(isLoopbackRedirect(new URL('http://127.0.0.2/cb'))).toBe(false);
    expect(isLoopbackRedirect(new URL('http://client.example/cb'))).toBe(false);
  });
});

describe('freshnessSeconds', () => {
  it('reads max-age and caps it', () => {
    expect(freshnessSeconds('max-age=3600')).toBe(3600);
    expect(freshnessSeconds('public, Max-Age=60, must-revalidate')).toBe(60);
    expect(freshnessSeconds('max-age=999999')).toBe(CIMD_MAX_AGE_SECONDS);
  });

  it('is zero without max-age or when storing is not allowed', () => {
    expect(freshnessSeconds(null)).toBe(0);
    expect(freshnessSeconds('public')).toBe(0);
    expect(freshnessSeconds('max-age=abc')).toBe(0);
    expect(freshnessSeconds('max-age=3600, no-store')).toBe(0);
    expect(freshnessSeconds('no-cache, max-age=3600')).toBe(0);
  });
});

describe('matchesRedirectUri', () => {
  const client: OAuthClient = {
    ...registered,
    redirectUris: ['http://127.0.0.1/callback', 'http://localhost/cb?x=1', CALLBACK],
  };

  it('ignores the port of a loopback URI', () => {
    expect(matchesRedirectUri(client, 'http://127.0.0.1:51234/callback')).toBe(true);
    expect(matchesRedirectUri(client, 'http://127.0.0.1/callback')).toBe(true);
    expect(matchesRedirectUri(client, 'http://localhost:8080/cb?x=1')).toBe(true);
  });

  it('refuses a loopback URI with another path, host, scheme or query', () => {
    expect(matchesRedirectUri(client, 'http://127.0.0.1:51234/other')).toBe(false);
    expect(matchesRedirectUri(client, 'http://[::1]:51234/callback')).toBe(false);
    expect(matchesRedirectUri(client, 'https://127.0.0.1/callback')).toBe(false);
    expect(matchesRedirectUri(client, 'http://localhost:8080/cb')).toBe(false);
  });

  it('matches any other URI exactly', () => {
    expect(matchesRedirectUri(client, CALLBACK)).toBe(true);
    expect(matchesRedirectUri(client, `${CALLBACK}?x=1`)).toBe(false);
    expect(matchesRedirectUri(client, 'https://client.example:443/callback')).toBe(false);
    expect(matchesRedirectUri(client, 'https://client.example/CALLBACK')).toBe(false);
  });

  it('matches nothing for a request that does not parse', () => {
    expect(matchesRedirectUri(client, 'not a url')).toBe(false);
    expect(matchesRedirectUri(client, '')).toBe(false);
  });
});

describe('resolve: metadata document', () => {
  it('fetches, validates and caches a document', async () => {
    const h = harness({
      fetch: async () =>
        reply(document(), { headers: { etag: '"v2"', 'cache-control': 'max-age=600' } }),
    });

    const outcome = await h.resolve();

    expect(outcome.kind).toBe('ok');

    expect(h.clients.cached).toEqual([
      {
        clientId: CLIENT_ID,
        name: 'Example Client',
        redirectUris: [CALLBACK, 'http://127.0.0.1/callback'],
        fetchedAt: NOW,
        cacheUntil: new Date(NOW.getTime() + 600_000),
        etag: '"v2"',
      },
    ]);

    expect(outcome.kind === 'ok' && outcome.client).toMatchObject({ kind: 'cimd', etag: '"v2"' });
    expect(h.lookup).toHaveBeenCalledWith('client.example');

    const [target, init] = h.fetch.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string>;

    expect(target).toBeInstanceOf(URL);
    expect((target as URL).href).toBe(CLIENT_ID);
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(headers.accept).toBe('application/json');
    expect(headers).not.toHaveProperty('if-none-match');
  });

  it('omits the etag key when the response has none, and gives no freshness without max-age', async () => {
    const h = harness({ fetch: async () => reply(document(), { headers: {} }) });

    await h.resolve();

    expect(h.clients.cached[0]).not.toHaveProperty('etag');
    expect(h.clients.cached[0]?.cacheUntil).toEqual(NOW);
  });

  it('uses a fresh row without a lookup or a fetch', async () => {
    const fresh = { ...stale, cacheUntil: new Date(NOW.getTime() + 1) };
    const h = harness({ rows: [fresh] });

    expect(await h.resolve()).toEqual({ kind: 'ok', client: fresh });
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('revalidates a stale row with its etag and keeps it on 304', async () => {
    const h = harness({
      rows: [stale],
      fetch: async () => reply(null, { status: 304, headers: { 'cache-control': 'max-age=120' } }),
    });

    const outcome = await h.resolve();

    expect(outcome.kind).toBe('ok');

    expect(h.clients.cached).toEqual([
      {
        clientId: CLIENT_ID,
        name: 'Stale Name',
        redirectUris: [CALLBACK],
        fetchedAt: NOW,
        cacheUntil: new Date(NOW.getTime() + 120_000),
        etag: '"v1"',
      },
    ]);

    const headers = h.fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;

    expect(headers['if-none-match']).toBe('"v1"');
  });

  it('takes a new etag from a 304', async () => {
    const h = harness({
      rows: [stale],
      fetch: async () => reply(null, { status: 304, headers: { etag: '"v3"' } }),
    });

    await h.resolve();

    expect(h.clients.cached[0]?.etag).toBe('"v3"');
  });

  it('refuses a 304 when no row exists', async () => {
    capture();

    const h = harness({ fetch: async () => reply(null, { status: 304 }) });

    expect(refusal(await h.resolve())).toBe('status');
    expect(h.clients.cached).toEqual([]);
  });

  it('refuses a redirect without following it', async () => {
    capture();

    const h = harness({
      fetch: async () =>
        reply('', { status: 302, headers: { location: 'https://elsewhere.example/client.json' } }),
    });

    expect(refusal(await h.resolve())).toBe('redirect');
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a body over 5 KB before the end of the stream', async () => {
    capture();

    const chunk = new Uint8Array(1024);
    let sent = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        // The resolver cancels once the cap is passed; without this the stream never settles.
      },
    });

    const h = harness({ fetch: async () => reply(stream) });

    expect(refusal(await h.resolve())).toBe('too_large');
    expect(sent).toBeLessThan(8);
  });

  it('refuses a literal special-use host without a lookup', async () => {
    capture();

    const h = harness();

    expect(refusal(await h.resolve('https://127.0.0.1/client.json'))).toBe('special_use_address');
    expect(refusal(await h.resolve('https://[::1]/client.json'))).toBe('special_use_address');
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to a special-use address, to nothing, or not at all', async () => {
    capture();

    const privateHost = harness({
      lookup: async () => [...PUBLIC, { address: '10.0.0.5', family: 4 }],
    });

    expect(refusal(await privateHost.resolve())).toBe('special_use_address');

    const noHost = harness({ lookup: async () => [] });

    expect(refusal(await noHost.resolve())).toBe('special_use_address');

    const failing = harness({
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    });

    expect(refusal(await failing.resolve())).toBe('fetch_failed');
    expect(privateHost.fetch).not.toHaveBeenCalled();
    expect(noHost.fetch).not.toHaveBeenCalled();
    expect(failing.fetch).not.toHaveBeenCalled();
  });

  it('refuses a fetch that throws', async () => {
    capture();

    const h = harness({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    const outcome = await h.resolve();

    expect(outcome).toMatchObject({ kind: 'refused', reason: 'fetch_failed' });
    expect(outcome.kind === 'refused' && outcome.description).toContain('fetch failed');
  });

  it('aborts the fetch after 5 seconds', async () => {
    capture();
    vi.useFakeTimers();

    const h = harness({
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        }),
    });

    const pending = h.resolve();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    const outcome = await pending;

    expect(outcome).toMatchObject({ kind: 'refused', reason: 'fetch_failed' });
    expect(outcome.kind === 'refused' && outcome.description).toContain('ran out of time');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a non-200 status', async () => {
    capture();

    const h = harness({ fetch: async () => reply('nope', { status: 500 }) });

    expect(refusal(await h.resolve())).toBe('status');

    expect(
      refusal(await harness({ fetch: async () => reply('', { status: 404 }) }).resolve()),
    ).toBe('status');
  });

  it('refuses a body that is not JSON', async () => {
    capture();

    expect(refusal(await harness({ fetch: async () => reply('<html>') }).resolve())).toBe(
      'not_json',
    );
  });

  it('refuses a document that misses a field or carries another auth method', async () => {
    capture();

    const cases: Record<string, unknown>[] = [
      { redirect_uris: undefined },
      { redirect_uris: [] },
      { redirect_uris: [42] },
      { client_name: '' },
      { client_name: undefined },
      { client_id: undefined },
      { token_endpoint_auth_method: 'client_secret_post' },
    ];

    for (const overrides of cases) {
      const h = harness({ fetch: async () => reply(document(overrides)) });

      expect(refusal(await h.resolve()), JSON.stringify(overrides)).toBe('invalid_document');
      expect(h.clients.cached).toEqual([]);
    }
  });

  it('refuses a redirect URI that is neither https nor loopback http', async () => {
    capture();

    for (const uri of [
      'http://client.example/cb',
      'ftp://client.example/cb',
      'not a url',
      'http://127.0.0.2/cb',
    ]) {
      const h = harness({ fetch: async () => reply(document({ redirect_uris: [CALLBACK, uri] })) });

      expect(refusal(await h.resolve()), uri).toBe('invalid_document');
    }
  });

  it('refuses a document whose client_id differs from the URL', async () => {
    capture();

    const h = harness({
      fetch: async () => reply(document({ client_id: 'https://client.example/oauth/other.json' })),
    });

    expect(refusal(await h.resolve())).toBe('client_id_mismatch');

    const trailing = harness({
      fetch: async () => reply(document({ client_id: `${CLIENT_ID}?` })),
    });

    expect(refusal(await trailing.resolve())).toBe('client_id_mismatch');
  });

  it('refuses an https client id that breaks the URL rules without a lookup', async () => {
    capture();

    const h = harness();

    expect(refusal(await h.resolve('https://client.example/'))).toBe('invalid_client_id');
    expect(refusal(await h.resolve('https://client.example/a#x'))).toBe('invalid_client_id');
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('never caches an error and leaves the stale row as it was', async () => {
    capture();

    const h = harness({
      rows: [stale],
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    expect(refusal(await h.resolve())).toBe('fetch_failed');
    expect(h.clients.cached).toEqual([]);
    expect(h.clients.rows.get(CLIENT_ID)).toEqual(stale);

    const broken = harness({
      rows: [stale],
      fetch: async () => reply(document({ client_name: '' })),
    });

    expect(refusal(await broken.resolve())).toBe('invalid_document');
    expect(broken.clients.rows.get(CLIENT_ID)).toEqual(stale);
  });

  it('logs every refusal with its reason and the client id', async () => {
    const stderr = capture();

    const h = harness({ fetch: async () => reply('', { status: 503 }) });

    await h.resolve();

    const record = JSON.parse(String(stderr.mock.calls[0]?.[0])) as Record<string, unknown>;

    expect(record).toMatchObject({
      level: 'warn',
      module: 'mcp',
      message: 'client refused',
      reason: 'status',
      clientId: CLIENT_ID,
    });
  });
});

describe('resolve: registered client', () => {
  it('returns a registered row by its id', async () => {
    const h = harness({ rows: [registered] });

    expect(await h.resolve(registered.clientId)).toEqual({ kind: 'ok', client: registered });
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('refuses an unknown id and a cimd row under a non-URL id', async () => {
    capture();

    const h = harness({ rows: [{ ...stale, clientId: 'odd-id' }] });

    expect(refusal(await h.resolve('missing'))).toBe('unknown_client');
    expect(refusal(await h.resolve('odd-id'))).toBe('unknown_client');

    expect(refusal(await h.resolve('http://client.example/oauth/client.json'))).toBe(
      'unknown_client',
    );
  });
});
