import type { Schemas } from '@qdrant/js-client-rest';
import { describe, expect, it } from 'vitest';
import type { MemoryPayload } from '../memory/payload.ts';
import { embeddableText } from '../pipeline/nodes/storage.ts';
import { SPARSE_VECTOR, sparseDocument } from './qdrant.ts';
import type { ReindexClient } from './reindex.ts';
import { reindexSparse } from './reindex.ts';

const COLLECTION = 'digital_memory';

const memory = (id: string, summary: string): MemoryPayload => ({
  id: `3f0c6f0e-2d1a-4f6b-9f1e-${id.padStart(12, '0')}` as MemoryPayload['id'],
  source: 'telegram',
  source_ref: '4242',
  type: 'text',
  original_text: `${summary} in Valencia`,
  summary,
  metadata: { category: 'bureaucracy', kind: 'event', tags: ['#cita_previa'] },
  chunking: { is_child: false },
  created_at: 1_772_000_000,
});

interface StoredPoint {
  payload: MemoryPayload;
  vectors: Record<string, unknown>;
}

interface UpdateRequest {
  wait?: boolean;
  points: Schemas['PointVectors'][];
}

function fakeClient(initial: StoredPoint[], { applyUpdates = true } = {}) {
  const points = new Map(initial.map((point) => [point.payload.id, point]));
  const updates: UpdateRequest[] = [];

  const client: ReindexClient = {
    // A real page comes back on a macrotask; a fake that resolves at once would let a runaway
    // loop starve the test timeout and hang the worker instead of failing.
    async scroll(collection, request = {}) {
      await new Promise((resolve) => setImmediate(resolve));
      expect(collection).toBe(COLLECTION);

      const [condition] = request.filter?.must_not as Schemas['HasVectorCondition'][];
      const missing = condition?.has_vector ?? '';

      const page = [...points.values()]
        .filter((point) => !(missing in point.vectors))
        .slice(0, request.limit ?? 10)
        .map((point) => ({ id: point.payload.id, payload: point.payload, vector: null }));

      return { points: page, next_page_offset: null };
    },
    updateVectors(collection, request) {
      expect(collection).toBe(COLLECTION);
      updates.push(request);

      if (applyUpdates) {
        for (const { id, vector } of request.points) {
          const stored = points.get(id as MemoryPayload['id']);

          if (stored !== undefined) {
            Object.assign(stored.vectors, vector);
          }
        }
      }

      return Promise.resolve({ operation_id: 1, status: 'completed' as const });
    },
  };

  return { client, points, updates };
}

const bare = (payload: MemoryPayload): StoredPoint => ({ payload, vectors: { dense: [0.1] } });

describe('reindexSparse', () => {
  it('builds the BM25 document from the stored text and writes it in pages', async () => {
    const payloads = [memory('1', 'Dentist'), memory('2', 'Plumber'), memory('3', 'TIE')];
    const { client, points, updates } = fakeClient(payloads.map(bare));

    const result = await reindexSparse(client, COLLECTION, 2);

    expect(result).toStrictEqual({ updated: 3 });
    expect(updates.map((update) => update.points.length)).toStrictEqual([2, 1]);
    expect(updates.every((update) => update.wait === true)).toBe(true);

    for (const payload of payloads) {
      expect(points.get(payload.id)?.vectors).toStrictEqual({
        dense: [0.1],
        [SPARSE_VECTOR]: sparseDocument(embeddableText(payload)),
      });
    }
  });

  it('changes nothing on a second run', async () => {
    const { client, updates } = fakeClient([bare(memory('1', 'Dentist'))]);

    await reindexSparse(client, COLLECTION);
    updates.length = 0;

    await expect(reindexSparse(client, COLLECTION)).resolves.toStrictEqual({ updated: 0 });
    expect(updates).toHaveLength(0);
  });

  it('skips points that already carry the vector', async () => {
    const done = memory('1', 'Dentist');
    const missing = memory('2', 'Plumber');

    const { client, updates } = fakeClient([
      { payload: done, vectors: { dense: [0.1], [SPARSE_VECTOR]: { indices: [1], values: [1] } } },
      bare(missing),
    ]);

    await expect(reindexSparse(client, COLLECTION)).resolves.toStrictEqual({ updated: 1 });

    expect(updates.flatMap((update) => update.points.map((point) => point.id))).toStrictEqual([
      missing.id,
    ]);
  });

  it('stops instead of looping when an update leaves the points unchanged', async () => {
    const { client, updates } = fakeClient([bare(memory('1', 'Dentist'))], {
      applyUpdates: false,
    });

    await expect(reindexSparse(client, COLLECTION)).rejects.toThrow(/no progress/);
    expect(updates).toHaveLength(1);
  });
});
