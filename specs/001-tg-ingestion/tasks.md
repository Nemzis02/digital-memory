# Implementation Tasks: 001 Telegram Ingestion

- [x] Task 1: Initialize TypeScript Node.js project (`package.json`, `tsconfig.json`, ESLint/Prettier).
- [x] Task 2: Setup environment config validation (`zod` + built-in `process.loadEnvFile()`).
- [ ] Task 3: Implement Cloudflare R2 client (`src/core/storage/r2.ts`) with Pre-signed URL generation.
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
| `.prettierrc.json`                      | 100 cols, single quotes, trailing commas                                 |
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

## Task 3 — Ready

`getEnv()` and `r2Endpoint()` are the intended inputs for the `S3Client` in
`src/core/storage/r2.ts`. Clamp `getSignedUrl` with `expiresIn: env.R2_PRESIGN_TTL_SECONDS`.
