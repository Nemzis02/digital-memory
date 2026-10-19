# Implementation Tasks: 001 Telegram Ingestion

- [x] Task 1: Initialize TypeScript Node.js project (`package.json`, `tsconfig.json`, ESLint/Prettier).
- [x] Task 2: Setup environment config validation (`zod` + built-in `process.loadEnvFile()`).
- [x] Task 3: Implement Cloudflare R2 client (`src/core/storage/r2.ts`) with Pre-signed URL generation.
- [x] Task 4: Implement Qdrant client (`src/core/vector/qdrant.ts`) with Hybrid Search collection init.
- [x] Task 5: Build basic `grammY` Telegram bot listener (started from `src/index.ts`).
- [x] Task 6: Implement the LLM router and embeddings (`src/core/llm/`); settles `DENSE_VECTOR_SIZE`.
- [x] Task 7: Assemble the LangGraph ingestion pipeline (`src/core/pipeline/`) per plan §2.

The read path is spec `002-retrieval`. The MCP server is Phase 2 and has no spec yet. Anything
not listed above is deferred on purpose, not forgotten.

## Task 1 — Done (2026-10-10)

ESM TypeScript project on Node >= 22.18 using native type stripping (no `tsx`/`ts-node`).

| File                                    | Purpose                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `package.json`                          | ESM, scripts, pinned dependency set from plan §3                         |
| `tsconfig.json`                         | `NodeNext`, `strict`, `erasableSyntaxOnly`, `exactOptionalPropertyTypes` |
| `tsconfig.build.json`                   | Build config that excludes `*.test.ts` from `dist/`                      |
| `eslint.config.js`                      | Flat config, type-checked rules, AGENTS.md guardrails                    |
| `.prettierrc.json`                      | 100 cols, single quotes, `objectWrap: preserve`                          |
| `.editorconfig`, `.nvmrc`, `.gitignore` | Editor/runtime/VCS hygiene                                               |

Two AGENTS.md rules are enforced by the linter rather than by review:
`no-restricted-syntax` rejects public `pub-*.r2.dev` URL literals (rule 1), and
`no-restricted-imports` blocks `src/bot/` <-> `src/mcp/` cross-imports (rule 2).

## Task 2 — Done (2026-10-10)

| File                     | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `src/config/env.ts`      | Zod schema, `parseEnv()`, cached `getEnv()`, `r2Endpoint()`   |
| `src/config/load-env.ts` | `process.loadEnvFile()` shim for non-`--env-file` runtimes    |
| `src/config/env.test.ts` | 5 vitest cases covering defaults, coercion, and failure modes |
| `.env.example`           | Documented template for all required variables                |

Beyond the plan §4 list, the schema adds `NODE_ENV`, `LOG_LEVEL`, `QDRANT_COLLECTION`
(default `digital_memory`), and `R2_PRESIGN_TTL_SECONDS` (default and hard max `900`, enforcing
the 15-minute pre-signed URL ceiling at boot). Validation is lazy via `getEnv()` so lint,
typecheck, and tests run without a populated `.env`; all failures are reported in one error.

## Cross-cutting infrastructure (2026-10-10)

Not a numbered task — repo-wide scaffolding added alongside Tasks 1 and 2.

| File                       | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `.github/workflows/ci.yml` | format → lint → typecheck → coverage → build → audit, plus gitleaks     |
| `.github/dependabot.yml`   | Weekly grouped npm updates, monthly action updates                      |
| `.vscode/settings.json`    | Points `[typescript]` at Prettier; workspace TS SDK                     |
| `.vscode/extensions.json`  | Recommends Prettier, ESLint, EditorConfig                               |
| `vitest.config.ts`         | V8 coverage with 80% thresholds on all four metrics                     |
| `.npmrc`                   | `engine-strict=true` so the Node floor is enforced, not advisory        |
| `src/core/logging/`        | `logger.ts` + `redact.ts`, structured logging with credential scrubbing |

Both AGENTS.md architecture rules are now enforced by `no-restricted-imports`: `src/bot/` and
`src/mcp/` may import neither each other nor `@qdrant/*`, `@aws-sdk/*`, `@langchain/*` directly.
Verified by linting a throwaway `src/bot/` file that imports the Qdrant client.

`src/core/logging/redact.ts` reads secret values straight from `process.env` rather than via `getEnv()`,
so it still redacts correctly when configuration validation is the thing that failed.

## PostgreSQL and Drizzle (2026-10-10)

Added when ADR 002 decision 6 was revised; also not a numbered task.

| File                    | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `docker-compose.yml`    | `postgres:16-alpine` and `qdrant/qdrant`, both started by default       |
| `drizzle.config.ts`     | Points drizzle-kit at `src/core/db/schema.ts`, migrations in `drizzle/` |
| `src/core/db/schema.ts` | Users, OAuth2 tables, `conversations`, `conversation_turns`             |
| `src/core/db/client.ts` | `pool()`, `database()`, `closeDatabase()`                               |

The OAuth tables store `code_hash` and `token_hash`, never the credential, so a dump of the
database is not a set of working logins. `conversations` and `conversation_turns` hold chat
context for ADR 002 decision 5; those rows are not memories and never go to Qdrant. One
`pg.Pool` is shared: Drizzle wraps it and the LangGraph checkpointer is constructed from the
same instance rather than opening its own.

Qdrant runs locally by default, next to Postgres. Qdrant Cloud replaces that service when the
project is published; until then `QDRANT_URL` points at `http://localhost:6333`.

`drizzle-kit` pulls the deprecated `@esbuild-kit/*` packages, which carry a moderate esbuild
advisory. It is a build-time dependency and the CI gate is `--audit-level=high`, so this is
accepted rather than overridden.

## Task 3 — Done (2026-10-10)

| File                                 | Purpose                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| `src/core/storage/object-storage.ts` | `ObjectStorage` port, `ObjectNotFoundError`, upload/result types |
| `src/core/storage/content.ts`        | `resolveContent()` over `file-type`, plus the key layout         |
| `src/core/storage/r2.ts`             | R2 adapter: `createR2Storage()`, cached `r2Storage()`            |
| `src/core/storage/*.test.ts`         | 13 vitest cases against a mocked `@aws-sdk/client-s3`            |

The rest of the codebase depends on `ObjectStorage` — `upload`, `presignDownload`,
`openStream`, `remove` — and never on `r2.ts`. The port exists so pipeline tests get a fake
and so SDK types stop at this folder, not because a move off Cloudflare is planned.
`presignDownload` takes a TTL but clamps it to `R2_PRESIGN_TTL_SECONDS`, so no caller can
widen the 15-minute window, and nothing anywhere builds a URL by hand.

Telegram's `mime_type` and `file_name` are both sender-supplied, so `resolveContent()` sniffs
the bytes with `file-type` and returns the MIME type and extension together. The sender's
labels are reached only for formats with no magic number — text, CSV, SVG — and the declared
type must parse as a bare MIME token before it is used. Keys are
`<photos|documents|voice>/<yyyy>/<mm>/<uuid>.<ext>`. Objects are written with
`Content-Disposition: attachment`, which is what stops a pre-signed URL rendering a sender's
SVG on `*.r2.cloudflarestorage.com` — sniffing cannot, since SVG is XML with no signature.

## Task 4 — Done (2026-10-10)

| File                              | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `src/core/memory/payload.ts`      | `MemoryPayload` zod schema from plan §1, `parseMemoryPayload()`   |
| `src/core/memory/id.ts`           | `memoryId()` / `chunkId()`, UUIDv5 over `source` and `source_ref` |
| `src/core/vector/vector-store.ts` | `VectorStore` port, `MemoryFilter`, `DENSE_VECTOR_SIZE`           |
| `src/core/vector/qdrant.ts`       | Qdrant adapter: `createQdrantStore()`, cached `qdrantStore()`     |
| `src/core/**/*.test.ts`           | 36 vitest cases against a mocked `@qdrant/js-client-rest`         |

The collection carries a named dense vector (`dense`, Cosine) and a named sparse vector
(`bm25`) declared with `modifier: 'idf'`, so a stored sparse vector holds term frequencies
and Qdrant weights the query by collection-wide document frequency. Payload indexes cover
every field `MemoryFilter` can narrow on, which is what lets the metadata filter run before
the vector search rather than after it. `init()` is idempotent and re-runs the index
creation even when the collection exists.

A hybrid query prefetches both branches at 4× the limit and fuses with RRF; the filter is
repeated on each branch because fusion only merges what the branches returned. A query with
one vector skips the fusion wrapper so the result keeps a real similarity score instead of a
rank-derived one. `parseMemoryPayload()` guards both directions — an unknown category never
reaches the collection, and a point written by an older schema fails loudly on read.

`DENSE_VECTOR_SIZE` is 1536, chosen for Gemini embeddings truncated via MRL. It is the one
number here that Task 4 could not settle on its own: confirm it when `src/core/llm/` picks
the embedding model, before any real data is indexed.

Plan §1 grew during this task: `metadata.kind`, `summary`, `source_url` and `event_at`, and a
longer `category` list. The enrichment node therefore classifies on two axes, and the chunking
node must copy the parent's `summary` onto each child. `event_at` is what makes the deadline
side of `bureaucracy` queryable — a range filter on it also excludes undated records, which is
exactly the "what is coming up" question.

ADR 002 then replaced `telegram_message_id` with `source` + `source_ref`, because an MCP-ingested
snippet has no Telegram message. Ids come from `memoryId()`, not `randomUUID()`: the same inbound
item always lands on the same point, so a retried webhook overwrites rather than duplicating.
`list()` serves the `recall-by-filter` intent — a payload query with no embedding, ordered by
`event_at`, which is the one retrieval path that needs no model call at all.

## Task 5 — Done (2026-10-10)

| File                                | Purpose                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `src/core/retrieval/intent.ts`      | `Intent` union, `IntentClassifier` port, `stubIntentClassifier()`                       |
| `src/core/ingestion/file-source.ts` | `FileSource` port. grammY never enters `src/core/`                                      |
| `src/core/ingestion/inbound.ts`     | Transport-neutral `InboundMessage`, `turnBody()`                                        |
| `src/core/ingestion/save.ts`        | Download + `ObjectStorage.upload`, `storedReply()` / key parser (replaced in Task 7)    |
| `src/core/ingestion/route.ts`       | `respond()` / `dispatch()`. Save uploads; the other three intents reply `not built yet` |
| `src/core/conversation/store.ts`    | Drizzle `ConversationLog`: upsert user + chat, append both turns                        |
| `src/index.ts`                      | Composition root. One process, HTTP server up in both Telegram modes                    |
| `src/bot/listen.ts`                 | `deleteWebhook` then `bot.start`, or register the webhook on the shared server          |
| `src/bot/webhook.ts`                | Rejects a bad `X-Telegram-Bot-Api-Secret-Token` before grammY                           |
| `src/bot/middleware/admin.ts`       | Drops any `from.id` other than `TELEGRAM_ADMIN_ID`, with no reply                       |
| `src/bot/files.ts`                  | `FileSource` over `getFile` + `api.telegram.org`                                        |
| `src/bot/handlers/updates.ts`       | Message mapping, inline keyboard, undo / save callbacks                                 |

The stub classifier returns `save` for every message. A heuristic that guessed `ask` would drop notes, and
the save reply already carries an Undo button, so the recovery path runs from the first message. Undo
reads `callback_query.message.reply_to_message` — the save reply is a real Telegram reply, so nothing
is stored between the two updates. The button data is `undo` or `save`. Undo deletes the object whose
key is in the reply text and re-routes as `ask`, which answers `not built yet` and offers Save. `ask`,
`recall-by-filter`, and `forget` stay that reply until spec 002 Task 5.

A photo, document, and voice note download through `FileSource` and upload as that `ObjectKind`. A note
or a lone URL has no Telegram file, so the bytes go up as `document` (`note.txt` / `link.txt`). The
reply is `Stored <type> <key>`. Nothing is written to Qdrant: the pipeline TODO sits where summary,
category, kind, and the vector will attach.

`webhookCallback` calls `getMe` before it compares the secret, so the HTTP server rejects the header
first and only then hands the request to grammY. A missing `PUBLIC_URL` deletes any registered webhook
and long-polls. `npm run dev` is that path.

Every exchange is appended to `conversation_turns`. `dispatch` passes `contextWindow()` into the
classifier. `reply_to_message` is only the explicit jump back to an older turn.

## Task 6 — Done (2026-10-12)

| File                         | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `src/core/llm/embeddings.ts` | `gemini-embedding-2` at `DENSE_VECTOR_SIZE`, plus local term frequencies |
| `src/core/llm/router.ts`     | `gemini-3.8-flash` for ingest, `claude-sonnet-5-5` for answers           |
| `src/core/llm/*.test.ts`     | Vitest against AI SDK mocks, plus an opt-in live smoke test              |

`DENSE_VECTOR_SIZE` stays 1536. `gemini-embedding-2` recommends 768, 1536, and 3072, and the
collection was already declared at 1536. The API returns a unit vector at every width, so nothing
renormalizes it. `gemini-embedding-001` does not normalize a truncated vector, and cosine would
then rank garbage, which is why the model is embedding-2. The model rejects `taskType`. A query
is prefixed `task: search result | query: …` and a document `title: none | text: …`, and both
sides use that wording. A list of strings is one input and one vector, so each text is its own
embedding value. The prefix never reaches `embedSparse`, or those tokens would dominate BM25.

`embedSparse` hashes tokens to uint32 indices and stores raw term frequencies. The collection's
`bm25` vector has `modifier: 'idf'`, so Qdrant applies document frequency. The same function
serves a stored point and a query.

The fast model runs at reasoning `low`. `gemini-3.8-flash` rejects `minimal`. A completion has
to end on a user turn that contains text: a trailing model turn is a prefill, and an empty
final turn is rejected. The instruction is its own field, so inbound text stays data.

`claude-sonnet-5-5` answers. `LLM_STRONG_API_KEY` is optional at boot, because ingestion only
needs `LLM_FAST_API_KEY`, and `model('strong')` throws when the answer key is absent. Images are
limited to jpeg, png, gif, and webp, the set both models accept. Provider calls go through the
Vercel AI SDK and stop at `src/core/llm/`; the lint rule is what keeps a transport from growing
its own client. A gateway stays a registry swap. See ADR 003.

## Task 7 — Done (2026-10-12)

| File                             | Purpose                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| `src/core/pipeline/state.ts`     | `IngestionState` channels, `StoredFile`, `Enrichment`, state guards   |
| `src/core/pipeline/deps.ts`      | `PipelineDeps`: the six ports a node may reach for                    |
| `src/core/pipeline/graph.ts`     | Graph assembly, `PostgresSaver`, `ingest()` / `undo()` / `init()`     |
| `src/core/pipeline/nodes/*.ts`   | receive, storeFile, extract, enrich, chunk, index                     |
| `src/core/pipeline/url.ts`       | `UrlFetcher` over `fetch`: 10 s timeout, 5 MB cap, http/https only    |
| `src/core/pipeline/article.ts`   | `@mozilla/readability` over `linkedom`, with a tag-stripping fallback |
| `src/core/pipeline/chunk.ts`     | Character splitter, 800 chars with 100 of overlap                     |
| `src/core/pipeline/undo.ts`      | `undoIngest()`: parent, children, then the object                     |
| `src/core/pipeline/**/*.test.ts` | 41 vitest cases, the graph end to end against fakes                   |

**No bytes live in the graph state.** `storeFile` uploads and records only the key and content
type; `extract` reads the object back through `openStream`. A checkpoint resumed an hour later
therefore never needs the Telegram `getFile` URL that has since expired, and a checkpoint row
stays small. The thread id is `<source>:<source_ref>`, so a retried update resumes its own run,
and `memoryId()` makes the replayed write overwrite its own point.

**Chunking always emits a parent and at least one child**, even for a one-line note whose child
repeats it. Spec 002 searches children and fetches parents; a short memory stored only as a
parent would be invisible to that query. The storage node embeds the unique texts, so the
duplicated pair still costs one embedding. What gets embedded is the summary, location and tags
followed by the extracted text — never the extracted text alone, because `embedSparse` rejects
a blank and a spreadsheet or a photo of a wall yields nothing.

One multimodal path replaces three extractors: `ChatPart` widened from an image to a generic
file part, and photos, PDFs and ogg/opus voice notes all go to `gemini-3.8-flash` as bytes. The
media allowlist moved onto the model spec, so Claude still refuses audio. A document that is
neither PDF nor text is stored with no `original_text`, and enrichment classifies it from the
file name. A link is fetched and the HTML archived; an unreachable page falls back to storing
the address, because a link worth saving is still worth saving when the site is down.

`ChatModel.object()` was added here rather than in spec 002 — enrichment is the first caller of
structured output, and the intent classifier will be the second.

The save reply is now the kind, the category, the summary and the tags. **Undo therefore stopped
parsing the R2 key out of the reply text**: `keyFromStoredReply()` and `save.ts` are gone, and
`undoIngest()` derives the parent id from the original message instead. It deletes the children
too — a child is reachable only through its parent, so a parent-only delete would leave points
that still match a search and can never be removed.

Enrichment is deliberately more permissive than its prompt: tags are slugged, de-duplicated and
capped in code, and a blank summary falls back to the first line. A rejected response costs the
whole ingestion, which is worse than a tidy-up.
