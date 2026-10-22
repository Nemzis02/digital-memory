# Implementation Plan: 004 Stack Currency

## 0. Files

```text
AGENTS.md                         # rule 3 and Tech Stack: Streamable HTTP, Phase 2
docs/adr/001-architecture-and-stack.md  # decision 3 amended
README.md                         # features and stack: MCP marked planned
package.json                      # engines, @grammyjs/auto-retry, minor updates
src/bot/bot.ts                    # auto-retry transformer on bot.api.config
src/config/env.ts                 # PORT comment: "MCP SSE endpoint" -> "MCP endpoint"
src/core/llm/router.ts            # run() accepts an AbortSignal
src/core/agent/turn.ts            # 30 s budget, timeout reply
.github/workflows/release.yml     # release-please
release-please-config.json, .release-please-manifest.json
LICENSE, SECURITY.md
```

## 1. MCP Wording

The current MCP spec revision, checked on 2026-10-22, is 2026-07-28. Streamable HTTP is the
transport, and HTTP+SSE is deprecated. That revision removes sessions, the `initialize`
handshake and SSE resumability. The authorization spec makes the server an OAuth 2.1 resource
server: PKCE with S256, protected resource metadata at `/.well-known/oauth-protected-resource`
(RFC 9728), and audience-bound tokens (RFC 8707). Clients such as Claude and Cursor register
with a Client ID Metadata Document; Dynamic Client Registration (RFC 7591) is deprecated and
only a fallback. The Drizzle schema already has the PKCE columns.

- AGENTS.md rule 3 becomes: the MCP endpoint uses Streamable HTTP and OAuth 2.1 Authorization
  Code with PKCE, where Telegram Login is the identity provider behind `/oauth/authorize`.
- ADR 001 decision 3 gets an `_Amended 2026-10-22:_` paragraph in the style ADR 002 uses, with
  the spec revision it was checked against. ADR 002 decision 7 ("MCP SSE endpoint", "SSE's
  long-lived connection") gets an amendment too: without sessions the transport no longer rules
  out serverless, and one process stays because the webhook handlers run the ingestion graph
  and the model turn in-process, on one origin with the OAuth routes.
- README: MCP feature bullet says Phase 2. Tech Stack lists `@modelcontextprotocol/sdk` under
  "Planned (Phase 2)".

## 2. Telegram Flood Control

`bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30,
rethrowHttpErrors: true }))` in `createBot()`. It retries 429 with the `retry_after` Telegram
sends, and 5xx. A wait longer than 30 seconds fails at once, so a handler never sleeps for
minutes. A network error fails at once too: without `rethrowHttpErrors`, the plugin retries
it with no attempt limit and a back-off of up to one hour.

## 3. Turn Budget

`ChatModel.run(request, tools, maxSteps, signal?)` passes `abortSignal` to `generateText`.
`runTurn()` aborts an `AbortController` after `TURN_TIMEOUT_MS`, with `TURN_TIMEOUT_MS = 30_000`
exported next to `MAX_STEPS`. It does not use `AbortSignal.timeout()`, because fake timers
cannot drive it. The signal also goes to tool `execute` through the AI SDK, so
the tools that call the network pass it on where the port allows; the ingestion pipeline is
not cancelled mid-node, because a half-written memory is worse than a late one.

On abort (the turn's own signal is aborted, whatever error the SDK raised):

- A save already landed: the saved confirmation with Undo, as the step-limit case does today.
- A save is still running: wait for it, then the saved confirmation with Undo. A save that
  fails gives the timeout reply.
- Otherwise: a fixed reply, `That took too long. Try again or ask a shorter question.`, with
  no keyboard.

The timeout reply is a constant, not model text. ADR 004 Open lists the 30 s value; move it
from Open to a decision line in ADR 004 when this ships.

## 4. Releases

release-please (`googleapis/release-please-action`, current major) with `release-type: node`
on push to `master`. It opens a release PR that bumps `package.json` and writes
`CHANGELOG.md`. Merging it tags `v0.x.y`. No npm publish: the package is private.
Permissions: `contents: write`, `pull-requests: write`, on this workflow only. The CI workflow
keeps `contents: read`.

## 5. License and Security Policy

`LICENSE`: MIT, holder "Kirill Yerin", year 2026. `SECURITY.md`: supported version is the
latest `master`; report through GitHub private vulnerability reporting; list what is in scope
(bot auth, R2 access, OAuth). Enable private vulnerability reporting in the repository
settings by hand; the agent states this in its summary, it cannot do it.

## 6. Tests

- `router.test.ts`: `run()` with an already-aborted signal rejects with the abort error and
  calls no tool.
- `turn.test.ts`: a scripted model that never resolves, with fake timers, gives the timeout
  reply; the same after a `save_memory` call gives the saved reply with Undo.
- `bot.test.ts`: the API transformer list contains auto-retry. A 429 then 200 from a stubbed
  transport sends once more and succeeds. A 429 that asks for more than 30 s, and a network
  error, each fail after one call.

## 7. Dependencies

`@grammyjs/auto-retry` (runtime). release-please is an Action, not a package.
`npm update` for the minor drift that `npm outdated` shows; no major bumps.
