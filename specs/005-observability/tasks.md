# Implementation Tasks: 005 Observability

Blocked on spec 004 Task 5, because the `timeout` outcome comes from there. ADR 005 is the
decision. Answers the stack audit: no tracing of the agent loop.

- [x] Task 1: Optional `LANGFUSE_*` variables in `env.ts` with the both-or-neither refine,
      `.env.example`, env tests.
- [x] Task 2: `src/core/telemetry/` with `startTelemetry` and `stopTelemetry`, wired into
      `src/index.ts` startup and shutdown. Read the current integration docs first.
- [x] Task 3: `functionId` and attributes through the router and `runTurn()`, the outcome
      attribute, the hashed chat ref.
- [x] Task 4: Masking and the in-memory exporter tests.
- [x] Task 5: Live check in the Langfuse UI. Update README (stack, env) with `readme-updater`.
      Add the Dependabot group. Run `security-review`, since `env.ts` changed.
      Live check 2026-10-23, Langfuse Cloud EU: a question and a document each gave one trace
      with a `turn` root, outcomes `answer` and `saved`, tag and `metadata.source` `telegram`,
      the same 16-hex `userId`, `sessionId` and `metadata.chat`, and `functionId` `turn`,
      `ingest.extract` and `ingest.enrich` as `gen_ai.agent.name`. Generations carry tokens and
      cost. No env secret and no raw Telegram id is in the export. The `save_memory` nesting was
      not exercised live; the trace-tree test covers it. The v1 `GET /api/public/traces` returns
      410; read through `/api/public/v2/observations`.
