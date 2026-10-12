import { describe, expect, it, vi } from 'vitest';
import { createUrlFetcher } from './url.ts';

function page(body: string, init?: ResponseInit & { url?: string }): Response {
  const response = new Response(body, {
    status: init?.status ?? 200,
    headers: init?.headers ?? { 'content-type': 'text/html; charset=utf-8' },
  });

  if (init?.url !== undefined) {
    Object.defineProperty(response, 'url', { value: init.url });
  }

  return response;
}

describe('createUrlFetcher', () => {
  it('sends a timeout and an accept header, and reports the redirected url', async () => {
    const impl = vi.fn<typeof fetch>(async () =>
      page('<html><body>hola</body></html>', { url: 'https://example.com/final' }),
    );

    const fetched = await createUrlFetcher(impl).fetch('https://example.com/a');

    expect(fetched.url).toBe('https://example.com/final');
    expect(fetched.contentType).toBe('text/html; charset=utf-8');
    expect(new TextDecoder().decode(fetched.body)).toBe('<html><body>hola</body></html>');

    const options = impl.mock.calls[0]?.[1];
    const headers = options?.headers as Record<string, string>;

    expect(options?.redirect).toBe('follow');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(headers.accept).toContain('text/html');
  });

  it('refuses a non-http scheme before it reaches the network', async () => {
    const impl = vi.fn<typeof fetch>();

    await expect(createUrlFetcher(impl).fetch('file:///etc/passwd')).rejects.toThrow(
      /Refusing to fetch file:/,
    );

    expect(impl).not.toHaveBeenCalled();
  });

  it('fails on a non-ok status', async () => {
    const impl = vi.fn<typeof fetch>(async () => page('nope', { status: 503, headers: {} }));

    await expect(createUrlFetcher(impl).fetch('https://example.com/a')).rejects.toThrow(
      /answered 503/,
    );
  });

  it('rejects a body larger than the cap without buffering all of it', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        // The fetcher cancels once the cap is passed; without this the stream never settles.
      },
    });

    const impl = vi.fn<typeof fetch>(
      async () => new Response(stream, { headers: { 'content-type': 'text/html' } }),
    );

    await expect(createUrlFetcher(impl).fetch('https://example.com/big')).rejects.toThrow(
      /exceeds 5242880 bytes/,
    );

    expect(sent).toBeLessThan(10);
  });

  it('returns an empty body when the response has none', async () => {
    const impl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    const fetched = await createUrlFetcher(impl).fetch('https://example.com/empty');

    expect(fetched.body).toHaveLength(0);
    expect(fetched.contentType).toBe('text/html');
    expect(fetched.url).toBe('https://example.com/empty');
  });
});
