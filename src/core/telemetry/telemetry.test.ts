import { diag, trace } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { registerTelemetry } from 'ai';
import type * as Ai from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.ts';
import { REDACTED, resetSecretsCache } from '../logging/redact.ts';
import { hashRef } from './attributes.ts';
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
});

function emitSpan(name: string): void {
  trace.getTracer('ai').startSpan(name).end();
}

const IDENTITY = { source: 'telegram', chatRef: '-1009876543210', userRef: '555000111' } as const;

function exported(exporter: RecordingExporter, name: string): ReadableSpan {
  const span = exporter.spans.find((candidate) => candidate.name === name);

  if (span === undefined) {
    throw new Error(`no span named ${name} was exported`);
  }

  return span;
}

function stderrRecords(write: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return write.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe('telemetry', () => {
  beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    vi.mocked(registerTelemetry).mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await stopTelemetry();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetSecretsCache();
  });

  it('registers nothing and records no span without the Langfuse keys', () => {
    expect(startTelemetry(withoutKeys)).toBe(false);
    expect(registerTelemetry).not.toHaveBeenCalled();

    const span = trace.getTracer('ai').startSpan('turn');

    expect(span.isRecording()).toBe(false);
    span.end();
  });

  it('registers the Langfuse integration and exports AI SDK spans on stop', async () => {
    const exporter = new RecordingExporter();

    expect(startTelemetry(withKeys, { exporter })).toBe(true);

    expect(registerTelemetry).toHaveBeenCalledExactlyOnceWith(
      expect.any(LangfuseVercelAiSdkIntegration),
    );

    emitSpan('turn');
    await stopTelemetry();

    expect(exporter.spans.map((span) => span.name)).toEqual(['turn']);
    expect(trace.getTracer('ai').startSpan('after').isRecording()).toBe(false);
  });

  it('registers the integration once across restarts and tolerates a second stop', async () => {
    startTelemetry(withKeys, { exporter: new RecordingExporter() });

    const registrations = vi.mocked(registerTelemetry).mock.calls.length;

    startTelemetry(withKeys, { exporter: new RecordingExporter() });
    await stopTelemetry();
    await stopTelemetry();

    const exporter = new RecordingExporter();

    startTelemetry(withKeys, { exporter });
    emitSpan('second run');
    await stopTelemetry();

    expect(registerTelemetry).toHaveBeenCalledTimes(registrations);
    expect(exporter.spans.map((span) => span.name)).toEqual(['second run']);
  });

  it('logs a failed flush instead of throwing', async () => {
    const exporter = new RecordingExporter();

    exporter.shutdown = () => Promise.reject(new Error('exporter down'));
    startTelemetry(withKeys, { exporter });

    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(stopTelemetry()).resolves.toBeUndefined();

    expect(stderrRecords(write).map((record) => record.message)).toContain(
      'telemetry flush failed',
    );
  });

  it('gives up on a flush that does not finish within 5 s', async () => {
    const exporter = new RecordingExporter();

    exporter.export = () => undefined;
    startTelemetry(withKeys, { exporter });
    emitSpan('stuck');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stopping = stopTelemetry();

    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;

    expect(stderrRecords(write).map((record) => record.message)).toContain(
      'telemetry flush timed out',
    );
  });

  it('routes OpenTelemetry diagnostics to the project logger', () => {
    startTelemetry(withKeys, { exporter: new RecordingExporter() });

    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    diag.warn('export failed', 401);

    expect(stderrRecords(write)).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'export failed', args: [401] }),
    );
  });

  it('runs a traced turn unchanged when telemetry is off', async () => {
    await expect(traceTurn(IDENTITY, () => Promise.resolve('reply'))).resolves.toBe('reply');

    await expect(
      traceTurn(IDENTITY, () => Promise.reject(new Error('model down'))),
    ).rejects.toThrow('model down');
  });

  it('exports the turn as the root span with hashed refs, the source and the outcome', async () => {
    const exporter = new RecordingExporter();

    startTelemetry(withKeys, { exporter });

    await traceTurn(IDENTITY, (setOutcome) => {
      emitSpan('invoke_agent claude-sonnet-5-5');
      setOutcome('saved');

      return Promise.resolve();
    });

    await stopTelemetry();

    const turn = exported(exporter, 'turn');
    const child = exported(exporter, 'invoke_agent claude-sonnet-5-5');
    const chat = hashRef(IDENTITY.chatRef);

    expect(turn.parentSpanContext).toBeUndefined();
    expect(child.parentSpanContext?.spanId).toBe(turn.spanContext().spanId);

    expect(turn.attributes).toMatchObject({
      'session.id': chat,
      'user.id': hashRef(IDENTITY.userRef),
      'langfuse.trace.tags': ['telegram'],
      'langfuse.trace.metadata.source': JSON.stringify('telegram'),
      'langfuse.trace.metadata.chat': JSON.stringify(chat),
      'langfuse.trace.metadata.outcome': JSON.stringify('saved'),
    });

    expect(child.attributes).toMatchObject({ 'session.id': chat });

    const sent = JSON.stringify(exporter.spans.map((span) => span.attributes));

    expect(sent).not.toContain(IDENTITY.chatRef);
    expect(sent).not.toContain(IDENTITY.userRef);
  });

  it('records the error outcome on a turn that throws without one', async () => {
    const exporter = new RecordingExporter();

    startTelemetry(withKeys, { exporter });

    await expect(
      traceTurn(IDENTITY, () => Promise.reject(new Error('model down'))),
    ).rejects.toThrow('model down');

    await stopTelemetry();

    expect(exported(exporter, 'turn').attributes).toMatchObject({
      'langfuse.trace.metadata.outcome': JSON.stringify('error'),
    });
  });

  it('keeps the outcome a turn set before it threw', async () => {
    const exporter = new RecordingExporter();

    startTelemetry(withKeys, { exporter });

    await expect(
      traceTurn(IDENTITY, (setOutcome) => {
        setOutcome('step-limit');

        return Promise.reject(new Error('still calling tools'));
      }),
    ).rejects.toThrow('still calling tools');

    await stopTelemetry();

    expect(exported(exporter, 'turn').attributes).toMatchObject({
      'langfuse.trace.metadata.outcome': JSON.stringify('step-limit'),
    });
  });

  it('masks a secret in an AI SDK attribute before the span is exported', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', RAW.TELEGRAM_BOT_TOKEN);
    resetSecretsCache();

    const exporter = new RecordingExporter();

    startTelemetry(withKeys, { exporter });

    trace
      .getTracer('ai')
      .startSpan('invoke_agent claude-sonnet-5-5', {
        attributes: { 'gen_ai.input.messages': `my token is ${RAW.TELEGRAM_BOT_TOKEN}` },
      })
      .end();

    await stopTelemetry();

    expect(exported(exporter, 'invoke_agent claude-sonnet-5-5').attributes).toMatchObject({
      'gen_ai.input.messages': `my token is ${REDACTED}`,
    });
  });
});
