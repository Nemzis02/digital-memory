# Implementation Plan: 007 Real BM25 Sparse Vectors

## 0. Decision First

Task 1 writes `docs/adr/006-sparse-vectors.md`. Measure, then decide between:

- **Qdrant server-side inference.** Upsert and query send `{ text, model: 'qdrant/bm25' }`
  in place of a sparse vector; Qdrant tokenizes, stems and computes BM25. Check two things
  first: whether the local `qdrant/qdrant` image in `docker-compose.yml` serves BM25 inference
  (Qdrant Cloud does), and the exact JS client shape in the current `@qdrant/js-client-rest`
  docs. If local Docker cannot do it, this option needs a second code path for tests and
  local runs, which counts against it.
- **Local BM25 in the process.** A maintained JS BM25 sparse encoder (FastEmbed-compatible
  tokenizer and stemmer). Same vectors locally and in the cloud, no network change. Check
  that a maintained package exists in October 2026; if none, this option falls.
- **Keep the current vector** and rename it honestly. Valid only if the evals show no gain.

The ADR records recall@5 for each measured option on the golden set, and the languages the
chosen tokenizer stems. MEMORY.md gets the library quirks found on the way.

## 1. Code (after the ADR)

- `Embeddings.embedSparse` changes or moves behind the vector store, depending on the option.
  For server-side inference, the sparse input becomes text and `src/core/vector/qdrant.ts`
  builds the inference object; `embedSparse()` and its test go away.
- ADR 003 Consequences say sparse vectors stay on the raw text, without the task prefix. Keep
  that rule.
- The sparse vector name changes from `bm25` to a new name such as `bm25_v2`, so old and new
  vectors can live in one collection during the reindex.

## 2. Reindex

`src/core/vector/reindex.ts`, run with `npm run reindex`: scroll all points, compute the new
sparse vector from the stored text, `updateVectors` in batches of 64, log progress. Then
search switches to the new vector name, and a second step removes the old named vector with
the collection update API. The script is idempotent: a rerun skips points that already have
the new vector. Run it on the local collection first, then on Qdrant Cloud.

## 3. Tests

- Unit: the sparse input for a text matches the chosen model's contract.
- Qdrant store tests: query and upsert use the new vector name and shape.
- Reindex: over an in-memory fake store, a second run changes nothing.
- Evals: `npm run eval` before and after; both numbers go into the ADR. Accept the new
  baseline only if recall@5 did not drop.

## 4. Dependencies

Depends on the option: none for server-side inference, one package for the local encoder.
