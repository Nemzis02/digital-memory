# Implementation Tasks: 007 Real BM25 Sparse Vectors

Answers the stack audit: the `bm25` sparse vector is a hashed term count, not BM25.

- [x] Task 1: Check local Qdrant BM25 inference and the JS encoder options. Measure recall@5
      for each viable option. Write ADR 006 with the numbers and the choice.
- [x] Task 2: The new sparse path in embeddings and the Qdrant store, under a new vector name.
      Tests.
- [ ] Task 3: `npm run reindex` with the idempotent rerun test. Run it on the local collection.
- [ ] Task 4: `npm run eval`, accept the baseline if recall@5 holds. Remove the old vector
      after the switch. Update README and MEMORY.md.
