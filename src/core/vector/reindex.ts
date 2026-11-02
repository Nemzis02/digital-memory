import type { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import { logger } from '../logging/logger.ts';
import { parseMemoryPayload } from '../memory/payload.ts';
import { embeddableText } from '../pipeline/nodes/storage.ts';
import { SPARSE_VECTOR, sparseDocument } from './qdrant.ts';

const log = logger.child({ module: 'vector/reindex' });

export const REINDEX_BATCH = 64;

// The hashed vector that bm25_v2 replaced.
export const LEGACY_SPARSE_VECTOR = 'bm25';

export type ReindexClient = Pick<
  QdrantClient,
  'scroll' | 'updateVectors' | 'getCollection' | 'deleteVectorName'
>;

export interface ReindexResult {
  updated: number;
}

// Points that got the vector leave the filter, so every pass reads the next untouched page and
// a rerun over a finished collection reads nothing.
const MISSING_SPARSE: Schemas['Filter'] = { must_not: [{ has_vector: SPARSE_VECTOR }] };

export async function reindexSparse(
  client: ReindexClient,
  collection: string,
  batch = REINDEX_BATCH,
): Promise<ReindexResult> {
  let updated = 0;
  let previousFirst: Schemas['ExtendedPointId'] | undefined;

  for (;;) {
    const { points } = await client.scroll(collection, {
      filter: MISSING_SPARSE,
      limit: batch,
      with_payload: true,
      with_vector: false,
    });

    const [first] = points;

    if (first === undefined) {
      return { updated };
    }

    if (first.id === previousFirst) {
      throw new Error(`Reindex made no progress: the update did not add ${SPARSE_VECTOR}`);
    }

    previousFirst = first.id;

    const vectors = points.map((point) => ({
      id: point.id,
      vector: {
        [SPARSE_VECTOR]: sparseDocument(embeddableText(parseMemoryPayload(point.payload))),
      },
    }));

    await client.updateVectors(collection, { wait: true, points: vectors });

    updated += points.length;
    log.info('sparse vectors added', { collection, updated });
  }
}

export async function dropSparseVector(
  client: ReindexClient,
  collection: string,
  name: string,
): Promise<boolean> {
  const { config } = await client.getCollection(collection);

  if (!(name in (config.params.sparse_vectors ?? {}))) {
    return false;
  }

  await client.deleteVectorName(collection, name, { wait: true });
  log.info('sparse vector dropped', { collection, name });

  return true;
}
