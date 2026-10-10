# Implementation Plan: 002 Retrieval

## 0. Directory Layout

```text
src/core/
├── retrieval/
│   ├── intent.ts        # Intent union + IntentClassifier port
│   ├── query.ts         # ask() and recall(), the two entry points
│   └── answer.ts        # Answer, Citation
└── llm/
    ├── router.ts        # model selection: fast for ingest/classify, strong for answers
    └── embeddings.ts    # embed(text) -> dense, embedSparse(text) -> term frequencies
```

`src/core/vector/` already provides everything the store side needs: `search()` for the hybrid
path, `list()` for the filter-only path, `fetch()` for parent lookup.

## 1. The Four Intents

A structured-output call on a cheap model maps an inbound message to exactly one intent. It
sees `contextWindow()` for that chat — the recent turns, not the whole history — and returns
the intent plus whatever slots it could fill. It never answers.

| Intent             | Path                                                      | Model calls  |
| ------------------ | --------------------------------------------------------- | ------------ |
| `save`             | Spec 001 ingestion pipeline                               | enrichment   |
| `ask`              | Embed → hybrid `search()` → parent `fetch()` → synthesise | 2            |
| `recall-by-filter` | Slots → `MemoryFilter` → `list()`                         | 1 (classify) |
| `forget`           | Resolve to ids → confirm → `remove()`                     | 1 (classify) |

`recall-by-filter` exists because "what is coming up" is a payload query, not a similarity
question. Routing it through embeddings would cost a model call to answer worse.

## 2. ask()

1. Embed the question into both a dense vector and BM25 term frequencies.
2. `search()` with any filter slots the classifier filled, over children.
3. `fetch()` the parents of the hits — the child is what matched, the parent is what the model
   should read. This is the point of parent-child chunking.
4. Synthesise with the strong model, over parent text only.
5. Return `{ answer, citations }`, one citation per parent, each with `id`, `summary`, and a
   pre-signed URL when `r2_file_path` is set.

A question that retrieves nothing must answer "nothing found", never an unsourced answer from
the model's own knowledge.

## 3. forget()

Deletes the parent **and** its children: `list({ filter: { parentId } })` then `remove()` over
both sets. Deleting only the parent leaves chunks that still match searches and can no longer
be reached or removed. Destructive, so the bot confirms before calling it.

## 4. Client Split (ADR 002)

- **Telegram** calls `ask()` and `recall()`; it has no model.
- **MCP** exposes `search_memory`, `get_memory`, `get_file_link` and the ingestion tools, and
  does **not** expose `ask()`. The client is Claude; synthesising first would summarise a
  summary and blur the citations.

## 5. Dependencies

Needs `src/core/llm/`, which does not exist. Nothing in this spec can be built before the
embedding model is chosen, because `DENSE_VECTOR_SIZE` must match it.
