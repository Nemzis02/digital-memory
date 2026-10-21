# ADR 005: Tracing the Model Calls

## Context

ADR 004 left tracing open. Every text message is now a tool loop of up to four steps on the
strong model. The JSON log shows which tools ran, but not the prompt, the tool inputs and
outputs, the token count, the cost, or the time of each step. When an answer is wrong, there is
no record of what the model saw. An eval suite (spec `006-evals`) also needs a place to keep
its runs and compare them.

AI SDK 7 emits OpenTelemetry spans for `generateText`, `embedMany` and each tool call once a
telemetry integration is registered. Three options were considered:

- **Langfuse** through `@langfuse/vercel-ai-sdk`. It reads the AI SDK spans and shows them as
  LLM traces with cost, latency, prompt and tool steps. It also stores datasets and eval scores.
  Cloud free tier or self-hosted.
- **Plain OpenTelemetry** to Grafana Tempo or Honeycomb. It is vendor-neutral, but shows a model
  call as a generic span. Token cost, prompt views and datasets must be built by hand.
- **No tracing.** The log stays the only record.

## Decision

1. **Langfuse over OpenTelemetry.** `registerTelemetry` from `@langfuse/vercel-ai-sdk` runs once
   at startup, before the first model call. The OpenTelemetry Node SDK is the transport, so a
   second exporter can be added later without code changes in core.
2. **Tracing is optional.** With no `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`, nothing is
   registered and nothing leaves the process. `npm test` never exports.
3. **One trace per inbound message.** The trace carries the source (`telegram`, later `mcp`),
   the hashed chat ref, and the turn outcome (`answer`, `saved`, `forget`, `step-limit`,
   `timeout`). Ingestion runs started by `save_memory` belong to the same trace.
4. **Secrets never reach a span.** Span attributes go through the same masking as the logger
   (`src/core/logging/redact.ts`). Memory text and prompts are sent, because they are what a
   trace exists to show; this is a single-user service and the Langfuse project is private.
   The Telegram user id is hashed.
5. **Tracing code stays in `src/core/telemetry/`.** No other module imports Langfuse or
   OpenTelemetry. The AI SDK picks up the registered integration by itself.

## Consequences

- A second hop now receives the memory corpus in fragments: every prompt and tool output. This
  extends ADR 003 decision 2, which kept the corpus one hop from Google. A self-hosted Langfuse
  removes the hop; the Cloud tier is accepted for a learning project.
- Startup order matters: telemetry registers before any model client is created.
- Spec `006-evals` can push its runs to Langfuse datasets.

## Open

- Sampling. At one user, every message is traced. Revisit if the free-tier quota is reached.
- Self-hosting Langfuse next to Postgres in `docker-compose.yml`.

Spec `005-observability` carries the implementation.
