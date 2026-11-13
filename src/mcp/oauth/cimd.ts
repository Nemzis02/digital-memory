import { z } from 'zod';
import { logger } from '../../core/logging/logger.ts';
import type { OAuthClient, OAuthClients } from '../../core/oauth/clients.ts';
import { readCapped } from '../../core/pipeline/url.ts';
import {
  isSpecialUseAddress,
  type Lookup,
  resolveAddresses,
  type ResolvedAddress,
  systemLookup,
} from './address.ts';

const log = logger.child({ module: 'mcp' });

export const CIMD_TIMEOUT_MS = 5_000;

export const CIMD_MAX_BYTES = 5 * 1024;

/** The longest a document stays fresh, whatever its `max-age` says. */
export const CIMD_MAX_AGE_SECONDS = 24 * 60 * 60;

const USER_AGENT = 'digital-memory/0.1 (+oauth client metadata)';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type ClientRefusal =
  | 'unknown_client'
  | 'invalid_client_id'
  | 'special_use_address'
  | 'fetch_failed'
  | 'redirect'
  | 'status'
  | 'too_large'
  | 'not_json'
  | 'invalid_document'
  | 'client_id_mismatch';

export type ClientOutcome =
  | { kind: 'ok'; client: OAuthClient }
  | { kind: 'refused'; reason: ClientRefusal; description: string };

export interface ClientResolverOptions {
  clients: Pick<OAuthClients, 'find' | 'cacheMetadata'>;
  fetch?: typeof fetch;
  lookup?: Lookup;
  now?: () => Date;
}

export interface ClientResolver {
  resolve(clientId: string): Promise<ClientOutcome>;
}

const metadataDocument = z.looseObject({
  client_id: z.string(),
  client_name: z.string().min(1),
  redirect_uris: z.array(z.string()).min(1),
  token_endpoint_auth_method: z.literal('none').optional(),
});

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * The URL form of a metadata-document client id: `https`, a non-root path, no dot segment,
 * no fragment, no credentials. Anything that is not an `https` URL is a registered id.
 */
export function parseClientIdUrl(clientId: string): URL | undefined {
  const url = parseUrl(clientId);

  if (url === undefined || url.protocol !== 'https:') {
    return undefined;
  }

  // The parser already folds `.` and `..` away, so the rule reads the string as sent.
  const rawPath = /^https:\/\/[^/?#]*([^?#]*)/i.exec(clientId)?.[1] ?? '';
  const segments = rawPath.split('/');

  if (
    url.pathname === '/' ||
    segments.includes('.') ||
    segments.includes('..') ||
    url.hash !== '' ||
    clientId.endsWith('#') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return undefined;
  }

  return url;
}

export function isLoopbackRedirect(uri: URL): boolean {
  return uri.protocol === 'http:' && LOOPBACK_HOSTS.has(uri.hostname);
}

function isAllowedRedirect(value: string): boolean {
  const uri = parseUrl(value);

  return uri !== undefined && (uri.protocol === 'https:' || isLoopbackRedirect(uri));
}

/** A loopback URI matches on any port; every other URI matches exactly. */
export function matchesRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  const requested = parseUrl(redirectUri);

  if (requested === undefined) {
    return false;
  }

  return client.redirectUris.some((registered) => {
    const uri = parseUrl(registered);

    if (uri === undefined || !isLoopbackRedirect(uri)) {
      return registered === redirectUri;
    }

    return (
      requested.protocol === uri.protocol &&
      requested.hostname === uri.hostname &&
      requested.pathname === uri.pathname &&
      requested.search === uri.search
    );
  });
}

/** Seconds a response may be reused, from `Cache-Control`; 0 when it may not be stored. */
export function freshnessSeconds(cacheControl: string | null): number {
  if (cacheControl === null) {
    return 0;
  }

  const directives = cacheControl.split(',').map((directive) => directive.trim().toLowerCase());

  if (directives.includes('no-store') || directives.includes('no-cache')) {
    return 0;
  }

  const maxAge = directives
    .map((directive) => /^max-age=(\d+)$/.exec(directive)?.[1])
    .find(Boolean);

  return maxAge === undefined ? 0 : Math.min(Number(maxAge), CIMD_MAX_AGE_SECONDS);
}

export function createClientResolver(options: ClientResolverOptions): ClientResolver {
  const { clients } = options;
  const fetchImpl = options.fetch ?? fetch;
  const lookup = options.lookup ?? systemLookup;
  const now = options.now ?? (() => new Date());

  const refused = (clientId: string, reason: ClientRefusal, description: string): ClientOutcome => {
    log.warn('client refused', { reason, clientId });

    return { kind: 'refused', reason, description };
  };

  async function fetchDocument(url: URL, etag: string | undefined): Promise<Response> {
    // Not `AbortSignal.timeout()`: its timer is internal to Node, so a test cannot fake it.
    const budget = new AbortController();

    const timer = setTimeout(() => {
      budget.abort(new DOMException('The metadata fetch ran out of time', 'TimeoutError'));
    }, CIMD_TIMEOUT_MS);

    try {
      return await fetchImpl(url, {
        redirect: 'manual',
        signal: budget.signal,
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...(etag === undefined ? {} : { 'if-none-match': etag }),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveRegistered(clientId: string): Promise<ClientOutcome> {
    const client = await clients.find(clientId);

    if (client === undefined || client.kind !== 'registered') {
      return refused(clientId, 'unknown_client', 'The client id is not registered.');
    }

    return { kind: 'ok', client };
  }

  async function resolveDocument(clientId: string, url: URL): Promise<ClientOutcome> {
    const found = await clients.find(clientId);
    const cached = found?.kind === 'cimd' ? found : undefined;
    const at = now();

    if (cached?.cacheUntil !== undefined && cached.cacheUntil > at) {
      return { kind: 'ok', client: cached };
    }

    let addresses: ResolvedAddress[];

    try {
      addresses = await resolveAddresses(url.hostname, lookup);
    } catch (error) {
      return refused(clientId, 'fetch_failed', `The client host did not resolve: ${String(error)}`);
    }

    if (addresses.length === 0 || addresses.some(({ address }) => isSpecialUseAddress(address))) {
      return refused(clientId, 'special_use_address', 'The client host is not a public address.');
    }

    let response: Response;

    try {
      response = await fetchDocument(url, cached?.etag);
    } catch (error) {
      return refused(clientId, 'fetch_failed', `The metadata fetch failed: ${String(error)}`);
    }

    const cacheUntil = new Date(
      at.getTime() + freshnessSeconds(response.headers.get('cache-control')) * 1000,
    );

    const etag = response.headers.get('etag') ?? undefined;

    if (response.status === 304) {
      await response.body?.cancel();

      if (cached === undefined) {
        return refused(clientId, 'status', 'The metadata URL answered 304 with nothing cached.');
      }

      const kept = etag ?? cached.etag;

      const client = await clients.cacheMetadata({
        clientId,
        name: cached.name,
        redirectUris: cached.redirectUris,
        fetchedAt: at,
        cacheUntil,
        ...(kept === undefined ? {} : { etag: kept }),
      });

      return { kind: 'ok', client };
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();

      return refused(
        clientId,
        'redirect',
        'The metadata URL redirects; redirects are not followed.',
      );
    }

    if (response.status !== 200) {
      await response.body?.cancel();

      return refused(clientId, 'status', `The metadata URL answered ${String(response.status)}.`);
    }

    let bytes: Uint8Array;

    try {
      bytes =
        response.body === null ? new Uint8Array() : await readCapped(response.body, CIMD_MAX_BYTES);
    } catch {
      return refused(
        clientId,
        'too_large',
        `The metadata document is over ${String(CIMD_MAX_BYTES)} bytes.`,
      );
    }

    let json: unknown;

    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return refused(clientId, 'not_json', 'The metadata document is not JSON.');
    }

    const parsed = metadataDocument.safeParse(json);

    if (!parsed.success) {
      return refused(
        clientId,
        'invalid_document',
        'The metadata document is missing a required field.',
      );
    }

    const document = parsed.data;

    if (document.client_id !== clientId) {
      return refused(clientId, 'client_id_mismatch', 'The document names a different client id.');
    }

    if (!document.redirect_uris.every(isAllowedRedirect)) {
      return refused(clientId, 'invalid_document', 'A redirect URI is not https or loopback http.');
    }

    const client = await clients.cacheMetadata({
      clientId,
      name: document.client_name,
      redirectUris: document.redirect_uris,
      fetchedAt: at,
      cacheUntil,
      ...(etag === undefined ? {} : { etag }),
    });

    return { kind: 'ok', client };
  }

  return {
    async resolve(clientId) {
      const url = parseClientIdUrl(clientId);

      if (url !== undefined) {
        return resolveDocument(clientId, url);
      }

      if (parseUrl(clientId)?.protocol === 'https:') {
        return refused(clientId, 'invalid_client_id', 'The client id is not a valid metadata URL.');
      }

      return resolveRegistered(clientId);
    },
  };
}
