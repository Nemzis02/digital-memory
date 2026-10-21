import type { UUID } from 'node:crypto';
import type { InboundMessage } from '../ingestion/inbound.ts';
import type { Embeddings } from '../llm/embeddings.ts';
import type { ToolSpec } from '../llm/router.ts';
import { logger } from '../logging/logger.ts';
import type { MemoryPayload, MemorySource, MemoryType } from '../memory/payload.ts';
import type { IngestResult, IngestionPipeline } from '../pipeline/graph.ts';
import { recall, resolveForget, search } from '../retrieval/query.ts';
import type { VectorStore } from '../vector/vector-store.ts';
import { fenceMemory } from './prompt.ts';
import {
  forgetMemoryInput,
  listMemoriesInput,
  saveMemoryInput,
  searchMemoryInput,
  toSlots,
  type ForgetMemoryInput,
  type ListMemoriesInput,
  type SaveMemoryInput,
  type SearchMemoryInput,
} from './schemas.ts';

const log = logger.child({ module: 'agent/tools' });

export interface AgentToolDeps {
  store: VectorStore;
  embeddings: Embeddings;
  pipeline: IngestionPipeline;
  source: MemorySource;
}

/** What the turn's tools did, read by reply composition instead of the model's prose. */
export interface TurnEffects {
  saved?: IngestResult;
  forgetCandidate?: { id: UUID; summary: string };
}

export interface AgentTurn {
  message: InboundMessage;
  effects: TurnEffects;
  /** Every parent the model was shown this turn; only these can be cited. */
  shown: Map<UUID, MemoryPayload>;
}

export interface AgentTools {
  search_memory: ToolSpec<SearchMemoryInput>;
  list_memories: ToolSpec<ListMemoriesInput>;
  save_memory: ToolSpec<SaveMemoryInput>;
  forget_memory: ToolSpec<ForgetMemoryInput>;
}

export interface ListedMemory {
  id: UUID;
  summary: string;
  type: MemoryType;
  created_at: string;
  event_at?: string;
}

export interface FoundMemory extends ListedMemory {
  has_file: boolean;
  url?: string;
  text: string;
}

function day(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function listed(memory: MemoryPayload): ListedMemory {
  return {
    id: memory.id,
    summary: memory.summary,
    type: memory.type,
    created_at: day(memory.created_at),
    ...(memory.event_at === undefined ? {} : { event_at: day(memory.event_at) }),
  };
}

function found(memory: MemoryPayload): FoundMemory {
  // Only a photo or a document can be attached to the answer; a url memory's stored page is not.
  const attachable =
    (memory.type === 'photo' || memory.type === 'document') && memory.r2_file_path !== undefined;

  return {
    ...listed(memory),
    has_file: attachable,
    ...(memory.type === 'url' && memory.source_url !== undefined ? { url: memory.source_url } : {}),
    text: fenceMemory(memory.id, memory.original_text),
  };
}

function filed(result: IngestResult) {
  return {
    id: result.id,
    summary: result.summary,
    category: result.category,
    kind: result.kind,
    tags: result.tags,
  };
}

export function createAgentTools(deps: AgentToolDeps, turn: AgentTurn): AgentTools {
  const { store, embeddings } = deps;

  function show(parents: readonly MemoryPayload[]): void {
    for (const parent of parents) {
      turn.shown.set(parent.id, parent);
    }
  }

  return {
    search_memory: {
      description:
        'Search what saved memories say. Use for any question answered from their content. Returns the matching memories, best first, each with its text inside a <memory> block.',
      input: searchMemoryInput,
      async execute(input) {
        const parents = await search({ store, embeddings }, toSlots(input));

        show(parents);

        return parents.map(found);
      },
    },

    list_memories: {
      description:
        'List memories by metadata alone, with no text search: what is coming up, receipts from a month, everything tagged #x. Returns id, summary and dates.',
      input: listMemoriesInput,
      async execute(input) {
        const memories = await recall(store, toSlots(input));

        show(memories);

        return memories.map(listed);
      },
    },

    save_memory: {
      description:
        "Save the user's current message, with any file it carries, as a new memory. Call it only when the user wants something kept. Returns how it was filed.",
      input: saveMemoryInput,
      async execute(input) {
        const saved = turn.effects.saved;

        // The id derives from the message, so a second save would only redo the same point.
        if (saved !== undefined) {
          return filed(saved);
        }

        const message =
          input.note === undefined ? turn.message : { ...turn.message, text: input.note };

        const result = await deps.pipeline.ingest({ source: deps.source, message });

        turn.effects.saved = result;
        log.info('saved', { id: result.id, type: message.type, points: result.points });

        return filed(result);
      },
    },

    forget_memory: {
      description:
        'Find the one memory the user wants deleted. It deletes nothing: the user confirms with a button. Returns the candidate, or null when nothing matches.',
      input: forgetMemoryInput,
      async execute(input) {
        const parent = await resolveForget({ store, embeddings }, toSlots(input));

        if (parent === undefined) {
          return null;
        }

        const candidate = { id: parent.id, summary: parent.summary };

        turn.effects.forgetCandidate = candidate;
        log.info('forget candidate', { id: parent.id });

        return candidate;
      },
    },
  };
}
