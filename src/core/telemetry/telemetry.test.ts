import { diag, trace } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { registerTelemetry } from 'ai';
import type * as Ai from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.ts';
import { startTelemetry, stopTelemetry } from './telemetry.ts';

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

class RecordingExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    this.spans.push(...spans);
    done({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function emitSpan(name: string): void {
  trace.getTracer('ai').startSpan(name).end();
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
});
