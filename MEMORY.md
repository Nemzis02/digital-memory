# MEMORY.md — Pitfalls & Edge-Case Log

Non-obvious constraints and library quirks. Newest first.

---

## 2026-10-20 — grammY `InputFile` treats any object with a `url` key as a URL

An S3 `GetObject` body is an `IncomingMessage`, whose `url` is `''`, so grammY fetches it and
fails with "Only absolute URLs are supported" before any request is sent. Wrap the body with
`Readable.toWeb` first. Transformer-level bot tests never serialise `InputFile` and miss this.

## 2026-10-12 — R2 via the AWS SDK

Use `forcePathStyle`: virtual-hosted `<bucket>.<account>.r2…` is outside the account certificate.
Set both checksum modes to `WHEN_REQUIRED`; the SDK default sends headers R2 rejects. A new
account can also return TLS alert 40 with no certificate on the account host itself — the
endpoint cert is not provisioned yet, and no client option fixes that.

## 2026-10-12 — A LangGraph node may not share a name with a state channel

`addNode('enrichment', …)` against a state that has an `enrichment` channel throws at build
time, not at run time. Channels are nouns, so node names are verbs: `enrich`, `index`.

## 2026-10-12 — gemini-embedding-2

`taskType` is rejected. Query text is `task: search result | query: …` and document text is
`title: none | text: …`; both sides must match. A list of strings is one input and one vector.

## 2026-10-10 — Toolchain bootstrap

### TypeScript 7 has no JavaScript compiler API

`typescript` 7 is a Go binary; `createProgram` is gone, and `typescript-eslint@8` peers
`typescript <6.1.0`. Stay on 5.9 until that peer moves.

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

### Zod v4 drift

- `z.string().url()` is deprecated; use the top-level `z.url()`.
- Use `z.prettifyError(error)` instead of looping over `error.issues`.
- `.min(1, msg)` does not fire for a _missing_ key, only a present-but-empty one. For a
  readable "X is required", pass `z.string({ error: (issue) => ... })` and branch on
  `issue.input === undefined`.

### typescript-eslint: root configs need `allowDefaultProject`

`rootDir: src` leaves every root-level `*.config.ts` outside the project, so typed linting
fails with "was not found by the project service". Adding it to `include` would break
`rootDir`; list it in `parserOptions.projectService.allowDefaultProject` instead.

### gitleaks flags Telegram tokens with exactly 34 characters after `:A`

Placeholder values in `.env.example` and test fixtures tripped it. Prefer the inline
`// gitleaks:allow` directive over a path allowlist for `*.test.ts`, which would blind the
scanner to a real secret pasted into a test later.

### `file-type` returns MIME types carrying parameters

A Telegram voice note sniffs as `audio/ogg; codecs=opus`, so `=== 'audio/ogg'` silently misses
every one of them. Sender-declared types are stripped to a bare token before use and sniffed
types are not, so the two disagree by design. Branch on `ObjectKind`, never on the MIME string.
