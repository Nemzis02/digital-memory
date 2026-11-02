# Implementation Tasks: 007 Real BM25 Sparse Vectors

Answers the stack audit: the `bm25` sparse vector is a hashed term count, not BM25.

- [x] Task 1: Check local Qdrant BM25 inference and the JS encoder options. Measure recall@5
      for each viable option. Write ADR 006 with the numbers and the choice.
- [x] Task 2: The new sparse path in embeddings and the Qdrant store, under a new vector name.
      Tests.
- [x] Task 3: `npm run reindex` with the idempotent rerun test. Run it on the local collection.
      Live run 2026-10-29, local Qdrant 1.19.0: 119 points got `bm25_v2` in two pages of 64;
      the rerun reported 0. `updateVectors` accepts the `qdrant/bm25` document, so the dense
      vector and the payload are not rewritten.
- [x] Task 4: `npm run eval`, accept the baseline if recall@5 holds. Remove the old vector
      after the switch. Update README and MEMORY.md.
      Live run 2026-10-29 on the local collection: recall@5 0.96 on 47 cases against 0.95 on
      40, no case dropped, baseline accepted. `npm run reindex` dropped `bm25` with
      `deleteVectorName`; the comparison harness and `eval:sparse` are gone. Qdrant Cloud still
      needs one `npm run reindex` with `.env` pointed at the cluster.
