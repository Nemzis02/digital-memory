# Implementation Plan: 005 Observability

## 0. Directory Layout

```text
src/core/telemetry/
├── telemetry.ts        # startTelemetry(env), stopTelemetry(); the only Langfuse/OTel imports
├── attributes.ts       # turnAttributes(), hashed chat ref, masking through redact.ts
└── telemetry.test.ts
src/config/env.ts       # LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL (optional)
src/index.ts            # startTelemetry() first, stopTelemetry() in shutdown()
src/core/llm/router.ts  # per-call telemetry metadata (functionId, attributes)
src/core/agent/turn.ts  # outcome attribute
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

- `functionId`: `turn` for `runTurn()`, `ingest.enrich`, `ingest.extract`, `embed` for the
  pipeline and embedding calls. The router takes it as an option on each call.
- Attributes on the turn: `source`, `chat` (SHA-256 of the chat ref, first 16 hex characters),
  `outcome` (`answer`, `saved`, `forget`, `step-limit`, `timeout`, `error`).
- One trace per message. If the integration does not nest the `save_memory` ingestion under
  the turn by itself, pass the parent context explicitly; record the result in MEMORY.md as a
  library quirk.

## 3. Redaction

Prompts and memory text are sent (ADR 005 decision 4). Attribute values pass through
`maskSecrets` from `src/core/logging/redact.ts`, so a token pasted into a message is masked in
the trace as in the log. Add a test that a bot-token-shaped string in the user message does
not reach the exported span. Use an in-memory span exporter from the OpenTelemetry SDK for
this test.

## 4. Tests

- No keys: `startTelemetry` registers nothing; the router calls run as before.
- With an in-memory exporter: one scripted turn produces one root span with the attributes of
  section 2, and child spans per tool call.
- Masking: the case in section 3.
- Live check, by hand: one message through `npm run dev` with real keys, then the trace in the
  Langfuse UI. Note the result in the task.

## 5. Dependencies

Runtime: `@langfuse/vercel-ai-sdk`, `@langfuse/otel`, `@opentelemetry/api` (`~1.9`),
`@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/core`
(`^2`), and the OTLP exporters (`^0.223`). All stay on the OpenTelemetry JS 2.x line, which
is what `@langfuse/otel` 6 declares. Add a Dependabot group `telemetry` for `@langfuse/*`
and `@opentelemetry/*`.
