import { LangfuseClient } from '@langfuse/client';
import { createTraceId } from '@langfuse/tracing';
import type { Env } from '../../config/env.ts';

export interface EvalDataset {
  name: string;
  description: string;
}

export interface EvalItem {
  key: string;
  input: unknown;
  expected: unknown;
}

export interface EvalRun {
  runName: string;
  metadata: Record<string, unknown>;
}

export interface EvalScorer<O> {
  name: string;
  of: (output: O) => number;
}

export interface EvalExperiment {
  readonly enabled: boolean;
  sync(dataset: EvalDataset, items: readonly EvalItem[]): Promise<void>;
  runCase<O>(
    dataset: EvalDataset,
    run: EvalRun,
    key: string,
    task: () => Promise<O>,
    score: EvalScorer<O>,
  ): Promise<number>;
  flush(): Promise<void>;
}

type DatasetItem = Awaited<ReturnType<LangfuseClient['dataset']['createItem']>>;

const PAGE_SIZE = 100;

export function evalItemId(dataset: string, key: string): string {
  return `${dataset}-${key}`;
}

const plain: EvalExperiment = {
  enabled: false,
  sync: () => Promise.resolve(),
  runCase: async (_dataset, _run, _key, task, score) => score.of(await task()),
  flush: () => Promise.resolve(),
};

function isNotFound(error: unknown): boolean {
  return (error as { statusCode?: unknown } | null)?.statusCode === 404;
}

async function ensureDataset(client: LangfuseClient, dataset: EvalDataset): Promise<void> {
  try {
    await client.api.datasets.get(dataset.name);
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }

    await client.api.datasets.create({ name: dataset.name, description: dataset.description });
  }
}

async function listItemIds(client: LangfuseClient, datasetName: string): Promise<string[]> {
  const ids: string[] = [];

  for (let page = 1; ; page += 1) {
    const { data, meta } = await client.api.datasetItems.list({
      datasetName,
      page,
      limit: PAGE_SIZE,
    });

    ids.push(...data.filter((item) => item.status !== 'ARCHIVED').map((item) => item.id));

    if (page >= meta.totalPages) {
      return ids;
    }
  }
}

export function createEvalExperiment(env: Env): EvalExperiment {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;

  if (publicKey === undefined || secretKey === undefined) {
    return plain;
  }

  const client = new LangfuseClient({ publicKey, secretKey, baseUrl: env.LANGFUSE_BASE_URL });
  const items = new Map<string, DatasetItem>();
  const experimentIds = new Map<string, Promise<string>>();

  function experimentId(dataset: EvalDataset, run: EvalRun): Promise<string> {
    const seed = JSON.stringify([dataset.name, run.runName]);
    let id = experimentIds.get(seed);

    if (id === undefined) {
      id = createTraceId(seed);
      experimentIds.set(seed, id);
    }

    return id;
  }

  return {
    enabled: true,

    async sync(dataset, cases) {
      await ensureDataset(client, dataset);

      const wanted = new Set<string>();

      for (const testCase of cases) {
        const id = evalItemId(dataset.name, testCase.key);

        wanted.add(id);

        items.set(
          id,
          await client.dataset.createItem({
            datasetName: dataset.name,
            id,
            input: testCase.input,
            expectedOutput: testCase.expected,
          }),
        );
      }

      for (const id of await listItemIds(client, dataset.name)) {
        if (!wanted.has(id)) {
          await client.dataset.createItem({ datasetName: dataset.name, id, status: 'ARCHIVED' });
        }
      }
    },

    async runCase(dataset, run, key, task, score) {
      const item = items.get(evalItemId(dataset.name, key));

      if (item === undefined) {
        throw new Error(`Eval case ${key} is not in dataset ${dataset.name}. Call sync() first.`);
      }

      const result: { failure?: { error: unknown }; value?: number } = {};

      await client.experiment.run({
        name: dataset.name,
        runName: run.runName,
        experimentId: await experimentId(dataset, run),
        metadata: run.metadata,
        data: [item],
        maxConcurrency: 1,
        task: async () => {
          try {
            const output = await task();

            result.value = score.of(output);

            return output;
          } catch (error) {
            result.failure = { error };
            throw error;
          }
        },
        evaluators: [() => Promise.resolve({ name: score.name, value: result.value ?? 0 })],
      });

      if (result.failure !== undefined) {
        throw result.failure.error;
      }

      if (result.value === undefined) {
        throw new Error(`Langfuse did not run eval case ${key}. Read the Langfuse log above.`);
      }

      return result.value;
    },

    async flush() {
      await client.flush();
    },
  };
}
