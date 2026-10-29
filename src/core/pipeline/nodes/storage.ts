import { logger } from '../../logging/logger.ts';
import type { Embeddings } from '../../llm/embeddings.ts';
import type { MemoryPayload } from '../../memory/payload.ts';
import type { MemoryRecord } from '../../vector/vector-store.ts';
import type { PipelineDeps } from '../deps.ts';
import type { IngestionStateType, IngestionUpdate } from '../state.ts';

const log = logger.child({ module: 'pipeline/storage' });

const MAX_EMBED_CHARS = 8_000;

export function embeddableText(payload: MemoryPayload): string {
  const head = [payload.summary, payload.metadata.location, ...payload.metadata.tags]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');

  const body = payload.original_text.trim().slice(0, MAX_EMBED_CHARS);

  return body === '' ? head : `${head}\n\n${body}`;
}

export async function embedRecords(
  embeddings: Embeddings,
  payloads: readonly MemoryPayload[],
): Promise<{ records: MemoryRecord[]; embedded: number }> {
  const texts = payloads.map(embeddableText);

  const unique = [...new Set(texts)];
  const vectors = await embeddings.embedMany(unique, 'document');

  const dense = new Map(unique.map((text, index) => [text, vectors[index]]));

  const records = payloads.map((payload, index): MemoryRecord => {
    const text = texts[index] ?? '';
    const vector = dense.get(text);

    if (vector === undefined) {
      throw new Error(`No embedding was returned for ${payload.id}`);
    }

    return { payload, dense: vector, text };
  });

  return { records, embedded: unique.length };
}

export function createStorageNode(deps: Pick<PipelineDeps, 'store' | 'embeddings'>) {
  return async (state: IngestionStateType): Promise<IngestionUpdate> => {
    const { payloads } = state;

    if (payloads.length === 0) {
      throw new Error('Chunking must run before anything can be indexed');
    }

    const { records, embedded } = await embedRecords(deps.embeddings, payloads);

    await deps.store.upsert(records);

    log.info('indexed', { id: state.id, points: records.length, embedded });

    return {};
  };
}
