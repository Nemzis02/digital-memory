# Implementation Tasks: 002 Retrieval

Unblocked. Dense vectors are 1536, from `gemini-embedding-2` (spec 001 Task 6). Every memory has
at least one child, so `ask()` can filter on `isChild` without missing the short ones.

- [x] Task 1: `IntentClassifier` port and its structured-output implementation over the fast
      model, returning one of `save`, `ask`, `recall-by-filter`, `forget` plus filled slots.
- [x] Task 2: `recall()` — slots to `MemoryFilter` to `list()`. No embedding, no synthesis.
- [x] Task 3: `ask()` — embed, hybrid search over children, fetch parents, synthesise, cite.
- [ ] Task 4: `forget()` — resolve parent and children, confirm, remove both.
- [ ] Task 5: Wire the four intents into the bot's router and replace the Task 5 stub.
