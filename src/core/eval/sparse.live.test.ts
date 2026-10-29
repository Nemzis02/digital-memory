import type { UUID } from 'node:crypto';
import type { Schemas } from '@qdrant/js-client-rest';
import { QdrantClient } from '@qdrant/js-client-rest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '../../config/env.ts';
import { embeddings } from '../llm/embeddings.ts';
import { parseMemoryPayload } from '../memory/payload.ts';
import { embeddableText } from '../pipeline/nodes/storage.ts';
import { createQdrantStore, DENSE_VECTOR, SPARSE_VECTOR } from '../vector/qdrant.ts';
import { DENSE_VECTOR_SIZE } from '../vector/vector-store.ts';
import { loadDataset } from './dataset.ts';
import { recallAtK } from './score.ts';
import { seedCorpus } from './seed.ts';

// Compares the retired hashed sparse vector with Qdrant's server-side BM25 on the golden set.
// It writes only to a temporary collection, never to QDRANT_COLLECTION.

const KEYS = ['LLM_FAST_API_KEY', 'QDRANT_API_KEY'] as const;

const live =
  process.env.LLM_LIVE === '1' && KEYS.every((key) => (process.env[key]?.length ?? 0) > 0);

const K = 5;
const LIMIT = 10;
const PREFETCH_LIMIT = 40;
const BATCH = 64;
const SEED_TIMEOUT = 180_000;
const CASE_TIMEOUT = 30_000;
const BM25_MODEL = 'qdrant/bm25';
const HASHED_VECTOR = 'bm25';

const dataset = await loadDataset();

function fnv1a(token: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

// The baseline this harness measures against: the hashed term count the bot used to index.
function hashedSparse(text: string): Schemas['SparseVector'] {
  const counts = new Map<number, number>();

  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const index = fnv1a(match[0]);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }

  const indices = [...counts.keys()].sort((a, b) => a - b);

  return { indices, values: indices.map((index) => counts.get(index) ?? 0) };
}

type Bm25Options = Schemas['Bm25Config'];

interface Variant {
  name: string;
  using: string;
  options?: Bm25Options;
}

const variants: Variant[] = [
  { name: 'hashed', using: HASHED_VECTOR },
  { name: 'bm25', using: SPARSE_VECTOR, options: {} },
  { name: 'bm25-avg-len', using: 'bm25_v2_len', options: {} },
];

const MODES = ['sparse', 'hybrid'] as const;

type Mode = (typeof MODES)[number];

const scores: Record<string, Record<string, number>> = {};

// Recall@5 cannot see a short junk memory ranked first, so the sparse top hit is kept too.
const tops: Record<string, Record<string, string>> = {};

function renderTops(): string {
  return dataset.retrieval
    .flatMap(({ key }) => {
      const row = variants.map(({ name }) => `${name}=${tops[key]?.[name] ?? '-'}`);

      return new Set(Object.values(tops[key] ?? {})).size > 1
        ? [`  ${key}: ${row.join(', ')}`]
        : [];
    })
    .join('\n');
}

function column(variant: Variant, mode: Mode): string {
  return `${variant.name}/${mode}`;
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function sparseQuery(variant: Variant, query: string): Schemas['VectorInput'] {
  if (variant.options === undefined) {
    return hashedSparse(query);
  }

  return { text: query, model: BM25_MODEL, options: variant.options };
}

function renderTable(): string {
  const columns = variants.flatMap((variant) => MODES.map((mode) => column(variant, mode)));
  const keys = dataset.retrieval.map(({ key }) => key);
  const width = Math.max(...keys.map((key) => key.length), 'total'.length) + 2;

  const cell = (value: number) =>
    value.toFixed(2).padStart(Math.max(...columns.map((c) => c.length)) + 2);

  const row = (key: string, values: number[], mark: string) =>
    `${mark} ${key.padEnd(width)}${values.map(cell).join('')}`;

  const header = `  ${''.padEnd(width)}${columns.map((c) => c.padStart(cell(0).length)).join('')}`;

  const lines = keys.map((key) => {
    const values = columns.map((c) => scores[key]?.[c] ?? 0);

    return row(key, values, new Set(values).size > 1 ? '*' : ' ');
  });

  const totals = columns.map(
    (c) => keys.reduce((sum, key) => sum + (scores[key]?.[c] ?? 0), 0) / keys.length,
  );

  return [header, ...lines, row('total', totals, ' ')].join('\n');
}

describe.skipIf(!live)('sparse encoder comparison', () => {
  let client: QdrantClient;
  let collection: string;
  let filter: Schemas['Filter'];
  let keyById = new Map<UUID, string>();

  beforeAll(async () => {
    const env = getEnv();

    collection = `${env.QDRANT_COLLECTION}_sparse_eval`;
    client = new QdrantClient({ url: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY, timeout: 30_000 });

    const { version } = await client.versionInfo();

    process.stdout.write(`\nqdrant ${version}, collection ${collection}\n`);

    await client.deleteCollection(collection);

    await client.createCollection(collection, {
      vectors: { [DENSE_VECTOR]: { size: DENSE_VECTOR_SIZE, distance: 'Cosine' } },
      sparse_vectors: Object.fromEntries(
        variants.map((variant) => [variant.using, { modifier: 'idf' as const }]),
      ),
    });

    const store = createQdrantStore({ ...env, QDRANT_COLLECTION: collection });

    await store.init();
    keyById = await seedCorpus({ store, embeddings: embeddings() }, dataset.corpus);

    const { points } = await client.scroll(collection, { limit: 1024, with_payload: true });
    const payloads = points.map((point) => parseMemoryPayload(point.payload));
    const children = payloads.filter((payload) => payload.chunking.is_child);

    const avgLen =
      children.reduce((sum, payload) => sum + wordCount(embeddableText(payload)), 0) /
      children.length;

    const withLength = variants.find((variant) => variant.name === 'bm25-avg-len');

    if (withLength !== undefined) {
      withLength.options = { avg_len: avgLen };
    }

    process.stdout.write(`points ${String(points.length)}, avg_len ${avgLen.toFixed(1)}\n`);

    for (let start = 0; start < payloads.length; start += BATCH) {
      await client.updateVectors(collection, {
        wait: true,
        points: payloads.slice(start, start + BATCH).map((payload) => ({
          id: payload.id,
          vector: Object.fromEntries(
            variants.map(({ using, options }): [string, Schemas['Vector']] => [
              using,
              options === undefined
                ? hashedSparse(embeddableText(payload))
                : { text: embeddableText(payload), model: BM25_MODEL, options },
            ]),
          ),
        })),
      });
    }

    filter = {
      must: [
        { key: 'source', match: { any: ['eval'] } },
        { key: 'chunking.is_child', match: { value: true } },
      ],
    };
  }, SEED_TIMEOUT);

  afterAll(async () => {
    process.stdout.write(`\nrecall@${String(K)}, * marks a case where the columns differ\n`);
    process.stdout.write(`${renderTable()}\n\n`);
    process.stdout.write(`sparse top hit, where the variants differ\n${renderTops()}\n\n`);

    await client.deleteCollection(collection);

    expect((await client.collectionExists(collection)).exists).toBe(false);
  }, SEED_TIMEOUT);

  async function retrievedKeys(request: Schemas['QueryRequest']): Promise<string[]> {
    const { points } = await client.query(collection, { ...request, with_payload: true });
    const keys: string[] = [];

    for (const point of points) {
      const parentId = parseMemoryPayload(point.payload).chunking.parent_id;
      const key = parentId === undefined ? undefined : (keyById.get(parentId) ?? parentId);

      if (key !== undefined && !keys.includes(key)) {
        keys.push(key);
      }
    }

    return keys;
  }

  it.each(dataset.retrieval)(
    '$key',
    async ({ key, query, expected }) => {
      const dense = await embeddings().embed(query, 'query');
      const row: Record<string, number> = {};
      const top: Record<string, string> = {};

      for (const variant of variants) {
        const sparse = {
          query: { nearest: sparseQuery(variant, query) },
          using: variant.using,
          filter,
        };

        const requests: Record<Mode, Schemas['QueryRequest']> = {
          sparse: { ...sparse, limit: LIMIT },
          hybrid: {
            prefetch: [
              { query: { nearest: dense }, using: DENSE_VECTOR, filter, limit: PREFETCH_LIMIT },
              { ...sparse, limit: PREFETCH_LIMIT },
            ],
            query: { fusion: 'rrf' },
            limit: LIMIT,
          },
        };

        for (const mode of MODES) {
          const keys = await retrievedKeys(requests[mode]);

          row[column(variant, mode)] = recallAtK(keys, expected, K);

          if (mode === 'sparse') {
            top[variant.name] = keys[0] ?? '-';
          }
        }
      }

      scores[key] = row;
      tops[key] = top;
    },
    CASE_TIMEOUT,
  );
});
