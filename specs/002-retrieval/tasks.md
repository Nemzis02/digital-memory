# Implementation Tasks: 002 Retrieval

Blocked on spec 001 Task 6 (`src/core/llm/`). The embedding model decides
`DENSE_VECTOR_SIZE`, and indexing anything before it is settled means re-indexing.

- [ ] Task 1: `IntentClassifier` port and its structured-output implementation over the fast
      model, returning one of `save`, `ask`, `recall-by-filter`, `forget` plus filled slots.
- [ ] Task 2: `recall()` — slots to `MemoryFilter` to `list()`. No embedding, no synthesis.
- [ ] Task 3: `ask()` — embed, hybrid search over children, fetch parents, synthesise, cite.
- [ ] Task 4: `forget()` — resolve parent and children, confirm, remove both.
- [ ] Task 5: Wire the four intents into the bot's router and replace the Task 5 stub.
