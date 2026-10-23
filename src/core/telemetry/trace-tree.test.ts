import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.ts';
import { memoryFakes, MESSAGE } from '../agent/fixtures.ts';
import { runTurn } from '../agent/turn.ts';
import { createEmbeddings, EMBEDDING_MODEL } from '../llm/embeddings.ts';
import { createRouter, FAST_MODEL, STRONG_MODEL } from '../llm/router.ts';
import { REDACTED, resetSecretsCache } from '../logging/redact.ts';
import { createIngestionPipeline } from '../pipeline/graph.ts';
import type { ObjectStorage } from '../storage/object-storage.ts';
import { DENSE_VECTOR_SIZE } from '../vector/vector-store.ts';
import { RecordingExporter } from './fixtures.ts';
import { startTelemetry, stopTelemetry } from './telemetry.ts';

const usage: LanguageModelV4GenerateResult['usage'] = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

function text(value: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text: value }],
    finishReason: { unified: 'stop', raw: undefined },
    usage,
    warnings: [],
  };
}

const models = vi.hoisted(() => ({
  fast: undefined as MockLanguageModelV4 | undefined,
  strong: undefined as MockLanguageModelV4 | undefined,
  embedding: undefined as MockEmbeddingModelV4 | undefined,
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () =>
    Object.assign(() => models.fast, { embedding: () => models.embedding }),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => () => models.strong,
}));

const BOT_TOKEN = '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // gitleaks:allow

const env = parseEnv({
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_ADMIN_ID: '123456789',
  DATABASE_URL: 'postgresql://digital_memory:pw@localhost:5432/digital_memory',
  QDRANT_URL: 'https://example.cloud.qdrant.io:6333',
  QDRANT_API_KEY: 'qdrant-key',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'digital-memory',
  LLM_FAST_API_KEY: 'llm-key',
  LLM_STRONG_API_KEY: 'anthropic-key',
  LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
  LANGFUSE_SECRET_KEY: 'sk-lf-test',
});

const storage: ObjectStorage = {
  upload: (input) =>
    Promise.resolve({
      key: 'documents/2026/10/note.txt',
      size: input.body.byteLength,
      contentType: 'text/plain',
    }),
  presignDownload: () => Promise.reject(new Error('not used')),
  openStream: () => Promise.reject(new Error('not used')),
  openSized: () => Promise.reject(new Error('not used')),
  remove: () => Promise.resolve(),
};

/** The names of a span and every ancestor, nearest first. */
function lineage(spans: readonly ReadableSpan[], span: ReadableSpan): string[] {
  const byId = new Map(spans.map((candidate) => [candidate.spanContext().spanId, candidate]));
  const names: string[] = [];
  let current: ReadableSpan | undefined = span;

  while (current !== undefined) {
    names.push(current.name);

    const parent: string | undefined = current.parentSpanContext?.spanId;

    current = parent === undefined ? undefined : byId.get(parent);
  }

  return names;
}

function only(spans: readonly ReadableSpan[], match: (span: ReadableSpan) => boolean) {
  const found = spans.filter(match);

  expect(found).toHaveLength(1);

  return found[0] as ReadableSpan;
}

describe('trace of a turn', () => {
  beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'warn');
  });

  afterEach(async () => {
    await stopTelemetry();
    vi.unstubAllEnvs();
    resetSecretsCache();
  });

  afterAll(() => {
    globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = undefined;
  });

  it('nests the save_memory ingestion under the tool span of the one turn trace', async () => {
    models.strong = new MockLanguageModelV4({
      provider: 'anthropic',
      modelId: STRONG_MODEL,
      doGenerate: [
        {
          content: [
            { type: 'tool-call', toolCallId: 'call-1', toolName: 'save_memory', input: '{}' },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          warnings: [],
        },
        text('Saved.'),
      ],
    });

    models.fast = new MockLanguageModelV4({
      provider: 'google',
      modelId: FAST_MODEL,
      doGenerate: async () =>
        text('{"summary":"Buy milk.","category":"shopping","kind":"task","tags":["#milk"]}'),
    });

    models.embedding = new MockEmbeddingModelV4({
      provider: 'google',
      modelId: EMBEDDING_MODEL,
      maxEmbeddingsPerCall: 64,
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => new Array<number>(DENSE_VECTOR_SIZE).fill(0.1)),
        warnings: [],
      }),
    });

    const exporter = new RecordingExporter();

    startTelemetry(env, { exporter });

    const router = createRouter(env);
    const embeddings = createEmbeddings(env);
    const { store } = memoryFakes();

    const pipeline = createIngestionPipeline({
      files: { download: () => Promise.reject(new Error('not used')) },
      storage,
      store,
      router,
      embeddings,
      urls: { fetch: () => Promise.reject(new Error('not used')) },
    });

    await runTurn(
      { model: router.model('strong'), store, embeddings, pipeline, source: 'telegram' },
      { ...MESSAGE, text: 'save: buy milk' },
      [],
    );

    await stopTelemetry();

    const { spans } = exporter;

    const agent = (name: string) => (span: ReadableSpan) =>
      span.attributes['gen_ai.agent.name'] === name;

    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1);

    const turn = only(spans, (span) => span.name === 'turn');

    expect(turn.parentSpanContext).toBeUndefined();

    expect(turn.attributes['langfuse.trace.metadata.outcome']).toBe(JSON.stringify('saved'));

    expect(lineage(spans, only(spans, agent('turn')))).toStrictEqual([
      `invoke_agent ${STRONG_MODEL}`,
      'turn',
    ]);

    const tool = 'execute_tool save_memory';

    expect(lineage(spans, only(spans, agent('ingest.enrich')))).toContain(tool);

    const embedded = spans.filter((span) => span.name === `embeddings ${EMBEDDING_MODEL}`);

    expect(embedded.length).toBeGreaterThan(0);

    for (const span of embedded) {
      expect(lineage(spans, span)).toContain(tool);
    }
  });

  it('exports no bot token that the user pasted into the message', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN);
    resetSecretsCache();

    models.strong = new MockLanguageModelV4({
      provider: 'anthropic',
      modelId: STRONG_MODEL,
      doGenerate: [text('Noted.')],
    });

    const exporter = new RecordingExporter();

    startTelemetry(env, { exporter });

    const { store, embeddings, pipeline } = memoryFakes();

    await runTurn(
      { model: createRouter(env).model('strong'), store, embeddings, pipeline, source: 'telegram' },
      { ...MESSAGE, text: `my bot token is ${BOT_TOKEN}` },
      [],
    );

    await stopTelemetry();

    const { spans } = exporter;

    expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain(BOT_TOKEN);

    const call = only(spans, (span) => span.name === `invoke_agent ${STRONG_MODEL}`);

    expect(call.attributes['gen_ai.input.messages']).toContain(`my bot token is ${REDACTED}`);
    expect(call.attributes['gen_ai.usage.input_tokens']).toBe(3);
  });
});
