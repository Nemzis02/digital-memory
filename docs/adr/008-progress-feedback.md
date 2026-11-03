# ADR 008: Progress Feedback During a Turn

## Context

A turn can take up to 30 seconds (ADR 004): a tool loop with a search, a file download and
extraction, or a save that runs the ingestion graph. The bot sent nothing in that time. In
use on 2026-11-02 the user could not tell a slow answer from a dead bot.

Telegram offers two signals. `sendChatAction` shows "is typing…" for 5 seconds and carries no
text. `sendMessageDraft` (grammY 1.46, `@grammyjs/types` 5) shows an ephemeral bubble in a
private chat: a text shows as is, changes under the same draft id animate, and the bubble
vanishes when the bot sends a message or after about 30 seconds. An empty text is documented
as Telegram's own "Thinking…" placeholder, but the macOS client (2026-11-02) draws an empty
bubble for it. The bot serves one admin in a private chat.

## Decision

1. **Core reports stages through a `Progress` port.** `Stage` is `thinking`, `reading`,
   `searching` or `saving`. The agent turn, its tools and the ingestion pipeline report; they
   know nothing about Telegram. The bot renders. MCP clients can ignore the port.
2. **The bot shows the stage as a draft.** One draft id per user message, so stage changes
   animate in place. Fixed English texts, as for every other bot string (ADR 004), including
   `Thinking` itself rather than the empty-text placeholder.
3. **Typing status is the fallback.** Outside a private chat, or when the first draft call
   fails, the bot sends `typing` every 4 seconds. When that fails too, the turn goes on in
   silence. Progress never fails a turn.
4. **Sends are throttled and stopped before the reply.** At most one call per second per chat,
   a heartbeat every 10 seconds, and `stop()` aborts the call in flight before the final
   message goes out, so no draft can land after the answer.

## Alternatives Rejected

- **Typing status only.** No stage, and the 5 second expiry means a timer anyway. Kept as the
  fallback.
- **A placeholder message edited per stage.** Leaves a message in the chat that must be edited
  into the answer or deleted, cannot become a photo or a document, and edits are rate limited
  and refused after 48 hours (ADR 007).
- **`@grammyjs/stream`.** Built to stream prose into drafts. The reply here is composed from
  tool effects, and the model's prose is only the last step, so there is nothing to stream
  yet.

## Consequences

- `DispatchOptions`, `TurnOptions`, `AgentTurn` and `ingest()` each carry an optional
  progress. The ingestion graph runs through `stream` instead of `invoke` to see node
  boundaries.
- The bot test harness records `sendMessageDraft` calls like any other API call.

## Open

- Streaming the answer's words into the draft needs a `streamText` path in the router and a
  way to hold back the `Sources:` tail.
- The draft `can_stop` button would let the user cancel a turn.
- Telegram may change which chats accept drafts; the fallback covers a refusal.

Spec `010-progress-feedback` carries the implementation.
