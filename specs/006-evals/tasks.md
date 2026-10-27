# Implementation Tasks: 006 Evals

Blocked on spec 005, for the Langfuse dataset runs (section 3 of the plan). Tasks 1-3 can start
before it. Answers the stack audit: no eval harness, so quality changes are not measured.

- [x] Task 1: Zod schemas and loader in `src/core/eval/dataset.ts`, scorers in `score.ts`,
      both with tests.
- [x] Task 2: The golden set in `evals/`: corpus, retrieval queries, turn messages, README.
      `dataset.test.ts` green.
- [ ] Task 3: `run.live.test.ts`: seed, retrieval recall, turn tool choice, cleanup, report
      table. `npm run eval` and `eval:accept`. First baseline committed.
- [ ] Task 4: Langfuse dataset runs when telemetry is on.
- [ ] Task 5: README section on evals with the baseline numbers, through `readme-updater`.
      `.gitignore` gets `evals/last-run.json`.
