# Implementation Plan: 006 Evals

## 0. Directory Layout

```text
evals/
├── corpus.jsonl          # 40-60 synthetic memories: text, type, metadata, a stable key
├── retrieval.jsonl       # query -> expected corpus keys (1-3 each)
├── turns.jsonl           # message (+ optional context) -> expected tool names, in any order
├── baseline.json         # last accepted scores, per case and total; committed
└── README.md             # how to add a case, how to accept a new baseline
src/core/eval/
├── dataset.ts            # Zod schemas for the three files, loader
├── score.ts              # recallAtK(), toolChoice(): pure functions
├── score.test.ts         # runs in CI
├── seed.ts               # corpus rows -> eval points, seeding and the eval sweep; tested in CI
├── report.ts             # run file schema, baseline compare, table; tested in CI
├── accept.ts             # copies evals/last-run.json to evals/baseline.json
├── dataset.test.ts       # runs in CI: every file parses, every expected key exists in the corpus
└── run.live.test.ts      # LLM_LIVE=1 only: seeds, measures, compares, cleans up
```

`src/core/eval/` holds the scorers and loaders, so they follow the `src/core` rules.
`evals/` holds data only.

## 1. Golden Set

The corpus is synthetic and written for this file: no real personal memory is committed.
It covers each `kind` and `category` the enrichment prompt uses, dated events, a saved web
page, a near-duplicate pair, and one memory whose text says "ignore previous instructions".

`retrieval.jsonl` has 30-40 queries: keyword-like ("dentist"), paraphrase ("when is my teeth
appointment"), filter-like ("restaurants in Valencia"), and two with no right answer, which
score on returning nothing relevant in the top 5.

`turns.jsonl` has 20-30 messages: plain question, filter question, save, save plus ask, forget,
small talk, follow-up with context. Expected tools are a set; extra `search_memory` calls do
not fail a case, a missing or wrong tool does. `save_memory` in a case runs against a fake
pipeline, so turns evals never write a memory.

## 2. Live Run

`run.live.test.ts`, gated like `src/core/agent/live.test.ts` (`LLM_LIVE=1` and the keys):

1. Seed the corpus into Qdrant with `source: 'eval'` through the real embeddings and the
   existing upsert path. Skip enrichment: corpus rows carry their own metadata. The payload
   `source` is a closed enum (`MEMORY_SOURCES` in `src/core/memory/payload.ts`), so add
   `eval` to it. Retrieval must never return an `eval` point to a real user: check that
   the bot's search filters by `source`, and add that filter if it does not.
2. Retrieval: `search()` per query, recall@5 over parent ids mapped back to corpus keys.
3. Turns: `runTurn()` with the real strong model, the real store, and a fake pipeline. Score
   the tool names from `calls`.
4. Write `evals/last-run.json` (git-ignored). Print a table: case, score, baseline, delta.
5. Delete every point with `source: 'eval'` in `afterAll`, also after a failure.

The run does not fail on a score drop; it reports. `npm run eval:accept` copies the last run
to `baseline.json`.

## 3. Langfuse

When telemetry is on (spec 005), each case runs inside a Langfuse dataset item, with the two
scores attached to its trace. Read the current Langfuse JS SDK docs for the dataset API.
When telemetry is off, the run works the same and only writes the local files.

## 4. Scripts

```text
"eval": "LLM_LIVE=1 node --env-file=.env ./node_modules/vitest/vitest.mjs run src/core/eval/run.live.test.ts",
"eval:accept": "node src/core/eval/accept.ts"
```

`vitest.config.ts` coverage excludes `run.live.test.ts` the same way `fixtures.ts` is excluded.

## 5. Tests in CI

`score.test.ts`: recall@k edge cases (no expected, fewer than k results, duplicates),
tool-choice set rules. `dataset.test.ts`: the three files parse, keys are unique, every
expected key is in the corpus.

## 6. Dependencies

`@langfuse/client` for the dataset runs: the tracing packages have no dataset or experiment
API. It is imported only in `src/core/telemetry/`. `evalite` was considered; plain Vitest
keeps one test runner and the live gating the project already uses.
