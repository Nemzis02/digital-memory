# Implementation Tasks: 006 Evals

Blocked on spec 005, for the Langfuse dataset runs (section 3 of the plan). Tasks 1-3 can start
before it. Answers the stack audit: no eval harness, so quality changes are not measured.

- [x] Task 1: Zod schemas and loader in `src/core/eval/dataset.ts`, scorers in `score.ts`,
      both with tests.
- [x] Task 2: The golden set in `evals/`: corpus, retrieval queries, turn messages, README.
      `dataset.test.ts` green.
- [x] Task 3: `run.live.test.ts`: seed, retrieval recall, turn tool choice, cleanup, report
      table. `npm run eval` and `eval:accept`. First baseline committed.
- [x] Task 4: Langfuse dataset runs when telemetry is on.
      Live check 2026-10-27, Langfuse Cloud EU: one `npm run eval` gave one experiment per
      dataset, both named by `ran_at`, with 40 and 27 items. Every item has a trace in the
      `sdk-experiment` environment and one score. The score means match `last-run.json`. A
      turn trace nests `turn`, the model steps, `search_memory` and the embeddings under
      `experiment-item-run`. SDK v6 has no `datasets.getRuns`; read runs through
      `api.experiments.list` and `api.experiments.listItems`.
- [x] Task 5: README section on evals with the baseline numbers, through `readme-updater`.
      `.gitignore` gets `evals/last-run.json`.
