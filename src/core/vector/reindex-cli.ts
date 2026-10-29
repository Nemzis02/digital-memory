import { getEnv } from '../../config/env.ts';
import { createQdrantClient, createQdrantStore, SPARSE_VECTOR } from './qdrant.ts';
import { reindexSparse } from './reindex.ts';

const env = getEnv();

await createQdrantStore(env).init();

const { updated } = await reindexSparse(createQdrantClient(env), env.QDRANT_COLLECTION);

console.log(`${env.QDRANT_COLLECTION}: ${updated} points got ${SPARSE_VECTOR}.`);
