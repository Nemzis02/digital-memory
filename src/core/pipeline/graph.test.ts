import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '../ingestion/inbound.ts';
import type { Embeddings } from '../llm/embeddings.ts';
import { embedSparse } from '../llm/embeddings.ts';
import type { ChatModel, CompletionRequest, LlmRouter, ModelRole } from '../llm/router.ts';
import { chunkId, memoryId } from '../memory/id.ts';
import type { ObjectStorage, UploadInput } from '../storage/object-storage.ts';
import { DENSE_VECTOR_SIZE } from '../vector/vector-store.ts';
import type { MemoryRecord, VectorStore } from '../vector/vector-store.ts';
import { createIngestionPipeline } from './graph.ts';
import type { FetchedPage, UrlFetcher } from './url.ts';

const NOW = new Date('2026-10-12T09:30:00Z');

const ARTICLE = `<html><head><title>Cita previa</title></head><body><article>${Array.from(
  { length: 12 },
  (_, index) =>
    `<p>Paragraph ${String(index)} explaining how to book a cita previa for the TIE in Valencia, at length.</p>`,
).join('')}</article></body></html>`;

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    sourceRef: '10',
    chatRef: '7',
    userRef: '42',
    type: 'text',
    text: 'tapas at Bar Pepe on Calle Mayor',
    ...overrides,
  };
}

function fakeStorage(): ObjectStorage & { uploads: UploadInput[]; removed: string[] } {
  const uploads: UploadInput[] = [];
  const removed: string[] = [];
  const bodies = new Map<string, Uint8Array>();

  return {
    uploads,
    removed,
    upload(input) {
      uploads.push(input);

      const extension = input.fileName?.split('.').pop() ?? 'bin';
      const key = `documents/2026/10/1111111${uploads.length}-1111-4111-8111-111111111111.${extension}`;

      bodies.set(key, input.body);

      return Promise.resolve({
        key,
        size: input.body.byteLength,
        contentType: input.contentType ?? 'application/octet-stream',
      });
    },
    presignDownload() {
      return Promise.resolve('signed');
    },
    openStream(key) {
      const body = bodies.get(key);

      if (body === undefined) {
        return Promise.reject(new Error(`no object at ${key}`));
      }

      return Promise.resolve(Readable.from([Buffer.from(body)]));
    },
    remove(key) {
      removed.push(key);

      return Promise.resolve();
    },
  };
}

function fakeStore(): VectorStore & { records: MemoryRecord[] } {
  const records: MemoryRecord[] = [];

  return {
    records,
    init() {
      return Promise.resolve();
    },
    upsert(batch) {
      records.push(...batch);

      return Promise.resolve();
    },
    search() {
      return Promise.resolve([]);
    },
    list(query) {
      const parentId = query.filter?.parentId;

      return Promise.resolve(
        records
          .map((record) => record.payload)
          .filter((payload) => payload.chunking.parent_id === parentId),
      );
    },
    fetch(ids) {
      return Promise.resolve(
        records.map((record) => record.payload).filter((payload) => ids.includes(payload.id)),
      );
    },
    remove() {
      return Promise.resolve();
    },
  };
}

function fakeEmbeddings(): Embeddings & { batches: readonly string[][] } {
  const batches: string[][] = [];

  return {
    batches,
    embed(text) {
      return Promise.resolve(Array.from({ length: DENSE_VECTOR_SIZE }, () => text.length));
    },
    embedMany(texts) {
      batches.push([...texts]);

      return Promise.resolve(
        texts.map((text) => Array.from({ length: DENSE_VECTOR_SIZE }, () => text.length)),
      );
    },
    embedSparse,
  };
}

function fakeRouter(): LlmRouter & { requests: CompletionRequest[]; reply: { text: string } } {
  const requests: CompletionRequest[] = [];
  const reply = { text: 'transcribed words' };

  const model: ChatModel = {
    id: 'fake-fast',
    complete(request) {
      requests.push(request);

      return Promise.resolve(reply.text);
    },
    object(request, schema) {
      requests.push(request);

      return Promise.resolve(
        schema.parse({
          summary: 'Tapas at Bar Pepe.',
          category: 'food',
          kind: 'recommendation',
          location: 'Valencia',
          tags: ['Tapas', '#food', 'bar pepe', 'tapas'],
          eventAt: '2026-11-03',
        }),
      );
    },
  };

  return {
    requests,
    reply,
    model(role: ModelRole) {
      if (role !== 'fast') {
        throw new Error('ingestion never reaches for the strong model');
      }

      return model;
    },
  };
}

function fakeUrls(options: { fail?: boolean; page?: Partial<FetchedPage> } = {}): UrlFetcher & {
  asked: string[];
} {
  const asked: string[] = [];

  return {
    asked,
    fetch(url) {
      asked.push(url);

      if (options.fail === true) {
        return Promise.reject(new Error('503'));
      }

      return Promise.resolve({
        url,
        contentType: 'text/html; charset=utf-8',
        body: new TextEncoder().encode(ARTICLE),
        ...options.page,
      });
    },
  };
}

function harness(options: Parameters<typeof fakeUrls>[0] = {}) {
  const files = { download: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3, 4]))) };
  const storage = fakeStorage();
  const store = fakeStore();
  const embeddings = fakeEmbeddings();
  const router = fakeRouter();
  const urls = fakeUrls(options);

  const pipeline = createIngestionPipeline({
    files,
    storage,
    store,
    embeddings,
    router,
    urls,
    now: () => NOW,
  });

  return { pipeline, files, storage, store, embeddings, router, urls };
}

describe('createIngestionPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a note, enriches it, and indexes a parent with one child', async () => {
    const { pipeline, storage, store } = harness();

    const result = await pipeline.ingest({ source: 'telegram', message: message() });

    const parentId = memoryId('telegram', '10');

    expect(result).toMatchObject({
      id: parentId,
      summary: 'Tapas at Bar Pepe.',
      category: 'food',
      kind: 'recommendation',
      points: 2,
    });

    expect(result.tags).toEqual(['#tapas', '#bar_pepe']);
    expect(new TextDecoder().decode(storage.uploads[0]?.body)).toBe(message().text);

    const [parent, child] = store.records;

    expect(parent?.payload.chunking).toEqual({ is_child: false });
    expect(parent?.payload.created_at).toBe(Math.floor(NOW.getTime() / 1000));
    expect(parent?.payload.event_at).toBe(Math.floor(Date.parse('2026-11-03T00:00:00Z') / 1000));
    expect(parent?.payload.metadata.location).toBe('Valencia');
    expect(parent?.payload.r2_file_path).toBe(result.key);

    expect(child?.payload.id).toBe(chunkId(parentId, 0));
    expect(child?.payload.chunking).toEqual({ is_child: true, parent_id: parentId });
    expect(child?.payload.summary).toBe('Tapas at Bar Pepe.');
    expect(child?.payload.metadata).toEqual(parent?.payload.metadata);
  });

  it('embeds the repeated text of a single-chunk memory only once', async () => {
    const { pipeline, embeddings, store } = harness();

    await pipeline.ingest({ source: 'telegram', message: message() });

    expect(embeddings.batches).toHaveLength(1);
    expect(embeddings.batches[0]).toHaveLength(1);
    expect(store.records[0]?.dense).toEqual(store.records[1]?.dense);
    expect(store.records[0]?.sparse?.indices.length).toBeGreaterThan(0);
  });

  it('leads the embedded text with the summary so an empty extraction stays searchable', async () => {
    const { pipeline, embeddings } = harness();

    await pipeline.ingest({
      source: 'telegram',
      message: message({
        type: 'document',
        text: '',
        file: { fileId: 'sheet', fileName: 'budget.xlsx', mimeType: 'application/vnd.ms-excel' },
      }),
    });

    expect(embeddings.batches[0]?.[0]).toBe('Tapas at Bar Pepe. Valencia #tapas #bar_pepe');
  });

  it('scrapes a link, keeps the address, and splits the article into several children', async () => {
    const { pipeline, store, urls, storage } = harness();

    const result = await pipeline.ingest({
      source: 'telegram',
      message: message({
        type: 'url',
        text: 'https://example.com/tie',
        sourceUrl: 'https://example.com/tie',
      }),
    });

    expect(urls.asked).toEqual(['https://example.com/tie']);
    expect(storage.uploads[0]?.fileName).toBe('page.html');
    expect(result.points).toBeGreaterThan(2);

    const [parent] = store.records;

    expect(parent?.payload.source_url).toBe('https://example.com/tie');
    expect(parent?.payload.original_text).toContain('Cita previa');
    expect(parent?.payload.original_text).toContain('Paragraph 0');
    expect(parent?.payload.original_text).not.toContain('<p>');

    for (const record of store.records.slice(1)) {
      expect(record.payload.chunking.is_child).toBe(true);
      expect(record.payload.original_text.length).toBeLessThanOrEqual(800);
    }
  });

  it('keeps the link when the page cannot be fetched', async () => {
    const { pipeline, store, storage } = harness({ fail: true });

    await pipeline.ingest({
      source: 'telegram',
      message: message({
        type: 'url',
        text: 'https://example.com/down',
        sourceUrl: 'https://example.com/down',
      }),
    });

    expect(storage.uploads[0]?.fileName).toBe('link.txt');
    expect(store.records[0]?.payload.original_text).toBe('https://example.com/down');
  });

  it('sends a photo to the fast model and keeps the caption alongside the reading', async () => {
    const { pipeline, store, router, files } = harness();

    router.reply.text = 'MENU DEL DIA 12 EUR';

    await pipeline.ingest({
      source: 'telegram',
      message: message({ type: 'photo', text: 'lunch spot', file: { fileId: 'big' } }),
    });

    expect(files.download).toHaveBeenCalledWith('big');

    const vision = router.requests[0];

    expect(vision?.turns[0]?.parts[1]).toMatchObject({
      type: 'file',
      data: new Uint8Array([1, 2, 3, 4]),
    });

    expect(store.records[0]?.payload.original_text).toBe('lunch spot\n\nMENU DEL DIA 12 EUR');
  });

  it('transcribes a voice note through the fast model', async () => {
    const { pipeline, store, router } = harness();

    router.reply.text = 'remember to renew the TIE';

    await pipeline.ingest({
      source: 'telegram',
      message: message({
        type: 'voice',
        text: '',
        file: { fileId: 'voc', mimeType: 'audio/ogg' },
      }),
    });

    expect(router.requests[0]?.system).toContain('transcribe');
    expect(store.records[0]?.payload.original_text).toBe('remember to renew the TIE');
  });

  it('decodes a text document without a model call and reads a pdf with one', async () => {
    const plain = harness();

    await plain.pipeline.ingest({
      source: 'telegram',
      message: message({
        type: 'document',
        text: '',
        file: { fileId: 'txt', fileName: 'notes.txt', mimeType: 'text/plain' },
      }),
    });

    expect(plain.router.requests).toHaveLength(1);

    const pdf = harness();

    pdf.router.reply.text = 'TIE appointment confirmation';

    await pdf.pipeline.ingest({
      source: 'telegram',
      message: message({
        type: 'document',
        text: '',
        file: { fileId: 'pdf', fileName: 'cita.pdf', mimeType: 'application/pdf' },
      }),
    });

    expect(pdf.router.requests).toHaveLength(2);
    expect(pdf.store.records[0]?.payload.original_text).toBe('TIE appointment confirmation');
  });

  it('tells today to the model so a relative date can be resolved', async () => {
    const { pipeline, router } = harness();

    await pipeline.ingest({ source: 'telegram', message: message() });

    expect(router.requests[0]?.system).toContain('Today is 2026-10-12.');
  });

  it('rejects a message with no source_ref and a link with no address', async () => {
    const { pipeline, storage } = harness();

    await expect(
      pipeline.ingest({ source: 'telegram', message: message({ sourceRef: '  ' }) }),
    ).rejects.toThrow(/source_ref/);

    await expect(
      pipeline.ingest({ source: 'mcp', message: message({ type: 'url' }) }),
    ).rejects.toThrow(/must carry its link/);

    expect(storage.uploads).toEqual([]);
  });

  it('fails a file-backed message that carries no file', async () => {
    const { pipeline } = harness();

    await expect(
      pipeline.ingest({ source: 'telegram', message: message({ type: 'voice', text: '' }) }),
    ).rejects.toThrow(/has no file to download/);
  });

  it('gives the same message the same point ids on a retry', async () => {
    const { pipeline, store } = harness();
    const input = { source: 'telegram' as const, message: message() };

    await pipeline.ingest(input);
    await pipeline.ingest(input);

    const ids = store.records.map((record) => record.payload.id);

    expect(new Set(ids).size).toBe(2);
    expect(ids).toHaveLength(4);
  });

  it('undoes an ingestion by removing the parent, its children, and the object', async () => {
    const { pipeline, store, storage } = harness();

    const result = await pipeline.ingest({ source: 'telegram', message: message() });
    const removals = vi.spyOn(store, 'remove');

    await expect(pipeline.undo({ source: 'telegram', sourceRef: '10' })).resolves.toBe(true);

    expect(removals.mock.calls[0]?.[0]).toEqual([result.id, chunkId(result.id, 0)]);
    expect(storage.removed).toEqual([result.key]);
  });

  it('reports nothing to undo for a message that was never ingested', async () => {
    const { pipeline, storage } = harness();

    await expect(pipeline.undo({ source: 'telegram', sourceRef: '99' })).resolves.toBe(false);
    expect(storage.removed).toEqual([]);
  });

  it('creates the collection on init and needs no checkpointer', async () => {
    const { pipeline, store } = harness();
    const init = vi.spyOn(store, 'init');

    await pipeline.init();

    expect(init).toHaveBeenCalledTimes(1);
  });
});
