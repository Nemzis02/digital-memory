import type { FileSource } from '../ingestion/file-source.ts';
import type { Embeddings } from '../llm/embeddings.ts';
import type { LlmRouter } from '../llm/router.ts';
import type { ObjectStorage } from '../storage/object-storage.ts';
import type { VectorStore } from '../vector/vector-store.ts';
import type { UrlFetcher } from './url.ts';

export interface PipelineDeps {
  files: FileSource;
  storage: ObjectStorage;
  store: VectorStore;
  router: LlmRouter;
  embeddings: Embeddings;
  urls: UrlFetcher;
  now?: () => Date;
}

export function clock(deps: Pick<PipelineDeps, 'now'>): Date {
  return (deps.now ?? (() => new Date()))();
}
