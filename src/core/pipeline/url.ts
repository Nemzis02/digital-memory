import { logger } from '../logging/logger.ts';

const log = logger.child({ module: 'pipeline/url' });

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'digital-memory/0.1 (+personal archive bot)';

export interface FetchedPage {
  url: string;
  contentType: string;
  body: Uint8Array;
}

export interface UrlFetcher {
  fetch(url: string): Promise<FetchedPage>;
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  const reader = body.getReader();

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`Page exceeds ${String(MAX_BYTES)} bytes`);
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

export function createUrlFetcher(impl: typeof fetch = fetch): UrlFetcher {
  return {
    async fetch(url) {
      const target = new URL(url);

      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new TypeError(`Refusing to fetch ${target.protocol}`);
      }

      const response = await impl(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'text/html,application/xhtml+xml,text/plain', 'user-agent': USER_AGENT },
      });

      if (!response.ok) {
        throw new Error(`${target.origin} answered ${String(response.status)}`);
      }

      const body = response.body === null ? new Uint8Array() : await readCapped(response.body);

      log.debug('fetched', { host: target.host, bytes: body.byteLength });

      return {
        url: response.url === '' ? target.href : response.url,
        contentType: response.headers.get('content-type') ?? 'text/html',
        body,
      };
    },
  };
}
