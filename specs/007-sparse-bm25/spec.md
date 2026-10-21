# Feature Spec: 007 Real BM25 Sparse Vectors

## Goal

Replace the hashed term-frequency vector that `embedSparse()` builds with a real BM25 sparse
model, and prove with the spec 006 evals that keyword retrieval got better, not worse.

Today `embedSparse()` lower-cases the text, splits it on letters and digits, hashes each token
with FNV-1a and counts it. Qdrant applies IDF through the `idf` modifier. There is no term
frequency saturation, no length normalisation, no stemming and no stop words, and two words
can share a hash. The vector is named `bm25`, which it is not.

## User Stories

- As a user, "dentist" and "dentists" find the same memory.
- As a user, a filler word such as "note" or "the" in my question does not pull a short junk
  memory to the top of the keyword branch.
- As the maintainer, the switch keeps or raises recall@5 on the golden set, and the result is
  recorded in the ADR.
- As the maintainer, I reindex an existing collection with one command, and the bot keeps
  working during it.

## Out of Scope

Dense model changes. Re-ranking and HyDE (ADR 002 Open). Languages other than the ones the
corpus already holds; note in the ADR which languages the chosen model stems.
