# Feature Spec: 004 Stack Currency

## Goal

Bring the documents and the small runtime guards in line with production practice in October
2026, before new features are added. The documents describe MCP over a transport the SDK has
deprecated, and list a package that is not installed. The bot has no retry on Telegram flood
control and no time limit on a model turn.

## User Stories

- As a contributor, I read AGENTS.md, ADR 001 and the README, and they describe MCP over
  Streamable HTTP with OAuth 2.1, marked as Phase 2, not as built.
- As a user, I send an album of ten photos, and every confirmation arrives, even when Telegram
  answers 429 with `retry_after`.
- As a user, I ask a question and the model hangs. After 30 seconds I get a short reply that
  the answer took too long, not silence.
- As a user, a turn that saved a memory and then timed out still shows the saved confirmation
  with Undo, because the memory exists.

## Out of Scope

Implementing MCP (Phase 2). Tracing (spec 005). Node 26 and `@types/node` 26: Node 26 enters
Active LTS on 2026-10-28, and the bump is a separate one-line change after that date.
TypeScript 7: blocked by the `typescript-eslint` peer range, see MEMORY.md. A release process,
a license and a security policy: not needed while this is a personal project.
