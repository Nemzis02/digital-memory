import type { UUID } from 'node:crypto';
import type { Embeddings } from '../llm/embeddings.ts';
import { memoryId } from '../memory/id.ts';
import { epochDay } from '../memory/normalize.ts';
import { parseMemoryPayload, type MemoryPayload } from '../memory/payload.ts';
import { chunkPayloads } from '../pipeline/nodes/chunking.ts';
import { embedRecords } from '../pipeline/nodes/storage.ts';
import type { VectorStore } from '../vector/vector-store.ts';
import type { CorpusRow } from './dataset.ts';

const SWEEP_PAGE = 512;

export function evalMemoryId(key: string): UUID {
  return memoryId('eval', key);
}

export function corpusPayloads(row: CorpusRow, createdAt: number): MemoryPayload[] {
  const eventAt = row.event_at === undefined ? undefined : epochDay(row.event_at);

  const parent = parseMemoryPayload({
    id: evalMemoryId(row.key),
    source: 'eval',
    source_ref: row.key,
    type: row.type,
    original_text: row.text,
    summary: row.summary,
    ...(row.source_url === undefined ? {} : { source_url: row.source_url }),
    metadata: row.metadata,
    chunking: { is_child: false },
    created_at: createdAt,
    ...(eventAt === undefined ? {} : { event_at: eventAt }),
  });

  return chunkPayloads(parent);
}

export interface SeedDeps {
  store: VectorStore;
  embeddings: Embeddings;
}

export async function seedCorpus(
  deps: SeedDeps,
  corpus: readonly CorpusRow[],
  createdAt = Math.floor(Date.now() / 1000),
): Promise<Map<UUID, string>> {
  const payloads = corpus.flatMap((row) => corpusPayloads(row, createdAt));
  const { records } = await embedRecords(deps.embeddings, payloads);

  await deps.store.upsert(records);

  return new Map(corpus.map((row) => [evalMemoryId(row.key), row.key]));
}

export async function sweepEval(store: VectorStore): Promise<number> {
  let removed = 0;

  for (;;) {
    const page = await store.list({ filter: { sources: ['eval'] }, limit: SWEEP_PAGE });

    if (page.length === 0) {
      return removed;
    }

    await store.remove(page.map((payload) => payload.id));
    removed += page.length;
  }
}
