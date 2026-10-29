import type { UUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Embeddings } from '../llm/embeddings.ts';
import { chunkId, memoryId } from '../memory/id.ts';
import type { MemoryPayload } from '../memory/payload.ts';
import type { ListQuery, MemoryRecord, VectorStore } from '../vector/vector-store.ts';
import { corpusRowSchema } from './dataset.ts';
import { corpusPayloads, seedCorpus, sweepEval } from './seed.ts';

const dentist = corpusRowSchema.parse({
  key: 'dentist',
  text: 'Dentist with Dr Varga on 2026-11-18 at 10:00.',
  summary: 'Dentist on 2026-11-18 at 10:00',
  metadata: { category: 'health', kind: 'event', location: 'Valencia', tags: ['#dentist'] },
  event_at: '2026-11-18',
});

const tapas = corpusRowSchema.parse({
  key: 'tapas-bar',
  type: 'url',
  text: 'Bar Central serves the best tapas in Valencia.',
  summary: 'Tapas bar in Valencia',
  source_url: 'https://example.com/bar-central',
  metadata: { category: 'food', kind: 'recommendation', tags: ['#tapas'] },
});

function fakeStore(initial: MemoryPayload[] = []) {
  const points = new Map(initial.map((payload) => [payload.id, payload]));
  const upserts: MemoryRecord[][] = [];
  const lists: ListQuery[] = [];

  const store: VectorStore = {
    init: () => Promise.resolve(),
    upsert(records) {
      upserts.push(records);

      for (const record of records) {
        points.set(record.payload.id, record.payload);
      }

      return Promise.resolve();
    },
    search: () => Promise.resolve([]),
    list(query) {
      lists.push(query);

      const page = [...points.values()]
        .filter((payload) => query.filter?.sources?.includes(payload.source) ?? true)
        .slice(0, query.limit);

      return Promise.resolve(page);
    },
    fetch: () => Promise.resolve([]),
    remove(ids) {
      for (const id of ids) {
        points.delete(id);
      }

      return Promise.resolve();
    },
  };

  return { store, points, upserts, lists };
}

const embeddings: Embeddings = {
  embed: () => Promise.reject(new Error('seeding embeds documents only')),
  embedMany: (texts) => Promise.resolve(texts.map((_, index) => [index])),
};

describe('corpusPayloads', () => {
  it('builds an eval parent from the row and one child that copies it', () => {
    const id = memoryId('eval', 'dentist');

    const parent: MemoryPayload = {
      id,
      source: 'eval',
      source_ref: 'dentist',
      type: 'text',
      original_text: dentist.text,
      summary: dentist.summary,
      metadata: dentist.metadata,
      chunking: { is_child: false },
      created_at: 1_700_000_000,
      event_at: Date.UTC(2026, 10, 18) / 1000,
    };

    expect(corpusPayloads(dentist, 1_700_000_000)).toStrictEqual([
      parent,
      { ...parent, id: chunkId(id, 0), chunking: { is_child: true, parent_id: id } },
    ]);
  });

  it('keeps the link of a url row and gives an undated row no event date', () => {
    const [parent] = corpusPayloads(tapas, 0);

    expect(parent?.source_url).toBe('https://example.com/bar-central');
    expect(parent).not.toHaveProperty('event_at');
  });
});

describe('seedCorpus', () => {
  it('upserts every point in one call and maps parent ids to corpus keys', async () => {
    const box = fakeStore();
    const keys = await seedCorpus({ store: box.store, embeddings }, [dentist, tapas], 0);

    expect(keys).toStrictEqual(
      new Map<UUID, string>([
        [memoryId('eval', 'dentist'), 'dentist'],
        [memoryId('eval', 'tapas-bar'), 'tapas-bar'],
      ]),
    );

    expect(box.upserts).toHaveLength(1);

    expect(box.upserts[0]?.map((record) => record.payload.source)).toStrictEqual(
      Array(4).fill('eval'),
    );
  });
});

describe('sweepEval', () => {
  it('pages through the eval points and leaves every other source alone', async () => {
    const [tapasParent] = corpusPayloads(tapas, 0);

    const real: MemoryPayload = {
      ...(tapasParent as MemoryPayload),
      id: memoryId('telegram', 'tapas-bar'),
      source: 'telegram',
    };

    const box = fakeStore([real]);

    await seedCorpus({ store: box.store, embeddings }, [dentist, tapas], 0);

    expect(await sweepEval(box.store)).toBe(4);
    expect([...box.points.values()]).toStrictEqual([real]);
    expect(box.lists.every((query) => query.filter?.sources?.join() === 'eval')).toBe(true);
  });
});
