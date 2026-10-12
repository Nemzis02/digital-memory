import type { UUID } from 'node:crypto';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { pool } from '../db/client.ts';
import { embeddings } from '../llm/embeddings.ts';
import { llmRouter } from '../llm/router.ts';
import type { MemoryCategory, MemoryKind } from '../memory/payload.ts';
import { r2Storage } from '../storage/r2.ts';
import { qdrantStore } from '../vector/qdrant.ts';
import type { PipelineDeps } from './deps.ts';
import { createChunkingNode } from './nodes/chunking.ts';
import { createEnrichmentNode } from './nodes/enrichment.ts';
import { createExtractionNode } from './nodes/extraction.ts';
import { createFileHandlerNode } from './nodes/file-handler.ts';
import { createReceiverNode } from './nodes/receiver.ts';
import { createStorageNode } from './nodes/storage.ts';
import { IngestionState, requireEnrichment, requireStored } from './state.ts';
import type { IngestionInput } from './state.ts';
import { createUrlFetcher } from './url.ts';
import { undoIngest } from './undo.ts';
import type { UndoTarget } from './undo.ts';

export interface IngestResult {
  id: UUID;
  summary: string;
  category: MemoryCategory;
  kind: MemoryKind;
  tags: string[];
  key: string;
  points: number;
}

export interface IngestionPipeline {
  init(): Promise<void>;
  ingest(input: IngestionInput): Promise<IngestResult>;
  undo(target: UndoTarget): Promise<boolean>;
}

type Checkpointer = BaseCheckpointSaver & { setup?: () => Promise<void> };

export function postgresCheckpointer(): Checkpointer {
  return new PostgresSaver(pool());
}

export function createIngestionPipeline(
  deps: PipelineDeps,
  checkpointer?: Checkpointer,
): IngestionPipeline {
  const graph = new StateGraph(IngestionState)
    .addNode('receive', createReceiverNode(deps))
    .addNode('storeFile', createFileHandlerNode(deps))
    .addNode('extract', createExtractionNode(deps))
    .addNode('enrich', createEnrichmentNode(deps))
    .addNode('chunk', createChunkingNode())
    .addNode('index', createStorageNode(deps))
    .addEdge(START, 'receive')
    .addEdge('receive', 'storeFile')
    .addEdge('storeFile', 'extract')
    .addEdge('extract', 'enrich')
    .addEdge('enrich', 'chunk')
    .addEdge('chunk', 'index')
    .addEdge('index', END)
    .compile(checkpointer === undefined ? {} : { checkpointer });

  return {
    async init() {
      await Promise.all([checkpointer?.setup?.(), deps.store.init()]);
    },

    async ingest(input) {
      const state = await graph.invoke(input, {
        configurable: { thread_id: `${input.source}:${input.message.sourceRef}` },
      });

      const enrichment = requireEnrichment(state);

      return {
        id: state.id,
        summary: enrichment.summary,
        category: enrichment.category,
        kind: enrichment.kind,
        tags: enrichment.tags,
        key: requireStored(state).key,
        points: state.payloads.length,
      };
    },

    undo(target) {
      return undoIngest(deps, target);
    },
  };
}

export function ingestionPipeline(files: PipelineDeps['files']): IngestionPipeline {
  return createIngestionPipeline(
    {
      files,
      storage: r2Storage(),
      store: qdrantStore(),
      router: llmRouter(),
      embeddings: embeddings(),
      urls: createUrlFetcher(),
    },
    postgresCheckpointer(),
  );
}
