# MEMORY.md — Pitfalls & Edge-Case Log

Running log of library quirks, edge cases, and non-obvious decisions. Newest first.

---

## 2026-10-10 — Task 1/2: Toolchain bootstrap

### Pinned toolchain and why each version is what it is

| Package             | Pinned  | Latest  | Why not latest                                                  |
| ------------------- | ------- | ------- | --------------------------------------------------------------- |
| `typescript`        | 5.9.3   | 7.0.2   | TS 7 drops the JS compiler API; blocks typed ESLint (see below) |
| `eslint`            | 10.12.0 | 10.12.0 | —                                                               |
| `typescript-eslint` | 8.71.1  | 8.71.1  | —                                                               |
| `prettier`          | 3.9.10  | 3.9.10  | 4.0 is alpha                                                    |
| `vitest`            | 5.0.3   | 5.0.3   | —                                                               |
| `zod`               | 4.6.5   | 4.6.5   | —                                                               |
| `@types/node`       | 24.19.2 | 26.6.5  | Tracks the Node 24 runtime, not the newest Node                 |
| `dotenv`            | removed | 18.0.7  | Replaced by built-in `process.loadEnvFile()`                    |

### Node 24 runs TypeScript natively; no `tsx`/`ts-node` in the toolchain

Node >= 22.18 strips types by default, so `node --watch src/bot/index.ts` is the dev loop and
`tsc` is only used for emitting `dist/` and typechecking. The cost is the `erasableSyntaxOnly`
compiler flag: **no `enum`, no `namespace`, no constructor parameter properties**. Use
`const` objects with `as const` plus a derived union type instead of `enum`.

### Relative imports must use the real `.ts` extension, not `.js`

Node's type stripping does **not** remap `./env.js` to `./env.ts`. Writing the traditional
`.js` specifier makes `node src/bot/index.ts` die with `ERR_MODULE_NOT_FOUND` the moment a
second module is imported — while `tsc --noEmit` stays perfectly green, so CI will not catch it.
Fix: import `./env.ts` and set `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`
(TS >= 5.7), which makes `tsc` rewrite the specifier back to `./env.js` on emit. Verified both
directions: `node src/config/_smoke.ts` runs, and `dist/` contains `./env.js`.

### No `dotenv` dependency — `process.loadEnvFile()` is built in

`npm run dev` / `npm start` use Node's native `--env-file=.env`. For contexts without that flag,
`src/config/load-env.ts` calls `process.loadEnvFile()` (Node >= 20.12). It **throws `ENOENT`**
when the file is missing, which is the normal production case, so the call must be wrapped and
`ENOENT` swallowed. Real environment variables always beat the file, matching `--env-file`.

### Env validation is lazy, not import-time

`src/config/env.ts` exports `getEnv()` rather than a validated `env` constant. An import-time
`parseEnv()` would make `eslint`, `tsc`, and `vitest` fail on any machine without a populated
`.env`, and would break unit tests of modules that merely _reference_ config. Call `getEnv()`
inside factories/handlers.

### Zod v4 API drift

- `z.string().url()` is deprecated in favour of the top-level `z.url()`.
- Use `z.prettifyError(error)` instead of hand-rolling a loop over `error.issues`.
- `.min(1, msg)` does **not** fire for a missing key — only for a present-but-empty one. For a
  readable "X is required", pass `z.string({ error: (issue) => ... })` and branch on
  `issue.input === undefined`.
- `z.coerce.number()` is unchanged from v3.

### TypeScript 7 has no JavaScript compiler API

TS 7.0 is the native (Go) compiler; the npm `typescript` package is just a wrapper that execs a
binary, and `require('typescript').createProgram` is `undefined`. Every tool that consumes the
compiler API therefore cannot work with it yet — `typescript-eslint@8` declares
`typescript: >=4.8.4 <6.1.0` for exactly this reason. **Type-aware ESLint and TypeScript 7 are
mutually exclusive as of 2026-10.** TS 7 does compile this project cleanly with all strict flags
(`erasableSyntaxOnly`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`) — verified. The
type-aware escape hatch on TS 7 is `oxlint --type-aware` (via `oxlint-tsgolint`), also verified
to correctly flag `no-floating-promises`.

**Decision (2026-10-10):** stay on TS 5.9 + ESLint 10 + typescript-eslint. Typed lint rules are
worth more than compiler speed on a codebase this size. **Revisit when** `typescript-eslint`
raises its `typescript` peer above `<6.1.0`; at that point bump the compiler in one step rather
than adopting a second linter. Likewise stay on Node 24 / `@types/node@^24` for all of Phase 1
even though Node 26 is now LTS — no mid-feature runtime migration.

### `R2_PRESIGN_TTL_SECONDS` is capped in the schema

AGENTS.md rule 1 (pre-signed URL TTL <= 15 min) is enforced at config-parse time via
`.max(900)`, so a misconfigured deployment fails at boot instead of silently issuing long-lived
URLs. ESLint additionally bans `pub-*.r2.dev` literals via `no-restricted-syntax`.

### typescript-eslint needs root configs added to `allowDefaultProject`

`tsconfig.json` sets `rootDir: src`, so `vitest.config.ts` is outside the project and
type-checked linting fails with "was not found by the project service". Adding it to
`tsconfig.json#include` would break `rootDir`; the fix is
`parserOptions.projectService.allowDefaultProject: ['vitest.config.ts']`. Any future root-level
`*.config.ts` has to be listed there too.

### Formatting is CLI-only; `editor.formatOnSave` is deliberately `false`

The Prettier VS Code extension is disabled in this environment, so `.vscode/settings.json`
names no `editor.defaultFormatter`. Leaving `formatOnSave: true` would let a _different_
formatter (the built-in JSON/TS ones, or ESLint) rewrite files in a style Prettier disagrees
with, and CI `format:check` would then reject them. Run `npm run format` before committing.
`npm run format` and CI use the Prettier **npm package** and are unaffected by the extension.

### The default branch is `master`, not `main`

GitHub Actions `on.push.branches` must say `master`. Remote is
`git@github.com:Nemzis02/digital-memory.git`.

### npm dependency resolution notes

- `@qdrant/js-client-rest@1.19.0` pins `undici@7.29.0`, which carries several advisories
  (all fixed in `7.29.1`). Resolved with an `overrides.undici: ^7.29.1` entry in `package.json`.
  Re-check this override whenever the Qdrant client is upgraded.
- Changing a dependency major after an install leaves npm's tree stale and produces a bogus
  `ERESOLVE` peer conflict. `rm -rf node_modules package-lock.json && npm install` fixes it.
