import { LangfuseOtelSpanAttributes } from '@langfuse/tracing';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type * as Ai from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.ts';
import { createEvalExperiment, evalItemId, type EvalDataset } from './experiment.ts';
import { RecordingExporter } from './fixtures.ts';
import { startTelemetry, stopTelemetry, traceTurn } from './telemetry.ts';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  registerTelemetry: vi.fn(),
}));

const RAW = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // gitleaks:allow
  TELEGRAM_ADMIN_ID: '123456789',
  DATABASE_URL: 'postgresql://digital_memory:pw@localhost:5432/digital_memory',
  QDRANT_URL: 'https://example.cloud.qdrant.io:6333',
  QDRANT_API_KEY: 'qdrant-key',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_FAST_API_KEY: 'llm-key',
} satisfies NodeJS.ProcessEnv;

const withoutKeys = parseEnv(RAW);

const withKeys = parseEnv({
  ...RAW,
  LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
  LANGFUSE_SECRET_KEY: 'sk-lf-test',
  LANGFUSE_BASE_URL: 'https://langfuse.test',
});

const DATASET: EvalDataset = { name: 'eval-retrieval', description: 'Search queries.' };
const DATASET_ID = 'dataset-1';
const RUN = { runName: '2026-10-27T10:00:00.000Z', metadata: { strong: 'claude-sonnet-5-5' } };

const CASES = [
  { key: 'dentist-keyword', input: { query: 'dentist' }, expected: { keys: ['dentist'] } },
  { key: 'wifi-keyword', input: { query: 'wifi' }, expected: { keys: ['wifi'] } },
];

const SCORE = { name: 'recall_at_5', of: (keys: string[]) => (keys.includes('dentist') ? 1 : 0) };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Request {
  method: string;
  path: string;
  body: unknown;
}

interface StoredItem {
  id: string;
  status: string;
}

class FakeLangfuse {
  readonly requests: Request[] = [];
  datasetExists = true;
  datasetStatus = 200;
  pageSize: number | undefined;
  readonly items: StoredItem[] = [];

  readonly fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const { pathname, searchParams } = new URL(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

    this.requests.push({ method, path: pathname, body });

    return this.answer(method, pathname, body, searchParams);
  };

  private answer(method: string, path: string, body: unknown, query: URLSearchParams): Response {
    const route = `${method} ${path}`;

    if (route === `GET /api/public/v2/datasets/${DATASET.name}`) {
      if (this.datasetStatus !== 200) {
        return json({ message: 'denied' }, this.datasetStatus);
      }

      return this.datasetExists ? json({ id: DATASET_ID, name: DATASET.name }) : json({}, 404);
    }

    if (route === 'POST /api/public/v2/datasets') {
      this.datasetExists = true;

      return json({ id: DATASET_ID, name: DATASET.name });
    }

    if (route === 'POST /api/public/dataset-items') {
      return json(this.upsert(body as Record<string, unknown>));
    }

    if (route === 'GET /api/public/dataset-items') {
      return json(this.page(Number(query.get('page')), Number(query.get('limit'))));
    }

    if (route === 'GET /api/public/projects') {
      return json({ data: [{ id: 'project-1', name: 'test' }] });
    }

    if (route === 'POST /api/public/scores') {
      return json({});
    }

    return json({ message: `no route for ${route}` }, 500);
  }

  private page(page: number, limit: number) {
    const size = this.pageSize ?? limit;
    const totalPages = Math.max(1, Math.ceil(this.items.length / size));

    return {
      data: this.items.slice((page - 1) * size, page * size),
      meta: { page, limit: size, totalItems: this.items.length, totalPages },
    };
  }

  private upsert(request: Record<string, unknown>): Record<string, unknown> {
    const id = String(request.id);
    const status = typeof request.status === 'string' ? request.status : 'ACTIVE';
    const index = this.items.findIndex((item) => item.id === id);

    if (index === -1) {
      this.items.push({ id, status });
    } else {
      this.items[index] = { id, status };
    }

    return { ...request, id, status, datasetId: DATASET_ID };
  }

  posted(path: string): unknown[] {
    return this.requests
      .filter((request) => request.method === 'POST' && request.path === path)
      .map((request) => request.body);
  }

  scores(): Record<string, unknown>[] {
    return this.posted('/api/public/scores').flat() as Record<string, unknown>[];
  }
}

function spansNamed(exporter: RecordingExporter, name: string): ReadableSpan[] {
  return exporter.spans.filter((span) => span.name === name);
}

const ITEM_ID = LangfuseOtelSpanAttributes.EXPERIMENT_ITEM_ID;
const EXPERIMENT_ID = LangfuseOtelSpanAttributes.EXPERIMENT_ID;

describe('eval experiment', () => {
  let langfuse: FakeLangfuse;
  let exporter: RecordingExporter;

  beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    langfuse = new FakeLangfuse();
    exporter = new RecordingExporter();
    vi.stubGlobal('fetch', langfuse.fetch);
  });

  afterEach(async () => {
    await stopTelemetry();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('without the Langfuse keys', () => {
    it('scores each case locally and sends nothing', async () => {
      const experiment = createEvalExperiment(withoutKeys);

      await experiment.sync(DATASET, CASES);

      const score = await experiment.runCase(
        DATASET,
        RUN,
        'dentist-keyword',
        async () => ['dentist'],
        SCORE,
      );

      await experiment.flush();

      expect(experiment.enabled).toBe(false);
      expect(score).toBe(1);
      expect(langfuse.requests).toStrictEqual([]);
    });

    it('rejects with the error of a failed task', async () => {
      const experiment = createEvalExperiment(withoutKeys);
      const failure = new Error('qdrant down');

      await expect(
        experiment.runCase(DATASET, RUN, 'dentist-keyword', () => Promise.reject(failure), SCORE),
      ).rejects.toBe(failure);
    });
  });

  describe('with the Langfuse keys', () => {
    it('creates a missing dataset and upserts one item per case', async () => {
      langfuse.datasetExists = false;

      await createEvalExperiment(withKeys).sync(DATASET, CASES);

      expect(langfuse.posted('/api/public/v2/datasets')).toStrictEqual([
        { name: DATASET.name, description: DATASET.description },
      ]);

      expect(langfuse.posted('/api/public/dataset-items')).toStrictEqual(
        CASES.map((testCase) => ({
          datasetName: DATASET.name,
          id: evalItemId(DATASET.name, testCase.key),
          input: testCase.input,
          expectedOutput: testCase.expected,
        })),
      );
    });

    it('keeps an existing dataset and archives the items that lost their case', async () => {
      langfuse.items.push(
        { id: evalItemId(DATASET.name, 'renamed-case'), status: 'ACTIVE' },
        { id: evalItemId(DATASET.name, 'archived-case'), status: 'ARCHIVED' },
      );

      await createEvalExperiment(withKeys).sync(DATASET, CASES);

      expect(langfuse.posted('/api/public/v2/datasets')).toStrictEqual([]);

      expect(langfuse.posted('/api/public/dataset-items').slice(CASES.length)).toStrictEqual([
        {
          datasetName: DATASET.name,
          id: evalItemId(DATASET.name, 'renamed-case'),
          status: 'ARCHIVED',
        },
      ]);
    });

    it('archives stale items on every page of the item list', async () => {
      langfuse.pageSize = 1;

      langfuse.items.push(
        { id: evalItemId(DATASET.name, 'stale-one'), status: 'ACTIVE' },
        { id: evalItemId(DATASET.name, 'stale-two'), status: 'ACTIVE' },
      );

      await createEvalExperiment(withKeys).sync(DATASET, CASES);

      expect(langfuse.items.filter((item) => item.status === 'ARCHIVED')).toStrictEqual([
        { id: evalItemId(DATASET.name, 'stale-one'), status: 'ARCHIVED' },
        { id: evalItemId(DATASET.name, 'stale-two'), status: 'ARCHIVED' },
      ]);
    });

    it('stops when the dataset lookup fails for a reason other than a missing dataset', async () => {
      langfuse.datasetStatus = 403;

      await expect(createEvalExperiment(withKeys).sync(DATASET, CASES)).rejects.toThrow();

      expect(langfuse.posted('/api/public/v2/datasets')).toStrictEqual([]);
      expect(langfuse.posted('/api/public/dataset-items')).toStrictEqual([]);
    });

    it('runs a case as a dataset item and scores its trace', async () => {
      startTelemetry(withKeys, { exporter });

      const experiment = createEvalExperiment(withKeys);
      const task = vi.fn(async () => ['dentist', 'wifi']);

      await experiment.sync(DATASET, CASES);

      const score = await experiment.runCase(DATASET, RUN, 'dentist-keyword', task, SCORE);

      await experiment.flush();
      await stopTelemetry();

      expect(score).toBe(1);
      expect(task).toHaveBeenCalledOnce();

      const [root] = spansNamed(exporter, 'experiment-item-run');

      expect(root?.attributes).toMatchObject({
        [ITEM_ID]: evalItemId(DATASET.name, 'dentist-keyword'),
        [LangfuseOtelSpanAttributes.EXPERIMENT_DATASET_ID]: DATASET_ID,
        [LangfuseOtelSpanAttributes.EXPERIMENT_NAME]: RUN.runName,
      });

      expect(langfuse.scores()).toStrictEqual([
        expect.objectContaining({
          name: SCORE.name,
          value: 1,
          traceId: root?.spanContext().traceId,
        }),
      ]);
    });

    it('puts every case of one run into one experiment, and another run into another', async () => {
      startTelemetry(withKeys, { exporter });

      const experiment = createEvalExperiment(withKeys);
      const later = { ...RUN, runName: '2026-10-28T10:00:00.000Z' };

      await experiment.sync(DATASET, CASES);
      await experiment.runCase(DATASET, RUN, 'dentist-keyword', async () => ['dentist'], SCORE);
      await experiment.runCase(DATASET, RUN, 'wifi-keyword', async () => ['wifi'], SCORE);
      await experiment.runCase(DATASET, later, 'wifi-keyword', async () => ['wifi'], SCORE);
      await stopTelemetry();

      const ids = spansNamed(exporter, 'experiment-item-run').map(
        (span) => span.attributes[EXPERIMENT_ID],
      );

      expect(ids).toHaveLength(3);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[2]).not.toBe(ids[0]);
    });

    it('rejects with the error of a failed task and sends no score', async () => {
      startTelemetry(withKeys, { exporter });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const experiment = createEvalExperiment(withKeys);
      const failure = new Error('qdrant down');

      await experiment.sync(DATASET, CASES);

      await expect(
        experiment.runCase(DATASET, RUN, 'dentist-keyword', () => Promise.reject(failure), SCORE),
      ).rejects.toBe(failure);

      await experiment.flush();

      expect(langfuse.scores()).toStrictEqual([]);
    });

    it('refuses a case that sync() did not upsert', async () => {
      const experiment = createEvalExperiment(withKeys);

      await expect(
        experiment.runCase(DATASET, RUN, 'dentist-keyword', async () => ['dentist'], SCORE),
      ).rejects.toThrow('Eval case dentist-keyword is not in dataset eval-retrieval');
    });

    it('links the spans of a traced turn inside the case to the dataset item', async () => {
      startTelemetry(withKeys, { exporter });

      const experiment = createEvalExperiment(withKeys);
      const identity = { source: 'eval', chatRef: 'eval', userRef: 'eval' } as const;

      await experiment.sync(DATASET, CASES);

      await experiment.runCase(
        DATASET,
        RUN,
        'dentist-keyword',
        () => traceTurn(identity, async () => ['dentist']),
        SCORE,
      );

      await stopTelemetry();

      const [turn] = spansNamed(exporter, 'turn');
      const [root] = spansNamed(exporter, 'experiment-item-run');

      expect(turn?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);

      expect(turn?.attributes).toMatchObject({
        [ITEM_ID]: evalItemId(DATASET.name, 'dentist-keyword'),
        'langfuse.trace.tags': ['eval'],
      });
    });
  });
});
