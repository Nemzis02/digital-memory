import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  LangfuseOtelSpanAttributes,
  propagateAttributes,
  startActiveObservation,
} from '@langfuse/tracing';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { context, diag, DiagLogLevel, propagation, trace } from '@opentelemetry/api';
import type { DiagLogger } from '@opentelemetry/api';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerTelemetry } from 'ai';
import type { Env } from '../../config/env.ts';
import { logger } from '../logging/logger.ts';
import { maskSecrets, redactValue } from '../logging/redact.ts';
import { turnAttributes, type TurnIdentity, type TurnOutcome } from './attributes.ts';

const log = logger.child({ module: 'telemetry' });

const FLUSH_TIMEOUT_MS = 5_000;

const OUTCOME_ATTRIBUTE = `${LangfuseOtelSpanAttributes.TRACE_METADATA}.outcome`;

export type SetOutcome = (outcome: TurnOutcome) => void;

export interface TelemetryOptions {
  exporter?: SpanExporter;
}

const diagLogger: DiagLogger = {
  error: (message, ...args) => log.error(message, { args }),
  warn: (message, ...args) => log.warn(message, { args }),
  info: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
};

const mask = ({ data }: { data: unknown }): unknown =>
  typeof data === 'string' ? maskSecrets(data) : redactValue(data);

let provider: NodeTracerProvider | undefined;

let integrationRegistered = false;

export function startTelemetry(env: Env, options: TelemetryOptions = {}): boolean {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;

  if (publicKey === undefined || secretKey === undefined) {
    return false;
  }

  if (provider !== undefined) {
    return true;
  }

  const processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: env.LANGFUSE_BASE_URL,
    environment: env.NODE_ENV,
    mask,
    ...(options.exporter === undefined ? {} : { exporter: options.exporter }),
  });

  provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  diag.setLogger(diagLogger, DiagLogLevel.WARN);

  if (!integrationRegistered) {
    registerTelemetry(new LangfuseVercelAiSdkIntegration());
    integrationRegistered = true;
  }

  log.info('telemetry started', { baseUrl: env.LANGFUSE_BASE_URL });

  return true;
}

async function flushAndShutdown(open: NodeTracerProvider): Promise<void> {
  await open.forceFlush();
  await open.shutdown();
}

export async function stopTelemetry(): Promise<void> {
  const open = provider;

  provider = undefined;

  if (open === undefined) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout');
    }, FLUSH_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([flushAndShutdown(open), deadline]);

    if (result === 'timeout') {
      log.warn('telemetry flush timed out', { ms: FLUSH_TIMEOUT_MS });
    }
  } catch (error) {
    log.warn('telemetry flush failed', { error });
  } finally {
    clearTimeout(timer);
    trace.disable();
    context.disable();
    propagation.disable();
    diag.disable();
  }
}

export function traceTurn<T>(
  identity: TurnIdentity,
  run: (setOutcome: SetOutcome) => Promise<T>,
): Promise<T> {
  return propagateAttributes(turnAttributes(identity), () =>
    startActiveObservation(
      'turn',
      async (observation) => {
        let outcome: TurnOutcome | undefined;

        const setOutcome: SetOutcome = (value) => {
          outcome = value;
          observation.otelSpan.setAttribute(OUTCOME_ATTRIBUTE, JSON.stringify(value));
        };

        try {
          return await run(setOutcome);
        } catch (error) {
          if (outcome === undefined) {
            setOutcome('error');
          }

          throw error;
        }
      },
      { asType: 'agent' },
    ),
  );
}
