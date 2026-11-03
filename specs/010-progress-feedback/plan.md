# Implementation Plan: 010 Progress Feedback

## 0. Files

```text
src/core/progress.ts                 # Stage, Progress
src/core/ingestion/route.ts          # DispatchOptions.progress, forwarded to the turn or the save
src/core/agent/turn.ts               # TurnOptions.progress, thinking before the model runs
src/core/agent/tools.ts              # AgentTurn.progress, staged() around search, list and save
src/core/pipeline/graph.ts           # ingest(input, { progress }), stage per graph node
src/bot/progress.ts                  # progressDisplay(): drafts, typing fallback, throttling
src/bot/handlers/updates.ts          # one display per message and per Undo re-run
```

## 1. Core Port

`Stage` is `thinking | reading | searching | saving`. `Progress` is `(stage) => void`: never
awaited, never throws. Core reports stages; it knows nothing about how they are shown.

- `runTurn()` reports `thinking` right before the model runs.
- `search_memory` and `list_memories` report `searching` before the store call and `thinking`
  after it, because the model reads the result next. `save_memory` hands the progress to the
  ingestion and reports `thinking` when the save resolves. `forget_memory` is pure and reports
  nothing.
- `ingest(input, { progress })` reports `reading` first when the message carries a file or a
  URL, else `saving`. The graph runs through `stream` with `updates` and `values`: after a
  `reading` start, `saving` is reported when the `extract` node finishes; the last `values`
  chunk is the final state. Nodes stay untouched.
- `dispatch(deps, message, send, { progress })` forwards the progress to the captionless save
  or to the turn.

## 2. Bot Renderer

`progressDisplay(api, chat, draftId)` returns `{ report, stop }`.

- Private chat: `sendMessageDraft(chat.id, draftId, text)`. The texts are `Thinking`,
  `Reading the file`, `Searching memory`, `Saving`, without an ellipsis, because the client
  animates its own dots after a draft text. Not an empty text for thinking: Telegram
  documents it as its own placeholder, but the macOS client draws an empty bubble.
  The draft id is the user's message id, so stage changes animate in place.
- At most one call in flight and at most one call per second; the latest stage wins. A stage
  already on screen is not resent, except by a heartbeat every 10 seconds, because a draft
  preview expires after about 30 seconds.
- Fallback: outside a private chat, or when the first draft call fails, `sendChatAction`
  `typing` every 4 seconds. When that fails too, the turn goes on without progress.
- `stop()` aborts the call in flight, clears timers and waits for the call to settle. It runs
  before the final reply is sent, so no draft can land after the answer, and again in
  `finally`. Timers are unref'd.

## 3. Bot Wiring

`handleMessage` and the Undo branch of `handleCallback` each create one display, pass
`display.report` to `dispatch`, and wrap `send` so `stop()` runs first. The error path stops
the display before the failure reply.

## 4. Tests

Unit: `progress.test.ts` covers the first draft, coalescing, the heartbeat, stop, abort, the
typing fallback and the group case. `bot.test.ts`: a turn that reports a stage puts a draft
before the reply and none after it; the Undo re-run shows one too. `turn.test.ts`: thinking,
searching, thinking for a search; the save hands the pipeline the progress. `graph.test.ts`:
reading then saving for a photo, saving only for a note. `route.test.ts`: the progress reaches
the turn and the captionless save.

Live: ask a question, send a captionless photo, press Undo, and watch the bubble appear,
change and vanish.
