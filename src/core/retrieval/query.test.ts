import { describe, expect, it } from 'vitest';
import type { MemoryPayload } from '../memory/payload.ts';
import type { ListQuery, VectorStore } from '../vector/vector-store.ts';
import { recall } from './query.ts';

const parent: MemoryPayload = {
  id: '3f0c6f0e-2d1a-4f6b-9f1e-8c4b2a7d5e10',
  source: 'telegram',
  source_ref: '4242',
  type: 'text',
  original_text: 'dentist Tuesday',
  summary: 'Dentist on Tuesday',
  metadata: { category: 'health', kind: 'event', tags: ['#dentist'] },
  chunking: { is_child: false },
  created_at: 1_772_000_000,
  event_at: 1_772_100_000,
};

function recordingStore(results: readonly MemoryPayload[] = [parent]): VectorStore & {
  lists: ListQuery[];
  searches: number;
} {
  const lists: ListQuery[] = [];
  const seen = { searches: 0 };

  return {
    lists,
    get searches() {
      return seen.searches;
    },
    init() {
      return Promise.resolve();
    },
    upsert() {
      return Promise.resolve();
    },
    search() {
      seen.searches += 1;

      return Promise.resolve([]);
    },
    list(query) {
      lists.push(query);

      return Promise.resolve([...results]);
    },
    fetch() {
      return Promise.resolve([]);
    },
    remove() {
      return Promise.resolve();
    },
  };
}

describe('recall', () => {
  it('lists upcoming parents in event order and does not search', async () => {
    const store = recordingStore();

    await expect(
      recall(store, {
        kinds: ['event'],
        eventAfter: 1_772_000_000,
        orderBy: 'event_at',
        direction: 'asc',
      }),
    ).resolves.toStrictEqual([parent]);

    expect(store.lists).toStrictEqual([
      {
        filter: { isChild: false, kinds: ['event'], eventAfter: 1_772_000_000 },
        orderBy: 'event_at',
        direction: 'asc',
      },
    ]);

    expect(store.searches).toBe(0);
  });

  it('maps a created-range listing onto the filter', async () => {
    const store = recordingStore();

    await recall(store, {
      categories: ['finance'],
      tags: ['#receipt'],
      types: ['document'],
      location: 'Valencia',
      createdAfter: 1_700_000_000,
      createdBefore: 1_800_000_000,
      orderBy: 'created_at',
      direction: 'desc',
    });

    expect(store.lists).toStrictEqual([
      {
        filter: {
          isChild: false,
          categories: ['finance'],
          tags: ['#receipt'],
          types: ['document'],
          location: 'Valencia',
          createdAfter: 1_700_000_000,
          createdBefore: 1_800_000_000,
        },
        orderBy: 'created_at',
        direction: 'desc',
      },
    ]);
  });

  it('drops a query slot instead of searching it', async () => {
    const store = recordingStore();

    await recall(store, { query: 'receipts from March', eventBefore: 1_772_500_000 });

    expect(store.lists).toStrictEqual([{ filter: { isChild: false, eventBefore: 1_772_500_000 } }]);

    expect(store.searches).toBe(0);
  });

  it('lists parents with no order when the slots set none', async () => {
    const store = recordingStore([]);

    await expect(recall(store, {})).resolves.toStrictEqual([]);

    expect(store.lists).toStrictEqual([{ filter: { isChild: false } }]);
  });
});
