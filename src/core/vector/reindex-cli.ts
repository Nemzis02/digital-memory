import { getEnv } from '../../config/env.ts';
import { createQdrantClient, createQdrantStore, SPARSE_VECTOR } from './qdrant.ts';
import { dropSparseVector, LEGACY_SPARSE_VECTOR, reindexSparse } from './reindex.ts';

const env = getEnv();
const client = createQdrantClient(env);
const collection = env.QDRANT_COLLECTION;

await createQdrantStore(env).init();

const { updated } = await reindexSparse(client, collection);

console.log(`${collection}: ${updated} points got ${SPARSE_VECTOR}.`);

const dropped = await dropSparseVector(client, collection, LEGACY_SPARSE_VECTOR);

console.log(
  dropped
    ? `${collection}: dropped ${LEGACY_SPARSE_VECTOR}.`
    : `${collection}: ${LEGACY_SPARSE_VECTOR} already gone.`,
);
