import type { UUID } from 'node:crypto';
import type { InboundMessage } from '../ingestion/inbound.ts';
import type { ForgetCandidate } from '../ingestion/reply.ts';
import type { Embeddings } from '../llm/embeddings.ts';
import type { ToolSpec } from '../llm/router.ts';
import { logger } from '../logging/logger.ts';
import type { MemoryPayload, MemorySource, MemoryType } from '../memory/payload.ts';
import type { IngestResult, IngestionPipeline } from '../pipeline/graph.ts';
import type { Progress, Stage } from '../progress.ts';
import { readableSources, recall, search } from '../retrieval/query.ts';
import type { VectorStore } from '../vector/vector-store.ts';
import { fenceMemory } from './prompt.ts';
import {
  forgetMemoryInput,
  listMemoriesInput,
  saveMemoryInput,
  searchMemoryInput,
  toQueryInput,
  type ForgetMemoryInput,
  type ListMemoriesInput,
  type SaveMemoryInput,
  type SearchMemoryInput,
} from './schemas.ts';

const log = logger.child({ module: 'agent/tools' });

const NOT_SHOWN =
  'forget_memory needs ids of memories shown in this turn. Call search_memory or list_memories first.';

export interface AgentToolDeps {
  store: VectorStore;
  embeddings: Embeddings;
  pipeline: IngestionPipeline;
  source: MemorySource;
}

/** What the turn's tools did, read by reply composition instead of the model's prose. */
export interface TurnEffects {
  saved?: IngestResult;
  /** The save in flight; it outlives a timed-out turn, so the turn can still offer Undo. */
  pending?: Promise<IngestResult>;
  /** Keyed by id, so repeated calls add to one set instead of replacing it. */
  forgetCandidates?: Map<UUID, ForgetCandidate>;
}

export interface AgentTurn {
  message: InboundMessage;
  effects: TurnEffects;
  /** Every parent the model was shown this turn; only these can be cited. */
  shown: Map<UUID, MemoryPayload>;
  progress?: Progress;
}

async function staged<T>(turn: AgentTurn, stage: Stage, work: () => Promise<T>): Promise<T> {
  turn.progress?.(stage);

  try {
    return await work();
  } finally {
    turn.progress?.('thinking');
  }
}

export interface AgentTools {
  search_memory: ToolSpec<SearchMemoryInput>;
  list_memories: ToolSpec<ListMemoriesInput>;
  save_memory: ToolSpec<SaveMemoryInput>;
  forget_memory: ToolSpec<ForgetMemoryInput>;
}

export const AGENT_TOOL_NAMES = [
  'search_memory',
  'list_memories',
  'save_memory',
  'forget_memory',
] as const satisfies readonly (keyof AgentTools)[];

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

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

function candidate(memory: MemoryPayload): ForgetCandidate {
  return {
    id: memory.id,
    summary: memory.summary,
    createdAt: day(memory.created_at),
    ...(memory.file_name === undefined ? {} : { fileName: memory.file_name }),
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
  const sources = readableSources(deps.source);

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
        const parents = await staged(turn, 'searching', () =>
          search({ store, embeddings }, { ...toQueryInput(input), sources }),
        );

        show(parents);

        return parents.map(found);
      },
    },

    list_memories: {
      description:
        'List memories by metadata alone, with no text search: what is coming up, receipts from a month, everything tagged #x. Returns id, summary and dates.',
      input: listMemoriesInput,
      async execute(input) {
        const memories = await staged(turn, 'searching', () =>
          recall(store, { ...toQueryInput(input), sources }),
        );

        show(memories);

        return memories.map(listed);
      },
    },

    save_memory: {
      description:
        "Save the user's current message, with any file it carries, as a new memory. Call it only when the user wants something kept. Returns how it was filed.",
      input: saveMemoryInput,
      async execute(input) {
        // The id derives from the message, so a second save would only redo the same point.
        if (turn.effects.pending !== undefined) {
          return filed(await turn.effects.pending);
        }

        const message =
          input.note === undefined ? turn.message : { ...turn.message, text: input.note };

        const progress = turn.progress;

        const pending = deps.pipeline
          .ingest({ source: deps.source, message }, progress === undefined ? {} : { progress })
          .then((result) => {
            turn.effects.saved = result;
            log.info('saved', { id: result.id, type: message.type, points: result.points });

            return result;
          });

        turn.effects.pending = pending;

        try {
          return filed(await pending);
        } finally {
          progress?.('thinking');
        }
      },
    },

    forget_memory: {
      description:
        'Mark the memories the user wants deleted: one, several or all of the matches. Give ids that search_memory or list_memories returned in this turn. It deletes nothing. The user confirms with one button.',
      input: forgetMemoryInput,
      execute(input) {
        // Not a search: a fused-rank top hit carries no relevance, so the model picks what it read.
        const shown = [...turn.shown.values()];
        const parents: MemoryPayload[] = [];
        const missing: string[] = [];

        for (const id of input.ids) {
          const parent = shown.find((memory) => memory.id === id);

          if (parent === undefined) {
            missing.push(id);
          } else {
            parents.push(parent);
          }
        }

        if (missing.length > 0) {
          return Promise.reject(new Error(`${NOT_SHOWN} Not shown: ${missing.join(', ')}.`));
        }

        const candidates = (turn.effects.forgetCandidates ??= new Map());
        const marked = parents.map(candidate);

        for (const item of marked) {
          candidates.set(item.id, item);
        }

        log.info('forget candidates', { ids: [...candidates.keys()] });

        return Promise.resolve(marked);
      },
    },
  };
}
