# Implementation Tasks: 009 Bulk Forget

Blocked on nothing. ADR 007 is the decision; this spec is the plan.

- [x] Task 1: `forgetMemoryInput` takes `ids`; `forget_memory` accumulates candidates and
      rejects on any unshown id; prompt rule. Tests.
- [x] Task 2: `ForgetCandidate`, `TurnReply`, `forgetPrompt()`; `compose()` in `turn.ts`.
      Tests for two candidates and one.
- [x] Task 3: `forget_requests` table, `npm run db:generate`, `ForgetRequests` on Drizzle,
      integration test.
- [x] Task 4: `dispatch()` creates the request; `forgetMany()`; `forgetResult(removed, total)`.
      Tests.
- [x] Task 5: Bot: `take()`, `forget(ids)`, keyboard removal, used-request answer. Wiring in
      `bot.ts` and `index.ts`. Tests.
- [x] Task 6: Amend ADR 002, ADR 004, specs 002 and 003; MEMORY.md callback-data entry; README
      through `readme-updater`. `change-review`, then `security-review`.
