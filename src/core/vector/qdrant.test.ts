import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.ts';
import type { MemoryPayload } from '../memory/payload.ts';
import { createQdrantStore, DENSE_VECTOR, SPARSE_VECTOR, sparseDocument } from './qdrant.ts';
import { DENSE_VECTOR_SIZE } from './vector-store.ts';

interface Branch {
  query: unknown;
  using: string;
  filter: unknown;
  limit?: number;
}

interface QueryRequest extends Partial<Branch> {
  prefetch?: Branch[];
  limit: number;
  with_payload: boolean;
}

interface ScrollRequest {
  filter?: unknown;
  limit: number;
  with_payload: boolean;
  order_by?: { key: string; direction: string };
}

interface CollectionInfo {
  config: { params: { sparse_vectors?: Record<string, unknown> } };
}

interface UpsertRequest {
  wait: boolean;
  points: { id: string; vector: Record<string, unknown>; payload: unknown }[];
}

const { api, clientParams } = vi.hoisted(() => ({
  api: {
    collectionExists: vi.fn<(name: string) => Promise<{ exists: boolean }>>(),
    createCollection: vi.fn<(name: string, request: Record<string, unknown>) => Promise<boolean>>(),
    getCollection: vi.fn<(name: string) => Promise<CollectionInfo>>(),
    createVectorName:
      vi.fn<(name: string, vector: string, config: Record<string, unknown>) => Promise<unknown>>(),
    createPayloadIndex:
      vi.fn<(name: string, request: { field_name: string }) => Promise<unknown>>(),
    upsert: vi.fn<(name: string, request: UpsertRequest) => Promise<unknown>>(),
    query: vi.fn<(name: string, request: QueryRequest) => Promise<{ points: unknown[] }>>(),
    scroll: vi.fn<(name: string, request: ScrollRequest) => Promise<{ points: unknown[] }>>(),
    retrieve: vi.fn<(name: string, request: Record<string, unknown>) => Promise<unknown[]>>(),
    delete: vi.fn<(name: string, request: Record<string, unknown>) => Promise<unknown>>(),
  },
  clientParams: [] as Record<string, unknown>[],
}));

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: class {
    collectionExists = api.collectionExists;
    createCollection = api.createCollection;
    getCollection = api.getCollection;
    createVectorName = api.createVectorName;
    createPayloadIndex = api.createPayloadIndex;
    upsert = api.upsert;
    query = api.query;
    scroll = api.scroll;
    retrieve = api.retrieve;
    delete = api.delete;

    constructor(params: Record<string, unknown>) {
      clientParams.push(params);
    }
  },
}));

const env = parseEnv({
  TELEGRAM_BOT_TOKEN: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // gitleaks:allow
  TELEGRAM_ADMIN_ID: '123456789',
  DATABASE_URL: 'postgresql://digital_memory:pw@localhost:5432/digital_memory',
  QDRANT_URL: 'https://example.cloud.qdrant.io:6333',
  QDRANT_API_KEY: 'qdrant-key',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_FAST_API_KEY: 'llm-key',
});

const firstRequest = <T>(calls: [string, T][]): T => {
  const call = calls[0];

  if (call === undefined) {
    throw new Error('expected the client to have been called');
  }

  return call[1];
};

const dense = (fill = 0.1): number[] => new Array<number>(DENSE_VECTOR_SIZE).fill(fill);

const text = 'TIE appointment, Valencia, 3 March\n\ncita previa for the TIE in Valencia';

const payload: MemoryPayload = {
  id: '3f0c6f0e-2d1a-4f6b-9f1e-8c4b2a7d5e10',
  source: 'telegram',
  source_ref: '4242',
  type: 'text',
  original_text: 'cita previa for the TIE in Valencia',
  summary: 'TIE appointment, Valencia, 3 March',
  metadata: {
    category: 'bureaucracy',
    kind: 'event',
    location: 'Valencia',
    tags: ['#cita_previa'],
  },
  chunking: { is_child: false },
  created_at: 1_772_000_000,
  event_at: 1_772_500_000,
};

const hit = { id: payload.id, version: 1, score: 0.87, payload };

describe('createQdrantStore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clientParams.length = 0;

    api.collectionExists.mockResolvedValue({ exists: false });
    api.createCollection.mockResolvedValue(true);

    api.getCollection.mockResolvedValue({
      config: { params: { sparse_vectors: { [SPARSE_VECTOR]: {} } } },
    });

    api.createVectorName.mockResolvedValue({});
    api.createPayloadIndex.mockResolvedValue({});
    api.upsert.mockResolvedValue({});
    api.query.mockResolvedValue({ points: [hit] });
    api.scroll.mockResolvedValue({ points: [{ id: payload.id, payload }] });
    api.retrieve.mockResolvedValue([{ id: payload.id, payload }]);
    api.delete.mockResolvedValue({});
  });

  it('passes the configured URL, key, and collection through', async () => {
    await createQdrantStore(env).init();

    expect(clientParams[0]).toMatchObject({
      url: 'https://example.cloud.qdrant.io:6333',
      apiKey: 'qdrant-key',
    });

    expect(api.createCollection.mock.calls[0]?.[0]).toBe('digital_memory');
  });

  it('creates a hybrid collection whose sparse side applies IDF server-side', async () => {
    await createQdrantStore(env).init();

    expect(firstRequest(api.createCollection.mock.calls)).toStrictEqual({
      vectors: { [DENSE_VECTOR]: { size: DENSE_VECTOR_SIZE, distance: 'Cosine' } },
      sparse_vectors: { [SPARSE_VECTOR]: { modifier: 'idf' } },
    });
  });

  it('indexes every field the pipeline filters on, nested ones included', async () => {
    await createQdrantStore(env).init();

    const indexed = api.createPayloadIndex.mock.calls.map((call) => call[1].field_name);

    expect(indexed).toContain('metadata.tags');
    expect(indexed).toContain('chunking.parent_id');
    expect(indexed).toContain('created_at');
    expect(indexed).toContain('event_at');
  });

  it('still ensures the payload indexes when the collection already exists', async () => {
    api.collectionExists.mockResolvedValue({ exists: true });

    await createQdrantStore(env).init();

    expect(api.createCollection).not.toHaveBeenCalled();
    expect(api.createVectorName).not.toHaveBeenCalled();
    expect(api.createPayloadIndex).toHaveBeenCalled();
  });

  it('adds the sparse vector to a collection that predates it', async () => {
    api.collectionExists.mockResolvedValue({ exists: true });
    api.getCollection.mockResolvedValue({ config: { params: { sparse_vectors: { bm25: {} } } } });

    await createQdrantStore(env).init();

    expect(api.createVectorName.mock.calls[0]).toStrictEqual([
      'digital_memory',
      SPARSE_VECTOR,
      { sparse: { modifier: 'idf' } },
    ]);
  });

  it('does not read the config of a collection it just created', async () => {
    await createQdrantStore(env).init();

    expect(api.getCollection).not.toHaveBeenCalled();
    expect(api.createVectorName).not.toHaveBeenCalled();
  });

  it('writes the UUID as the point id and hands the text to the BM25 model', async () => {
    await createQdrantStore(env).upsert([{ payload, dense: dense(), text }]);

    expect(firstRequest(api.upsert.mock.calls)).toStrictEqual({
      wait: true,
      points: [
        {
          id: payload.id,
          vector: {
            [DENSE_VECTOR]: dense(),
            [SPARSE_VECTOR]: {
              text,
              model: 'qdrant/bm25',
              options: { k: 1.2, b: 0.75, avg_len: 256 },
            },
          },
          payload,
        },
      ],
    });
  });

  it('refuses blank keyword text before spending a request', async () => {
    const store = createQdrantStore(env);

    await expect(store.upsert([{ payload, dense: dense(), text: ' \n ' }])).rejects.toThrow(
      /blank text/,
    );

    await expect(store.search({ dense: dense(), text: '' })).rejects.toThrow(/blank text/);
    expect(api.upsert).not.toHaveBeenCalled();
    expect(api.query).not.toHaveBeenCalled();
  });

  it('rejects a payload the store could not filter on before it is written', async () => {
    const broken = { ...payload, metadata: { ...payload.metadata, category: 'sports' } };

    await expect(
      createQdrantStore(env).upsert([{ payload: broken as MemoryPayload, dense: dense(), text }]),
    ).rejects.toThrow(TypeError);

    expect(api.upsert).not.toHaveBeenCalled();
  });

  it('rejects an embedding of the wrong width instead of letting Qdrant 400', async () => {
    await expect(
      createQdrantStore(env).upsert([{ payload, dense: [0.1, 0.2], text }]),
    ).rejects.toThrow(/does not match/);

    expect(api.upsert).not.toHaveBeenCalled();
  });

  it('skips the round trip for an empty batch', async () => {
    const store = createQdrantStore(env);

    await store.upsert([]);
    await store.remove([]);

    await expect(store.fetch([])).resolves.toStrictEqual([]);
    expect(api.upsert).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.retrieve).not.toHaveBeenCalled();
  });

  it('fuses the two branches with RRF and over-fetches each one', async () => {
    const hits = await createQdrantStore(env).search({ dense: dense(), text: 'cita', limit: 5 });

    expect(firstRequest(api.query.mock.calls)).toStrictEqual({
      prefetch: [
        { query: { nearest: dense() }, using: DENSE_VECTOR, limit: 20 },
        { query: { nearest: sparseDocument('cita') }, using: SPARSE_VECTOR, limit: 20 },
      ],
      query: { fusion: 'rrf' },
      limit: 5,
      with_payload: true,
    });

    expect(hits).toStrictEqual([{ id: payload.id, score: 0.87, payload }]);
  });

  it('repeats the filter on every branch, since fusion only merges what each returned', async () => {
    await createQdrantStore(env).search({
      dense: dense(),
      text: 'paella',
      filter: { categories: ['food'], tags: ['#paella'], createdAfter: 1_700_000_000 },
    });

    const expected = {
      must: [
        { key: 'metadata.category', match: { any: ['food'] } },
        { key: 'metadata.tags', match: { any: ['#paella'] } },
        { key: 'created_at', range: { gte: 1_700_000_000, lte: null } },
      ],
    };

    const { prefetch } = firstRequest(api.query.mock.calls);

    expect(prefetch?.[0]?.filter).toStrictEqual(expected);
    expect(prefetch?.[1]?.filter).toStrictEqual(expected);
  });

  it('turns an upcoming-events query into a range that undated records cannot match', async () => {
    await createQdrantStore(env).search({
      dense: dense(),
      filter: { kinds: ['event', 'task'], eventAfter: 1_772_000_000 },
    });

    expect(firstRequest(api.query.mock.calls).filter).toStrictEqual({
      must: [
        { key: 'metadata.kind', match: { any: ['event', 'task'] } },
        { key: 'event_at', range: { gte: 1_772_000_000, lte: null } },
      ],
    });
  });

  it('filters by source url so a re-sent link can be found before it is stored twice', async () => {
    await createQdrantStore(env).search({
      dense: dense(),
      filter: { sourceUrl: 'https://example.test/article' },
    });

    expect(firstRequest(api.query.mock.calls).filter).toStrictEqual({
      must: [{ key: 'source_url', match: { value: 'https://example.test/article' } }],
    });
  });

  it('searches a single branch directly so the similarity score survives', async () => {
    await createQdrantStore(env).search({ dense: dense(), filter: { isChild: true } });

    expect(firstRequest(api.query.mock.calls)).toStrictEqual({
      query: { nearest: dense() },
      using: DENSE_VECTOR,
      filter: { must: [{ key: 'chunking.is_child', match: { value: true } }] },
      limit: 10,
      with_payload: true,
    });
  });

  it('refuses a search with neither vector', async () => {
    await expect(createQdrantStore(env).search({ filter: { types: ['voice'] } })).rejects.toThrow(
      TypeError,
    );

    expect(api.query).not.toHaveBeenCalled();
  });

  it('drops a filter that narrows nothing', async () => {
    await createQdrantStore(env).search({ dense: dense(), filter: { tags: [] } });

    expect(firstRequest(api.query.mock.calls).filter).toBeUndefined();
  });

  it('validates payloads coming back out of the collection', async () => {
    api.query.mockResolvedValue({ points: [{ ...hit, payload: { id: 'not-a-uuid' } }] });

    await expect(createQdrantStore(env).search({ dense: dense() })).rejects.toThrow(
      /Invalid memory payload/,
    );
  });

  it('answers a recall-by-filter query without an embedding, in event order', async () => {
    const upcoming = await createQdrantStore(env).list({
      filter: { kinds: ['event'], eventAfter: 1_772_000_000 },
      orderBy: 'event_at',
      limit: 20,
    });

    expect(firstRequest(api.scroll.mock.calls)).toStrictEqual({
      limit: 20,
      with_payload: true,
      filter: {
        must: [
          { key: 'metadata.kind', match: { any: ['event'] } },
          { key: 'event_at', range: { gte: 1_772_000_000, lte: null } },
        ],
      },
      order_by: { key: 'event_at', direction: 'asc' },
    });

    expect(upcoming).toStrictEqual([payload]);
    expect(api.query).not.toHaveBeenCalled();
  });

  it('finds the point a redelivered message would overwrite', async () => {
    await createQdrantStore(env).list({ filter: { sources: ['telegram'], sourceRef: '4242' } });

    expect(firstRequest(api.scroll.mock.calls).filter).toStrictEqual({
      must: [
        { key: 'source', match: { any: ['telegram'] } },
        { key: 'source_ref', match: { value: '4242' } },
      ],
    });
  });

  it('fetches parents by id and deletes by id', async () => {
    const store = createQdrantStore(env);

    await expect(store.fetch([payload.id])).resolves.toStrictEqual([payload]);

    expect(firstRequest(api.retrieve.mock.calls)).toStrictEqual({
      ids: [payload.id],
      with_payload: true,
    });

    await store.remove([payload.id]);

    expect(firstRequest(api.delete.mock.calls)).toStrictEqual({
      wait: true,
      points: [payload.id],
    });
  });
});
