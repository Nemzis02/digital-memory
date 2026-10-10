# Implementation Tasks: 001 Telegram Ingestion

- [x] Task 1: Initialize TypeScript Node.js project (`package.json`, `tsconfig.json`, ESLint/Prettier).
- [x] Task 2: Setup environment config validation (`zod` + built-in `process.loadEnvFile()`).
- [x] Task 3: Implement Cloudflare R2 client (`src/core/storage/r2.ts`) with Pre-signed URL generation.
- [ ] Task 4: Implement Qdrant client (`src/core/vector/qdrant.ts`) with Hybrid Search collection init.
- [ ] Task 5: Build basic `grammY` Telegram bot listener (`src/bot/index.ts`).

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

## Task 4 — Ready

`QDRANT_URL`, `QDRANT_API_KEY`, and `QDRANT_COLLECTION` are already validated. Mirror the
port/adapter split of `src/core/storage/`: the vector contract the pipeline sees, then the
Qdrant client behind it. The payload to index is plan §1.
