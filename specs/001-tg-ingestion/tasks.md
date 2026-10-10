# Implementation Tasks: 001 Telegram Ingestion

- [x] Task 1: Initialize TypeScript Node.js project (`package.json`, `tsconfig.json`, ESLint/Prettier).
- [x] Task 2: Setup environment config validation (`zod` + built-in `process.loadEnvFile()`).
- [x] Task 3: Implement Cloudflare R2 client (`src/core/storage/r2.ts`) with Pre-signed URL generation.
- [x] Task 4: Implement Qdrant client (`src/core/vector/qdrant.ts`) with Hybrid Search collection init.
- [ ] Task 5: Build basic `grammY` Telegram bot listener (`src/bot/index.ts`).
- [ ] Task 6: Implement the LLM router and embeddings (`src/core/llm/`); settles `DENSE_VECTOR_SIZE`.
- [ ] Task 7: Assemble the LangGraph ingestion pipeline (`src/core/pipeline/`) per plan §2.

The read path is spec `002-retrieval`, blocked on Task 6. The MCP server is Phase 2 and has no
spec yet. Anything not listed above is deferred on purpose, not forgotten.

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

## Task 5 — Ready

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_ID` are already validated, and the admin guard in
plan §0 is the only middleware Phase 1 needs. `src/bot/` may not import `@qdrant/*`,
`@aws-sdk/*`, or `@langchain/*` — the linter enforces it.

ADR 002 widened the task. The listener must route on a classified intent rather than on the
message type alone, reply with an inline keyboard so a misroute can be corrected in one tap,
and append every exchange to `conversation_turns`. A follow-up is just the next message in the
chat: `contextWindow()` supplies the recent turns, and `reply_to_message` only matters when the
user jumps back to an older one. Three consequences for how it is built:

- The intent classifier is a port with a stub, because `src/core/llm/` does not exist yet.
  Nothing else in Task 5 should wait on a model.
- Telegram cannot resolve a `file_id`, so core needs a `FileSource` port implemented in
  `src/bot/` over `ctx.api`. Letting `grammY` into `src/core/` would undo plan §0.
- A callback query carries the bot's own message, not the user's. Making the reply an actual
  Telegram reply puts the original message on `callback_query.message.reply_to_message`, which
  is how the undo button re-routes with no stored state.

Long polling and the webhook are the same `Bot` object in grammY, so the handlers stay
transport-agnostic and only the entrypoint differs between local runs and the hosted service.
`PUBLIC_URL`, `PORT` and `TELEGRAM_WEBHOOK_SECRET` are already validated; an unset `PUBLIC_URL`
means polling. When the webhook is used, reject any request whose
`X-Telegram-Bot-Api-Secret-Token` does not match before `grammY` sees it — the admin guard is
no defence here, because a forged update can claim any `from.id`.

### Where Task 5 stops

The ingestion pipeline is Task 7 and the classifier's model is Task 6, so Task 5 builds the
seams and not the intelligence behind them:

- `save` downloads the file, uploads it through `ObjectStorage`, replies with what was stored,
  and stops at a `TODO` where the pipeline will attach. Nothing is written to Qdrant yet —
  a `MemoryPayload` needs a `summary`, a `category`, a `kind` and a vector, and all four come
  from a model that does not exist.
- The `IntentClassifier` stub returns `save` for everything. A heuristic that guesses `ask`
  would silently drop notes, and the inline keyboard already covers the miss: the save reply
  carries an undo button, so the recovery path gets exercised from day one.
- `ask`, `recall-by-filter` and `forget` reply "not built yet" and are wired in spec 002
  Task 5. Their behaviour is specified there, not here.

### Done when

1. A photo, document, voice note, URL and plain text each reach R2 with the right `ObjectKind`,
   and the reply names the stored key.
2. A message from any id other than `TELEGRAM_ADMIN_ID` is ignored with no reply at all.
3. The undo button on a save reply resolves the original message through
   `callback_query.message.reply_to_message`, with nothing stored between the two updates.
4. `npm run dev` works on long polling with no `PUBLIC_URL` set.
5. `grammY` appears nowhere under `src/core/`; the bot reaches files through a `FileSource`
   port that `src/bot/` implements.
