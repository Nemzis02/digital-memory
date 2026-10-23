# Implementation Plan: 005 Observability

## 0. Directory Layout

```text
src/core/telemetry/
├── telemetry.ts        # startTelemetry(env), stopTelemetry(), traceTurn(); the only Langfuse/OTel imports
├── attributes.ts       # turnAttributes(), hashRef(), the turn outcomes; no Langfuse/OTel imports
├── masking.ts          # MaskingSpanProcessor: maskSecrets over every span attribute
├── fixtures.ts         # RecordingExporter for the tests; not built
├── telemetry.test.ts
├── masking.test.ts
└── trace-tree.test.ts  # a real runTurn() through the AI SDK integration
src/config/env.ts       # LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL (optional)
src/index.ts            # startTelemetry() first, stopTelemetry() in shutdown()
src/core/llm/router.ts  # per-call telemetry metadata (functionId, attributes)
src/core/agent/turn.ts  # outcome attribute
src/core/ingestion/route.ts  # a captionless file save, traced like a turn
```

## 1. Startup

Read the current `@langfuse/vercel-ai-sdk` docs (context7 or langfuse.com) before writing
code: the package API moved between AI SDK 6 and 7. For AI SDK 7 it is
`registerTelemetry(new LangfuseVercelAiSdkIntegration())` once at startup, with a
`NodeTracerProvider` from `@opentelemetry/sdk-trace-node` that holds the
`LangfuseSpanProcessor` as transport. `NodeSDK` is not used: it also starts an OTLP logs
exporter from env and pulls in metrics and gRPC packages that tracing does not need.

`startTelemetry(env)` does nothing when either key is absent. Otherwise it registers and logs
`telemetry started` with the base URL. `stopTelemetry()` flushes, with a 5 s cap, and runs in
`shutdown()` before `closeDatabase()`. A flush failure is logged, never thrown.

The env refine follows the webhook pair in `env.ts`: both keys or neither.

## 2. What a Trace Carries

- `functionId`: `turn` for `runTurn()`, `ingest.enrich` and `ingest.extract` for the pipeline
  calls. The router takes it as an option on each call. Embedding calls carry none: the AI SDK
  writes `functionId` only on generation spans, and `embeddings <model>` already names them.
- Attributes on the turn: `source`, `chat` (SHA-256 of the chat ref, first 16 hex characters),
  `outcome` (`answer`, `saved`, `forget`, `step-limit`, `timeout`, `error`).
- One trace per message. The `save_memory` ingestion nests under the tool span by itself, also
  through LangGraph, so no parent context is passed.

AI SDK 7 `telemetry` options carry `functionId` but no `metadata`; the span shows it as
`gen_ai.agent.name`, not as the span name. Trace attributes therefore come from `@langfuse/tracing`:
`traceTurn()` opens a root `turn` observation inside `propagateAttributes`, which copies
`userId` (hashed user ref), `sessionId` and `metadata.chat` (hashed chat ref), `tags` and
`metadata.source` onto every span of the turn. The outcome is known only at the end, so it is
written onto the root span as `langfuse.trace.metadata.outcome`, JSON-encoded like propagated
metadata. A turn that throws without an outcome records `error`.

## 3. Redaction

Prompts and memory text are sent (ADR 005 decision 4). Attribute values pass through
`maskSecrets` from `src/core/logging/redact.ts`, so a token pasted into a message is masked in
the trace as in the log.

The `mask` option of `LangfuseSpanProcessor` is not used: it sees only the `langfuse.*` keys,
and the AI SDK writes prompts and tool data to `gen_ai.*` and `ai.*`. A `MaskingSpanProcessor`
masks every string attribute, event attribute and status message in `onEnding`, which runs
before any processor's `onEnd`. It does not use `redactValue`, whose key filter would blank the token counts.

The tests record spans with their own exporter, not the SDK `InMemorySpanExporter`, which
empties its spans on shutdown.

## 4. Tests

- No keys: `startTelemetry` registers nothing; the router calls run as before.
- With an in-memory exporter: one scripted turn produces one root span with the attributes of
  section 2, and child spans per tool call.
- Masking: a bot token in the user message of a real `runTurn()` does not reach any exported
  span, and the token counts stay.
- Restart: the AI SDK integration is registered once, so it gets a tracer that resolves the
  current provider on each call; the masking test runs a second turn after a restart.
- Live check, by hand: one message through `npm run dev` with real keys, then the trace in the
  Langfuse UI. Note the result in the task.

## 5. Dependencies

Runtime: `@langfuse/vercel-ai-sdk`, `@langfuse/otel`, `@langfuse/tracing`, `@opentelemetry/api` (`~1.9`),
`@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/core`
(`^2`), and the OTLP exporters (`^0.223`). All stay on the OpenTelemetry JS 2.x line, which
is what `@langfuse/otel` 6 declares. Add a Dependabot group `telemetry` for `@langfuse/*`
and `@opentelemetry/*`.
