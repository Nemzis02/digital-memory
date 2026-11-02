import { describe, expect, it } from 'vitest';
import type { MemoryPayload } from '../memory/payload.ts';
import { withTempCollection } from '../../test/integration.ts';
import {
  createQdrantClient,
  createQdrantStore,
  DENSE_VECTOR,
  PAYLOAD_INDEXES,
  SPARSE_VECTOR,
} from './qdrant.ts';
import { DENSE_VECTOR_SIZE } from './vector-store.ts';

const payload: MemoryPayload = {
  id: '3f0c6f0e-2d1a-4f6b-9f1e-8c4b2a7d5e10',
  source: 'telegram',
  source_ref: '4242',
  type: 'text',
  original_text: 'cita previa for the TIE in Valencia',
  summary: 'TIE appointment, Valencia, 3 March',
  metadata: { category: 'bureaucracy', kind: 'event', location: 'Valencia', tags: ['#tie'] },
  chunking: { is_child: false },
  created_at: 1_772_000_000,
  event_at: 1_772_500_000,
};

const dense = new Array<number>(DENSE_VECTOR_SIZE).fill(0).map((_, i) => (i % 7) / 7);

describe('qdrant store', () => {
  it('creates the collection once, with every vector and payload index', async () => {
    await withTempCollection(async (env) => {
      const store = createQdrantStore(env);

      await store.init();
      await store.init();

      const { config, payload_schema } = await createQdrantClient(env).getCollection(
        env.QDRANT_COLLECTION,
      );

      expect(Object.keys(config.params.vectors ?? {})).toEqual([DENSE_VECTOR]);
      expect(Object.keys(config.params.sparse_vectors ?? {})).toEqual([SPARSE_VECTOR]);
      expect(Object.keys(payload_schema).sort()).toEqual(Object.keys(PAYLOAD_INDEXES).sort());
    });
  });

  it('round-trips one memory through upsert, search, fetch and remove', async () => {
    await withTempCollection(async (env) => {
      const store = createQdrantStore(env);

      await store.init();
      await store.ping();

      await store.upsert([
        { payload, dense, text: `${payload.summary}\n\n${payload.original_text}` },
      ]);

      const byText = await store.search({ text: 'cita previa Valencia' });
      const hybrid = await store.search({ dense, text: 'TIE appointment' });
      const filtered = await store.search({ dense, filter: { categories: ['health'] } });

      expect(byText.map((hit) => hit.id)).toEqual([payload.id]);
      expect(hybrid.map((hit) => hit.id)).toEqual([payload.id]);
      expect(filtered).toEqual([]);

      expect(await store.list({ orderBy: 'event_at' })).toEqual([payload]);
      expect(await store.fetch([payload.id])).toEqual([payload]);

      await store.remove([payload.id]);

      expect(await store.fetch([payload.id])).toEqual([]);
    });
  });
});
