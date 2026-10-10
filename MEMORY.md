# MEMORY.md — Pitfalls & Edge-Case Log

Non-obvious constraints and library quirks. Newest first.

---

## 2026-10-10 — Toolchain bootstrap

### TypeScript 7 has no JavaScript compiler API

The npm `typescript` package is a wrapper that execs a Go binary, and
`require('typescript').createProgram` is `undefined`. Every tool consuming the compiler API is
therefore blocked — `typescript-eslint@8` declares `typescript: >=4.8.4 <6.1.0` for exactly
this reason. **Type-aware ESLint and TypeScript 7 are mutually exclusive.** The escape hatch
is `oxlint --type-aware` (via `oxlint-tsgolint`), verified working on TS 7.

**Decision:** stay on TS 5.9 with typed ESLint. **Revisit when** `typescript-eslint` raises
that peer above `<6.1.0`, and bump the compiler then rather than adopting a second linter.
Node and `@types/node` stay on 24 for all of Phase 1 even though 26 is now LTS.

### No `tsx` or `ts-node`: Node strips types natively

This requires `erasableSyntaxOnly`, which bans **`enum`, `namespace`, and constructor
parameter properties**. Use an `as const` object with a derived union instead of `enum`.

### `exactOptionalPropertyTypes` rejects `field: undefined` on generated API types

OpenAPI-derived request types (Qdrant's `Schemas`) spell optionals as `T | null`, so passing a
key whose value may be absent does not compile. Spread it in conditionally — `...(x === undefined
? {} : { x })` — rather than widening the call site or reaching for `null`.

### Relative imports must use `.ts`, not `.js`

Node's type stripping does not remap `./env.js` to `./env.ts`, so the traditional `.js`
specifier dies at runtime with `ERR_MODULE_NOT_FOUND` while `tsc --noEmit` stays green — CI
will not catch it. `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` let source
say `./env.ts` and still emit `./env.js`.

### Env validation is lazy, not import-time

`getEnv()` rather than a validated `env` constant: an import-time parse would make `eslint`,
`tsc`, and `vitest` fail on any machine without a populated `.env`. Call it inside factories
and handlers.

### Zod v4 drift

- `z.string().url()` is deprecated; use the top-level `z.url()`.
- Use `z.prettifyError(error)` instead of looping over `error.issues`.
- `.min(1, msg)` does not fire for a _missing_ key, only a present-but-empty one. For a
  readable "X is required", pass `z.string({ error: (issue) => ... })` and branch on
  `issue.input === undefined`.

### typescript-eslint: root configs need `allowDefaultProject`

`rootDir: src` puts `vitest.config.ts` outside the project, so typed linting fails with "was
not found by the project service". Adding it to `include` would break `rootDir`; list it in
`parserOptions.projectService.allowDefaultProject` instead. Every future root-level
`*.config.ts` needs the same treatment.

### gitleaks flags Telegram tokens with exactly 34 characters after `:A`

Placeholder values in `.env.example` and test fixtures tripped it. Prefer the inline
`// gitleaks:allow` directive over a path allowlist for `*.test.ts`, which would blind the
scanner to a real secret pasted into a test later. Note that `gitleaks-action` scans only the
commits in a push, not full history.

### Commit hooks activate on install, not on clone

`core.hooksPath` is local git config that no clone carries, so a contributor who skips
`npm install` gets no commitlint check — the CI `commits` job is the real gate. It validates
only the commits in a push or PR, so pre-convention history never retroactively fails.

### npm

- `@qdrant/js-client-rest@1.19.0` pins a vulnerable `undici@7.29.0`; held at `^7.29.1` through
  `overrides`. Re-check when the Qdrant client is upgraded.

### `file-type` returns MIME types carrying parameters

A Telegram voice note sniffs as `audio/ogg; codecs=opus`, so `=== 'audio/ogg'` silently misses
every one of them. Sender-declared types are stripped to a bare token before use and sniffed
types are not, so the two disagree by design. Branch on `ObjectKind`, never on the MIME string.
