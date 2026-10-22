# Implementation Tasks: 004 Stack Currency

Blocked on nothing. Answers the October 2026 stack audit: MCP documented over the deprecated
SSE transport, MCP listed as built, `engines.node` behind `.nvmrc`, no Telegram 429 retry, no
turn timeout, no release process, no license.

- [x] Task 1: MCP wording in AGENTS.md, ADR 001 decision 3, ADR 002 decision 7, the PORT
      comment in `src/config/env.ts` and the README, per plan section 1. Check the current MCP
      spec revision first. No code change.
- [ ] Task 2: `engines.node` to `>=24.0.0`. `npm update`, then lint, typecheck, test, build.
- [ ] Task 3: `@grammyjs/auto-retry` in `createBot()`, with the bot test.
- [ ] Task 4: `abortSignal` on `ChatModel.run()`, router test.
- [ ] Task 5: 30 s budget in `runTurn()`, timeout reply, saved-then-timeout case, turn tests.
      Move the timeout from ADR 004 Open to a decision.
- [ ] Task 6: release-please workflow and config files. `LICENSE` and `SECURITY.md`.
- [ ] Task 7: `readme-updater`, then `change-review`. Report the manual repository setting
      (private vulnerability reporting) to the user.
