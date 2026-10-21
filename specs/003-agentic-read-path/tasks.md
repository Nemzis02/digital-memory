# Implementation Tasks: 003 Agentic Read Path

Blocked on nothing. ADR 004 is the decision; this spec is the plan.

- [x] Task 1: Split `search()` out of `ask()` in `query.ts`. `ask()` calls it. No behaviour
      change; existing tests stay green.
- [x] Task 2: `ChatModel.run()` in the router, over `generateText` with `tools` and
      `stopWhen`. Tests with the mock language model.
- [ ] Task 3: The four tools in `src/core/agent/tools.ts`, with the memory content fence.
      Export the Zod filter schemas for `search_memory` and `list_memories` from their own
      module (e.g. `src/core/agent/schemas.ts`), not from `tools.ts`. The Phase 2 MCP server
      imports them so its `search_memory` input (ADR 002 decision 1) matches the bot's. MCP
      shares the schemas and core functions only; it registers its own tool handlers.
- [ ] Task 4: `runTurn()` and reply composition, including the forget candidate and the
      save confirmation. Scripted-model tests for every user story in the spec.
- [ ] Task 5: Wire `dispatch()` to `runTurn()`. Captionless files bypass it. Undo re-runs with
      saving disabled.
- [ ] Task 6: Delete `intent.ts`, `classifier.ts` and their tests. Remove the fast-model
      classification from `src/index.ts`.
- [ ] Task 7: Live run through `npm run test:live` against real models, then update README
      features and mark ADR 002 decisions 3 and 4 superseded by ADR 004.
