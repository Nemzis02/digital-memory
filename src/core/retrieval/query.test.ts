import { describe, expect, it } from 'vitest';
import type { EmbedTask, Embeddings } from '../llm/embeddings.ts';
import type { MemoryPayload } from '../memory/payload.ts';
import type { ObjectStorage } from '../storage/object-storage.ts';
import type { ListQuery, SearchHit, SearchQuery, VectorStore } from '../vector/vector-store.ts';
import { NOTHING_FOUND } from './answer.ts';
import {
  cite,
  forget,
  readableSources,
  recall,
  search,
  usedParents,
  type SearchDeps,
} from './query.ts';

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

  it('drops the query text instead of searching it', async () => {
    const store = recordingStore();

    await recall(store, { query: 'receipts from March', eventBefore: 1_772_500_000 });

    expect(store.lists).toStrictEqual([{ filter: { isChild: false, eventBefore: 1_772_500_000 } }]);

    expect(store.searches).toBe(0);
  });

  it('scopes a listing to the sources it is given', async () => {
    const store = recordingStore();

    await recall(store, { sources: ['eval'] });

    expect(store.lists).toStrictEqual([{ filter: { isChild: false, sources: ['eval'] } }]);
  });

  it('lists parents with no order when the input sets none', async () => {
    const store = recordingStore([]);

    await expect(recall(store, {})).resolves.toStrictEqual([]);

    expect(store.lists).toStrictEqual([{ filter: { isChild: false } }]);
  });
});

const DENSE = [0.2, 0.4];
const SPARSE = { indices: [7], values: [1] };

const paella: MemoryPayload = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  source: 'telegram',
  source_ref: 'paella',
  type: 'text',
  original_text: 'soak the rice, then the stock',
  summary: 'Weekend cooking',
  metadata: { category: 'food', kind: 'note', tags: [] },
  chunking: { is_child: false },
  created_at: 1_772_000_000,
};

const dentist: MemoryPayload = {
  id: '6b1e8a2c-9d4f-4c7a-8e1b-3a5d7c9e0f12',
  source: 'telegram',
  source_ref: 'dentist',
  type: 'photo',
  original_text: 'dentist Tuesday at 10',
  summary: 'Appointment card',
  r2_file_path: 'photos/2026/03/dentist.jpg',
  metadata: { category: 'health', kind: 'event', tags: ['#dentist'] },
  chunking: { is_child: false },
  created_at: 1_772_000_000,
};

function child(
  id: MemoryPayload['id'],
  parentId: MemoryPayload['id'],
  text: string,
): MemoryPayload {
  return {
    id,
    source: 'telegram',
    source_ref: id,
    type: 'text',
    original_text: text,
    summary: 'chunk label',
    metadata: { category: 'other', kind: 'note', tags: [] },
    chunking: { is_child: true, parent_id: parentId },
    created_at: 1_772_000_000,
  };
}

function hit(payload: MemoryPayload, score: number): SearchHit {
  return { id: payload.id, score, payload };
}

function searching(options?: { hits?: readonly SearchHit[]; parents?: readonly MemoryPayload[] }): {
  deps: SearchDeps;
  embeds: { text: string; task: EmbedTask }[];
  sparses: string[];
  searches: SearchQuery[];
  fetches: MemoryPayload['id'][][];
} {
  const hits = options?.hits ?? [];
  const parents = options?.parents ?? [];
  const embeds: { text: string; task: EmbedTask }[] = [];
  const sparses: string[] = [];
  const searches: SearchQuery[] = [];
  const fetches: MemoryPayload['id'][][] = [];

  const embeddings: Embeddings = {
    embed(text, task) {
      embeds.push({ text, task });

      return Promise.resolve(DENSE);
    },
    embedMany() {
      return Promise.reject(new Error('search embeds one query'));
    },
    embedSparse(text) {
      sparses.push(text);

      return SPARSE;
    },
  };

  const store: VectorStore = {
    init() {
      return Promise.resolve();
    },
    upsert() {
      return Promise.resolve();
    },
    search(query) {
      searches.push(query);

      return Promise.resolve([...hits]);
    },
    list() {
      return Promise.reject(new Error('search does not list'));
    },
    fetch(ids) {
      fetches.push([...ids]);

      return Promise.resolve([...parents]);
    },
    remove() {
      return Promise.resolve();
    },
  };

  return { deps: { store, embeddings }, embeds, sparses, searches, fetches };
}

describe('search', () => {
  it('returns each parent once in hit order', async () => {
    const box = searching({
      hits: [
        hit(child('11111111-1111-4111-8111-111111111111', paella.id, 'rice fragment'), 0.9),
        hit(child('22222222-2222-4222-8222-222222222222', dentist.id, 'tuesday fragment'), 0.5),
        hit(child('33333333-3333-4333-8333-333333333333', dentist.id, 'ten o clock fragment'), 0.2),
      ],
      parents: [dentist, paella],
    });

    await expect(
      search(box.deps, { query: '  dentist  ', kinds: ['event'] }),
    ).resolves.toStrictEqual([paella, dentist]);

    expect(box.embeds).toStrictEqual([{ text: 'dentist', task: 'query' }]);

    expect(box.searches).toStrictEqual([
      { dense: DENSE, sparse: SPARSE, limit: 10, filter: { isChild: true, kinds: ['event'] } },
    ]);

    expect(box.sparses).toStrictEqual(['dentist']);
    expect(box.fetches).toStrictEqual([[paella.id, dentist.id]]);
  });

  it('returns nothing without fetching when nothing matches', async () => {
    const box = searching();

    await expect(search(box.deps, { query: 'where are the keys' })).resolves.toStrictEqual([]);

    expect(box.fetches).toStrictEqual([]);
  });

  it('rejects a blank query before embedding', async () => {
    const box = searching();

    await expect(search(box.deps, { query: '   ' })).rejects.toThrow(
      new TypeError('search() needs a query'),
    );

    expect(box.embeds).toStrictEqual([]);
    expect(box.searches).toStrictEqual([]);
  });
});

describe('readableSources', () => {
  it('keeps the eval corpus apart from real memories', () => {
    expect(readableSources('telegram')).toStrictEqual(['telegram', 'mcp']);
    expect(readableSources('mcp')).toStrictEqual(['telegram', 'mcp']);
    expect(readableSources('eval')).toStrictEqual(['eval']);
  });
});

describe('cite', () => {
  it('links a page, attaches a photo or a named document, and leaves the rest bare', () => {
    const page: MemoryPayload = {
      ...paella,
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      type: 'url',
      source_url: 'https://example.com/paella',
      r2_file_path: 'documents/2026/03/page.html',
      summary: 'Paella recipe',
    };

    const pdf: MemoryPayload = {
      ...dentist,
      id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      type: 'document',
      r2_file_path: 'documents/2026/03/card.pdf',
      file_name: 'Tarjeta sanitaria.pdf',
      summary: 'Insurance card',
    };

    const voice: MemoryPayload = {
      ...paella,
      id: 'cccccccc-dddd-4eee-8fff-000000000000',
      type: 'voice',
      r2_file_path: 'voice/2026/03/note.oga',
      summary: 'Spoken reminder',
    };

    expect(cite([page, dentist, pdf, voice, paella])).toStrictEqual([
      { id: page.id, summary: 'Paella recipe', url: 'https://example.com/paella' },
      {
        id: dentist.id,
        summary: 'Appointment card',
        file: { key: 'photos/2026/03/dentist.jpg', type: 'photo' },
      },
      {
        id: pdf.id,
        summary: 'Insurance card',
        file: {
          key: 'documents/2026/03/card.pdf',
          type: 'document',
          name: 'Tarjeta sanitaria.pdf',
        },
      },
      { id: voice.id, summary: 'Spoken reminder' },
      { id: paella.id, summary: 'Weekend cooking' },
    ]);
  });
});

describe('usedParents', () => {
  it('keeps only the named parents in their given order and ignores unknown ids', () => {
    expect(
      usedParents(`Tuesday at 10.\n\nSources: ${dentist.id} not-an-id ${paella.id}\n\n`, [
        paella,
        dentist,
      ]),
    ).toStrictEqual({ answer: 'Tuesday at 10.', parents: [paella, dentist] });
  });

  it('keeps the whole answer and no parents without a sources line', () => {
    expect(usedParents('  Tuesday at 10.\n', [dentist])).toStrictEqual({
      answer: 'Tuesday at 10.',
      parents: [],
    });
  });

  it('drops the sources when the answer is nothing found', () => {
    expect(usedParents(`${NOTHING_FOUND}\n\nSources: ${dentist.id}`, [dentist])).toStrictEqual({
      answer: NOTHING_FOUND,
      parents: [],
    });

    expect(usedParents(`  ${NOTHING_FOUND}  `, [dentist])).toStrictEqual({
      answer: NOTHING_FOUND,
      parents: [],
    });
  });
});

function forgetting(options?: {
  fetched?: readonly MemoryPayload[];
  children?: readonly MemoryPayload[];
}): {
  deps: { store: VectorStore; storage: ObjectStorage };
  fetches: MemoryPayload['id'][][];
  lists: ListQuery[];
  removed: MemoryPayload['id'][][];
  objectRemovals: string[];
} {
  const fetched = options?.fetched ?? [];
  const children = options?.children ?? [];
  const fetches: MemoryPayload['id'][][] = [];
  const lists: ListQuery[] = [];
  const removed: MemoryPayload['id'][][] = [];
  const objectRemovals: string[] = [];

  const storage: ObjectStorage = {
    upload() {
      return Promise.reject(new Error('forget only removes'));
    },
    presignDownload() {
      return Promise.reject(new Error('forget only removes'));
    },
    openStream() {
      return Promise.reject(new Error('forget only removes'));
    },
    openSized() {
      return Promise.reject(new Error('forget only removes'));
    },
    remove(key) {
      objectRemovals.push(key);

      return Promise.resolve();
    },
  };

  const store: VectorStore = {
    init() {
      return Promise.resolve();
    },
    upsert() {
      return Promise.resolve();
    },
    search() {
      return Promise.reject(new Error('forget removes by id and never searches'));
    },
    list(query) {
      lists.push(query);

      return Promise.resolve([...children]);
    },
    fetch(ids) {
      fetches.push([...ids]);

      const wanted = new Set(ids);

      return Promise.resolve(fetched.filter((payload) => wanted.has(payload.id)));
    },
    remove(ids) {
      removed.push([...ids]);

      return Promise.resolve();
    },
  };

  return { deps: { store, storage }, fetches, lists, removed, objectRemovals };
}

const rice = child('11111111-1111-4111-8111-111111111111', paella.id, 'rice fragment');
const tuesday = child('22222222-2222-4222-8222-222222222222', dentist.id, 'tuesday fragment');
const ten = child('33333333-3333-4333-8333-333333333333', dentist.id, 'ten o clock fragment');

describe('forget', () => {
  it('removes the parent, its children, and the object', async () => {
    const box = forgetting({ fetched: [dentist], children: [tuesday, ten] });

    await expect(forget(box.deps, dentist.id)).resolves.toBe(true);

    expect(box.fetches).toStrictEqual([[dentist.id]]);
    expect(box.lists).toStrictEqual([{ filter: { parentId: dentist.id }, limit: 512 }]);
    expect(box.removed).toStrictEqual([[dentist.id, tuesday.id, ten.id]]);
    expect(box.objectRemovals).toStrictEqual(['photos/2026/03/dentist.jpg']);
  });

  it('does nothing when the parent is already gone', async () => {
    const box = forgetting({ children: [tuesday] });

    await expect(forget(box.deps, dentist.id)).resolves.toBe(false);

    expect(box.lists).toStrictEqual([]);
    expect(box.removed).toStrictEqual([]);
    expect(box.objectRemovals).toStrictEqual([]);
  });

  it('does nothing when the id is a child', async () => {
    const box = forgetting({ fetched: [tuesday], children: [ten] });

    await expect(forget(box.deps, tuesday.id)).resolves.toBe(false);

    expect(box.lists).toStrictEqual([]);
    expect(box.removed).toStrictEqual([]);
    expect(box.objectRemovals).toStrictEqual([]);
  });

  it('removes the points of a memory that has no file', async () => {
    const box = forgetting({ fetched: [paella], children: [rice] });

    await expect(forget(box.deps, paella.id)).resolves.toBe(true);

    expect(box.removed).toStrictEqual([[paella.id, rice.id]]);
    expect(box.objectRemovals).toStrictEqual([]);
  });
});
