# ADR 006: Sparse Vectors

## Context

The sparse vector named `bm25` is not BM25. `embedSparse()` lower-cases the text, splits it on
letters and digits, hashes each token with FNV-1a and counts it. Qdrant adds IDF through the
`idf` modifier. There is no stemming, no stop words, no term frequency saturation and no length
normalisation, and two words can share a hash. A query for "dentists" does not match a memory
that says "dentist".

Three options were considered:

- **Qdrant server-side BM25.** Upsert and query send `{ text, model: 'qdrant/bm25' }` in place
  of a sparse vector. Qdrant tokenizes, removes stop words, stems with Snowball and computes the
  BM25 term weights; the `idf` modifier still adds IDF. Qdrant 1.15.2 added this to the
  open-source server, so the local `qdrant/qdrant:v1.19.0` image serves it, and Qdrant Cloud
  does too. No package is needed: `@qdrant/js-client-rest` 1.19 types the input as `Document`.
- **A BM25 encoder in the process.** No maintained JavaScript package exists. `fastembed-js`
  was archived on 2026-09-24, and its successor `qdrant-labs/fastembed-js` has dense models
  only. A hand-written encoder would copy what the server already does.
- **Keep the hashed vector** and give it an honest name.

### Measurement

`npm run eval:sparse` seeds the golden set into a temporary collection with all three sparse
vectors, then scores recall@5 on the sparse branch alone and on the hybrid search (dense plus
sparse, RRF, the same limits as `search()`). Seven keyword cases were added for this: five
plurals that the corpus holds only in the singular, and two forget requests with filler words.
A synthetic one-word memory, `junk-note`, gives the filler words something to match.

Run on 2026-10-29, Qdrant 1.19.0, `gemini-embedding-2`, 47 cases:

| Variant                                | Sparse only | Hybrid |
| -------------------------------------- | ----------- | ------ |
| Hashed (current)                       | 0.87        | 0.96   |
| `qdrant/bm25`, default options         | 0.98        | 0.96   |
| `qdrant/bm25`, `avg_len` 35.2 measured | 0.98        | 0.96   |

Cases where the sparse branch differs:

- `dentists`, `receipts`, `plumbers`, `recommendations`, `inspections`: the hashed vector
  finds nothing (0.00); both BM25 variants score 1.00.
- `japan-filter`: hashed 0.67, BM25 1.00.
- `restaurants-valencia`: the hashed vector scored 0.50 in an earlier run and 1.00 in this
  one. The BM25 variants scored 1.00 in every run.
- Top hit for "forget the note about the umbrella" and "delete that note about the wifi": the
  hashed vector and default BM25 rank the right memory first. With `avg_len` set to the
  measured mean, `junk-note` ranks first in both cases.

The hybrid score does not move: the dense branch already finds every plural. The two
`no-answer-*` cases score 0 under hybrid search for every variant, because the dense branch
always returns hits.

## Decision

1. **Qdrant server-side BM25 replaces the hashed vector.** Sparse-only recall@5 rises from
   0.87 to 0.98, and hybrid recall@5 does not drop. The keyword branch now matches word forms,
   so it covers queries where the dense branch is weak, such as codes and names.
2. **Default BM25 options, kept in one constant.** `k` 1.2, `b` 0.75, `avg_len` 256. The same
   options go to every upsert and every query. Do not set `avg_len` to the measured mean:
   memories are short, and a lower `avg_len` gives a one-word memory enough weight to rank
   first on a filler word.
3. **English only.** The default language is English: Snowball English stemmer and English
   stop words. The corpus holds no other language. "note" is not an English stop word.
4. **The vector is named `bm25_v2`** so the old and new vectors can live in one collection
   during the reindex. Its config keeps `modifier: 'idf'`.
5. **The sparse input stays the raw `embeddableText`**, without the task prefix, as ADR 003
   requires.

**Revisit when** a memory in another language lands, Qdrant Cloud starts to charge for BM25
inference, or the server stops accepting a `Document` for a sparse vector.

## Consequences

- The server builds the sparse vector. `embedSparse()` and its test go away, and the store
  tests assert the request shape, not the vector values.
- The server must be Qdrant 1.15.2 or later. Check the Qdrant Cloud cluster version before
  the reindex.
- Existing points need the new vector: a reindex from the stored text (spec 007 Task 3).
- The comparison harness and its script leave with the old vector in spec 007 Task 4.

## Open

- Spanish names and words in English memories are stemmed as English. `ascii_folding` and a
  second language are not measured.
- The filler-word cases rank the right memory first with both the hashed vector and default
  BM25, so they guard against a regression and do not show a gain.

Spec `007-sparse-bm25` carries the implementation.
