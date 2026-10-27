import { describe, expect, it } from 'vitest';
import type { Embeddings } from '../../llm/embeddings.ts';
import { embedSparse } from '../../llm/embeddings.ts';
import { parseMemoryPayload } from '../../memory/payload.ts';
import type { MemoryPayload } from '../../memory/payload.ts';
import type { MemoryRecord, VectorStore } from '../../vector/vector-store.ts';
import { requireEnrichment, requireStored } from '../state.ts';
import type { IngestionStateType } from '../state.ts';
import { createStorageNode, embeddableText, embedRecords } from './storage.ts';

function payload(overrides: Partial<MemoryPayload> = {}): MemoryPayload {
  return parseMemoryPayload({
    id: '22222222-2222-4222-8222-222222222222',
    source: 'telegram',
    source_ref: '10',
    type: 'text',
    original_text: 'tapas at Bar Pepe',
    summary: 'Tapas at Bar Pepe.',
    metadata: { category: 'food', kind: 'recommendation', location: 'Valencia', tags: ['#tapas'] },
    chunking: { is_child: false },
    created_at: 0,
    ...overrides,
  });
}

function state(payloads: MemoryPayload[]): IngestionStateType {
  return {
    source: 'telegram',
    id: '22222222-2222-4222-8222-222222222222',
    createdAt: 0,
    stored: { key: 'documents/2026/10/a.txt', contentType: 'text/plain' },
    originalText: 'tapas at Bar Pepe',
    enrichment: undefined,
    payloads,
    message: { sourceRef: '10', chatRef: '7', userRef: '42', type: 'text', text: 'x' },
  };
}

function deps(): {
  store: VectorStore & { records: MemoryRecord[] };
  embeddings: Embeddings & { batches: string[][] };
} {
  const records: MemoryRecord[] = [];
  const batches: string[][] = [];

  return {
    store: {
      records,
      init: () => Promise.resolve(),
      upsert(batch) {
        records.push(...batch);

        return Promise.resolve();
      },
      search: () => Promise.resolve([]),
      list: () => Promise.resolve([]),
      fetch: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
    },
    embeddings: {
      batches,
      embed: () => Promise.resolve([1]),
      embedMany(texts) {
        batches.push([...texts]);

        return Promise.resolve(texts.map((_, index) => [index]));
      },
      embedSparse,
    },
  };
}

describe('embeddableText', () => {
  it('puts the summary, location, and tags ahead of the text', () => {
    expect(embeddableText(payload())).toBe(
      'Tapas at Bar Pepe. Valencia #tapas\n\ntapas at Bar Pepe',
    );
  });

  it('is still non-blank when there is no extracted text', () => {
    expect(embeddableText(payload({ original_text: '   ' }))).toBe(
      'Tapas at Bar Pepe. Valencia #tapas',
    );
  });
});

describe('embedRecords', () => {
  it('embeds a shared text once and says how many texts it embedded', async () => {
    const fakes = deps();
    const twin = payload({ id: '33333333-3333-4333-8333-333333333333' });
    const other = payload({ id: '44444444-4444-4444-8444-444444444444', original_text: 'paella' });

    const { records, embedded } = await embedRecords(fakes.embeddings, [payload(), twin, other]);

    expect(embedded).toBe(2);
    expect(records.map((record) => record.dense)).toStrictEqual([[0], [0], [1]]);
    expect(records[2]?.sparse).toStrictEqual(embedSparse(embeddableText(other)));
  });
});

describe('createStorageNode', () => {
  it('refuses to index before chunking has produced anything', async () => {
    const fakes = deps();

    await expect(createStorageNode(fakes)(state([]))).rejects.toThrow(/Chunking must run/);
  });

  it('gives two points that share a text the same vector from one embedding call', async () => {
    const fakes = deps();

    const child = payload({
      id: '33333333-3333-4333-8333-333333333333',
      chunking: { is_child: true, parent_id: '22222222-2222-4222-8222-222222222222' },
    });

    await createStorageNode(fakes)(state([payload(), child]));

    expect(fakes.embeddings.batches).toEqual([
      ['Tapas at Bar Pepe. Valencia #tapas\n\ntapas at Bar Pepe'],
    ]);

    expect(fakes.store.records).toHaveLength(2);
    expect(fakes.store.records[0]?.dense).toEqual(fakes.store.records[1]?.dense);
  });
});

describe('state guards', () => {
  it('name the node that must have run first', () => {
    const empty = { ...state([]), stored: undefined };

    expect(() => requireStored(empty)).toThrow(/file handler must run/);
    expect(() => requireEnrichment(empty)).toThrow(/Enrichment must run/);
  });
});
