import type { Schemas } from '@qdrant/js-client-rest';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Env } from '../../config/env.ts';
import { getEnv } from '../../config/env.ts';
import { logger } from '../logging/logger.ts';
import type { MemoryPayload } from '../memory/payload.ts';
import { parseMemoryPayload } from '../memory/payload.ts';
import type {
  ListQuery,
  MemoryFilter,
  MemoryRecord,
  SearchHit,
  SearchQuery,
  VectorStore,
} from './vector-store.ts';
import { DENSE_VECTOR_SIZE } from './vector-store.ts';

const log = logger.child({ module: 'vector/qdrant' });

export const DENSE_VECTOR = 'dense';
export const SPARSE_VECTOR = 'bm25_v2';
const SPARSE_CONFIG = { modifier: 'idf' } as const;
const DEFAULT_LIMIT = 10;

// Qdrant computes BM25 server-side. The options are pinned so every write and query agrees;
// a lower avg_len lets a one-word memory outrank real hits on a filler word.
const BM25 = {
  model: 'qdrant/bm25',
  options: { k: 1.2, b: 0.75, avg_len: 256 } satisfies Schemas['Bm25Config'],
} as const;

export function sparseDocument(text: string): Schemas['Document'] {
  if (text.trim().length === 0) {
    throw new TypeError('Cannot embed blank text');
  }

  return { text, ...BM25 };
}

const PREFETCH_FACTOR = 4;

const PAYLOAD_INDEXES = {
  type: 'keyword',
  source: 'keyword',
  source_ref: 'keyword',
  source_url: 'keyword',
  'metadata.category': 'keyword',
  'metadata.kind': 'keyword',
  'metadata.location': 'keyword',
  'metadata.tags': 'keyword',
  'chunking.is_child': 'bool',
  'chunking.parent_id': 'uuid',
  created_at: 'integer',
  event_at: 'integer',
} as const satisfies Record<string, Schemas['PayloadFieldSchema']>;

function toFilter(filter: MemoryFilter | undefined): Schemas['Filter'] | undefined {
  if (filter === undefined) {
    return undefined;
  }

  const must: Schemas['Condition'][] = [];

  if (filter.sources !== undefined && filter.sources.length > 0) {
    must.push({ key: 'source', match: { any: filter.sources } });
  }

  if (filter.sourceRef !== undefined) {
    must.push({ key: 'source_ref', match: { value: filter.sourceRef } });
  }

  if (filter.types !== undefined && filter.types.length > 0) {
    must.push({ key: 'type', match: { any: filter.types } });
  }

  if (filter.categories !== undefined && filter.categories.length > 0) {
    must.push({ key: 'metadata.category', match: { any: filter.categories } });
  }

  if (filter.kinds !== undefined && filter.kinds.length > 0) {
    must.push({ key: 'metadata.kind', match: { any: filter.kinds } });
  }

  if (filter.tags !== undefined && filter.tags.length > 0) {
    must.push({ key: 'metadata.tags', match: { any: filter.tags } });
  }

  if (filter.location !== undefined) {
    must.push({ key: 'metadata.location', match: { value: filter.location } });
  }

  if (filter.sourceUrl !== undefined) {
    must.push({ key: 'source_url', match: { value: filter.sourceUrl } });
  }

  if (filter.isChild !== undefined) {
    must.push({ key: 'chunking.is_child', match: { value: filter.isChild } });
  }

  if (filter.parentId !== undefined) {
    must.push({ key: 'chunking.parent_id', match: { value: filter.parentId } });
  }

  if (filter.createdAfter !== undefined || filter.createdBefore !== undefined) {
    must.push({
      key: 'created_at',
      range: { gte: filter.createdAfter ?? null, lte: filter.createdBefore ?? null },
    });
  }

  if (filter.eventAfter !== undefined || filter.eventBefore !== undefined) {
    must.push({
      key: 'event_at',
      range: { gte: filter.eventAfter ?? null, lte: filter.eventBefore ?? null },
    });
  }

  return must.length > 0 ? { must } : undefined;
}

export function createQdrantStore(env: Env = getEnv()): VectorStore {
  const collection = env.QDRANT_COLLECTION;

  const client = new QdrantClient({
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
    timeout: 30_000,
  });

  return {
    async init() {
      const { exists } = await client.collectionExists(collection);

      if (!exists) {
        await client.createCollection(collection, {
          vectors: { [DENSE_VECTOR]: { size: DENSE_VECTOR_SIZE, distance: 'Cosine' } },
          sparse_vectors: { [SPARSE_VECTOR]: SPARSE_CONFIG },
        });

        log.info('collection created', { collection, size: DENSE_VECTOR_SIZE });
      } else {
        const { config } = await client.getCollection(collection);

        if (!(SPARSE_VECTOR in (config.params.sparse_vectors ?? {}))) {
          await client.createVectorName(collection, SPARSE_VECTOR, { sparse: SPARSE_CONFIG });

          log.info('sparse vector added', { collection, name: SPARSE_VECTOR });
        }
      }

      for (const [field_name, field_schema] of Object.entries(PAYLOAD_INDEXES)) {
        await client.createPayloadIndex(collection, { field_name, field_schema, wait: true });
      }
    },

    async upsert(records) {
      if (records.length === 0) {
        return;
      }

      const points = records.map((record: MemoryRecord) => {
        const payload = parseMemoryPayload(record.payload);

        if (record.dense.length !== DENSE_VECTOR_SIZE) {
          throw new TypeError(
            `Embedding width ${record.dense.length} does not match the collection's ${DENSE_VECTOR_SIZE}`,
          );
        }

        const vector = {
          [DENSE_VECTOR]: record.dense,
          [SPARSE_VECTOR]: sparseDocument(record.text),
        };

        return { id: payload.id, vector, payload };
      });

      await client.upsert(collection, { wait: true, points });

      log.debug('memories indexed', { collection, count: points.length });
    },

    async search(query: SearchQuery): Promise<SearchHit[]> {
      const limit = query.limit ?? DEFAULT_LIMIT;
      const filter = toFilter(query.filter);
      const scope = filter === undefined ? {} : { filter };
      const branches: Schemas['Prefetch'][] = [];

      if (query.dense !== undefined) {
        branches.push({ query: { nearest: query.dense }, using: DENSE_VECTOR, ...scope });
      }

      if (query.text !== undefined) {
        branches.push({
          query: { nearest: sparseDocument(query.text) },
          using: SPARSE_VECTOR,
          ...scope,
        });
      }

      const [only] = branches;

      if (only === undefined) {
        throw new TypeError('A search needs a dense vector, a keyword text, or both');
      }

      const request: Schemas['QueryRequest'] =
        branches.length === 1
          ? { ...only, limit }
          : {
              prefetch: branches.map((branch) => ({ ...branch, limit: limit * PREFETCH_FACTOR })),
              query: { fusion: 'rrf' },
              limit,
            };

      const { points } = await client.query(collection, { ...request, with_payload: true });

      return points.map((point) => {
        const payload = parseMemoryPayload(point.payload);

        return { id: payload.id, score: point.score, payload };
      });
    },

    async list(query: ListQuery): Promise<MemoryPayload[]> {
      const filter = toFilter(query.filter);

      const { points } = await client.scroll(collection, {
        limit: query.limit ?? DEFAULT_LIMIT,
        with_payload: true,
        ...(filter === undefined ? {} : { filter }),
        ...(query.orderBy === undefined
          ? {}
          : { order_by: { key: query.orderBy, direction: query.direction ?? 'asc' } }),
      });

      return points.map((point) => parseMemoryPayload(point.payload));
    },

    async fetch(ids): Promise<MemoryPayload[]> {
      if (ids.length === 0) {
        return [];
      }

      const records = await client.retrieve(collection, { ids, with_payload: true });

      return records.map((record) => parseMemoryPayload(record.payload));
    },

    async remove(ids) {
      if (ids.length === 0) {
        return;
      }

      await client.delete(collection, { wait: true, points: ids });

      log.debug('memories removed', { collection, count: ids.length });
    },
  };
}

let shared: VectorStore | undefined;

export function qdrantStore(): VectorStore {
  shared ??= createQdrantStore();

  return shared;
}

export function resetQdrantStore(): void {
  shared = undefined;
}
