import type { UUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTurn } from '../agent/turn.ts';
import type { ConversationTurn } from '../conversation/context.ts';
import { EMBEDDING_MODEL, embeddings } from '../llm/embeddings.ts';
import type { ChatModel } from '../llm/router.ts';
import { llmRouter, StepLimitError } from '../llm/router.ts';
import { memoryId } from '../memory/id.ts';
import type { IngestionPipeline } from '../pipeline/graph.ts';
import { search } from '../retrieval/query.ts';
import { qdrantStore } from '../vector/qdrant.ts';
import { DEFAULT_EVALS_DIR, loadDataset, type TurnCase } from './dataset.ts';
import {
  BASELINE_FILE,
  buildRun,
  compareRuns,
  LAST_RUN_FILE,
  readRun,
  renderTable,
  writeRun,
} from './report.ts';
import { recallAtK, toolChoice } from './score.ts';
import { seedCorpus, sweepEval } from './seed.ts';

const KEYS = ['LLM_FAST_API_KEY', 'LLM_STRONG_API_KEY', 'QDRANT_API_KEY'] as const;

const live =
  process.env.LLM_LIVE === '1' && KEYS.every((key) => (process.env[key]?.length ?? 0) > 0);

const K = 5;
const SEED_TIMEOUT = 180_000;
const RETRIEVAL_TIMEOUT = 30_000;
const TURN_TIMEOUT = 60_000;

const dataset = await loadDataset();

const retrievalScores: Record<string, number> = {};
const turnScores: Record<string, number> = {};
let keyById = new Map<UUID, string>();

/** Records the tool names of every run, including a run cut off at the step limit. */
function recording(model: ChatModel, names: string[]): ChatModel {
  return {
    id: model.id,
    complete: model.complete.bind(model),
    object: model.object.bind(model),
    async run(request, tools, maxSteps, options) {
      try {
        const result = await model.run(request, tools, maxSteps, options);

        names.push(...result.calls.map((call) => call.name));

        return result;
      } catch (error) {
        if (error instanceof StepLimitError) {
          names.push(...error.calls.map((call) => call.name));
        }

        throw error;
      }
    },
  };
}

// A save must never write a memory, and the eval scores which tool was chosen, not what it filed.
const fakePipeline: IngestionPipeline = {
  init: () => Promise.resolve(),
  ingest: ({ message }) =>
    Promise.resolve({
      id: memoryId('eval', `turn-${message.sourceRef}`),
      summary: message.text.slice(0, 80),
      category: 'other',
      kind: 'note',
      tags: [],
      key: `documents/eval/${message.sourceRef}.txt`,
      points: 2,
    }),
  undo: () => Promise.resolve(true),
};

function contextTurns(testCase: TurnCase): ConversationTurn[] {
  const now = new Date();

  return testCase.context.map((turn) => ({ role: turn.role, body: turn.body, createdAt: now }));
}

async function calledTools(testCase: TurnCase): Promise<string[]> {
  const names: string[] = [];

  const deps = {
    model: recording(llmRouter().model('strong'), names),
    store: qdrantStore(),
    embeddings: embeddings(),
    pipeline: fakePipeline,
    source: 'eval',
  } as const;

  const message = {
    sourceRef: testCase.key,
    chatRef: 'eval',
    userRef: 'eval',
    type: 'text',
    text: testCase.message,
  } as const;

  try {
    await runTurn(deps, message, contextTurns(testCase));
  } catch (error) {
    if (!(error instanceof StepLimitError)) {
      throw error;
    }
  }

  return names;
}

async function report(): Promise<void> {
  const run = buildRun({
    ranAt: new Date(),
    models: { strong: llmRouter().model('strong').id, embedding: EMBEDDING_MODEL },
    retrieval: Object.fromEntries(
      dataset.retrieval.map(({ key }) => [key, retrievalScores[key] ?? 0]),
    ),
    turns: Object.fromEntries(dataset.turns.map(({ key }) => [key, turnScores[key] ?? 0])),
  });

  await writeRun(join(DEFAULT_EVALS_DIR, LAST_RUN_FILE), run);

  const baseline = await readRun(join(DEFAULT_EVALS_DIR, BASELINE_FILE));

  // Vitest drops `console` output of passing tests, but not direct writes.
  process.stdout.write(`\n${renderTable(compareRuns(run, baseline))}\n\n`);
}

describe.skipIf(!live)('eval run', () => {
  beforeAll(async () => {
    const store = qdrantStore();

    await store.init();
    await sweepEval(store);
    keyById = await seedCorpus({ store, embeddings: embeddings() }, dataset.corpus);
  }, SEED_TIMEOUT);

  afterAll(async () => {
    const store = qdrantStore();

    try {
      await sweepEval(store);
      expect(await store.list({ filter: { sources: ['eval'] }, limit: 1 })).toStrictEqual([]);
    } finally {
      await report();
    }
  }, SEED_TIMEOUT);

  describe('retrieval', () => {
    it.each(dataset.retrieval)(
      '$key',
      async ({ key, query, expected }) => {
        const parents = await search(
          { store: qdrantStore(), embeddings: embeddings() },
          { query, sources: ['eval'] },
        );

        // An unknown id still takes a slot, so a leaked real memory costs recall.
        const keys = parents.map((parent) => keyById.get(parent.id) ?? parent.id);

        retrievalScores[key] = recallAtK(keys, expected, K);
      },
      RETRIEVAL_TIMEOUT,
    );
  });

  describe('turns', () => {
    it.each(dataset.turns)(
      '$key',
      async (testCase) => {
        turnScores[testCase.key] = toolChoice(await calledTools(testCase), testCase.expected);
      },
      TURN_TIMEOUT,
    );
  });
});
