# Evals

A golden set for two scores: retrieval recall@5 and tool-choice accuracy. Every memory in it
is synthetic and written for this folder. Never add a real personal memory.

## Files

| File              | One line per                                  | Checked in CI by                |
| ----------------- | --------------------------------------------- | ------------------------------- |
| `corpus.jsonl`    | memory that the live run seeds into Qdrant    | `src/core/eval/dataset.test.ts` |
| `retrieval.jsonl` | search query and the corpus keys it must find | `src/core/eval/dataset.test.ts` |
| `turns.jsonl`     | agent message and the tools it must call      | `src/core/eval/dataset.test.ts` |
| `baseline.json`   | accepted scores, per case and total           | compared by the live run        |
| `last-run.json`   | scores of the last live run, not committed    | written by `npm run eval`       |

The schemas live in `src/core/eval/dataset.ts`. A row that does not match a schema fails
`npm test` with the file name and the line number.

## Row formats

A corpus row:

```json
{
  "key": "dentist",
  "type": "text",
  "text": "Dentist with Dr Varga on 2026-11-18 at 10:00.",
  "summary": "Dentist on 2026-11-18 at 10:00",
  "metadata": {
    "category": "health",
    "kind": "event",
    "location": "Valencia",
    "tags": ["#dentist"]
  },
  "event_at": "2026-11-18"
}
```

- `key`: a lowercase slug with hyphens, unique in the file. Retrieval cases point at it.
- `type`: `text` (the default), `photo`, `document`, `url` or `voice`. A `url` row also needs
  `source_url`. For the other file types, `text` holds what the pipeline would extract.
- `summary`: one sentence, under 160 characters, that names the specific thing.
- `metadata`: `category` and `kind` from the enums in `src/core/memory/payload.ts`, an optional
  `location`, and `tags` as `#slugs` with underscores (`#water_meter`). A tag must not repeat
  the category. Use at most 6 tags.
- `event_at`: `YYYY-MM-DD`, only for rows that have a date.

A retrieval case:

```json
{
  "key": "dentist-paraphrase",
  "query": "when is my teeth appointment",
  "expected": ["dentist", "dentist-duplicate"]
}
```

- `expected` holds 1 to 3 corpus keys, or `[]` for a query with no right answer. An empty case
  scores 1 only when the search returns nothing.
- Name the key after the query style: `-keyword`, `-paraphrase` or `-filter`, or start it with
  `no-answer-`.

A turn case:

```json
{
  "key": "follow-up-forget",
  "message": "Got it back, you can forget that one.",
  "context": [
    { "role": "user", "body": "Where did I leave my umbrella?" },
    { "role": "assistant", "body": "At the cafe on Calle Sueca." }
  ],
  "expected": ["forget_memory"]
}
```

- `expected` is a set of tool names: `search_memory`, `list_memories`, `save_memory` or
  `forget_memory`. `[]` means the agent must answer without a tool.
- An extra `search_memory` call never fails a case. Any other extra tool, or a missing tool,
  scores 0.
- `context` is optional. It holds the earlier turns of the conversation, oldest first.
- A `save_memory` case never writes a memory: the live run gives the agent a fake pipeline.

## How to add a case

1. Append one line to the file. The examples above are spread over several lines to read; in the
   file, each row is one line. Keep the key unique.
2. For a retrieval case, make sure every expected key exists in `corpus.jsonl`.
3. For a turn case that names a memory, make sure the corpus has exactly one matching memory,
   or `[]` as expected tools when the agent must ask which one.
4. Run `npm test`. `dataset.test.ts` fails on a malformed row without calling any model.
5. Run `npm run eval` and read the table. A new case starts with no baseline.

## How to accept a new baseline

`npm run eval` writes `last-run.json` and prints each case with its score, the baseline and the
delta. It does not fail on a drop. When the new scores are the ones to keep:

```sh
npm run eval:accept
```

This copies `last-run.json` to `baseline.json`. Commit `baseline.json` with the change that
caused the new scores.
