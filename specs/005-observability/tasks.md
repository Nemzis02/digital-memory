# Implementation Tasks: 005 Observability

Blocked on spec 004 Task 5, because the `timeout` outcome comes from there. ADR 005 is the
decision. Answers the stack audit: no tracing of the agent loop.

- [x] Task 1: Optional `LANGFUSE_*` variables in `env.ts` with the both-or-neither refine,
      `.env.example`, env tests.
- [x] Task 2: `src/core/telemetry/` with `startTelemetry` and `stopTelemetry`, wired into
      `src/index.ts` startup and shutdown. Read the current integration docs first.
- [ ] Task 3: `functionId` and attributes through the router and `runTurn()`, the outcome
      attribute, the hashed chat ref.
- [ ] Task 4: Masking and the in-memory exporter tests.
- [ ] Task 5: Live check in the Langfuse UI. Update README (stack, env) with `readme-updater`.
      Add the Dependabot group. Run `security-review`, since `env.ts` changed.
