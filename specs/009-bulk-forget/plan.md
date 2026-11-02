# Implementation Plan: 009 Bulk Forget

## 0. Files

```text
src/core/agent/schemas.ts        # forgetMemoryInput: ids[]
src/core/agent/tools.ts          # forgetCandidates map, every id must be shown
src/core/agent/prompt.ts         # forget_memory rule
src/core/agent/turn.ts           # compose() reads the map, forgetPrompt()
src/core/ingestion/reply.ts      # ForgetCandidate, TurnReply, RouteReply, forgetPrompt()
src/core/ingestion/route.ts      # creates the request, forgetResult(removed, total)
src/core/retrieval/query.ts      # forgetMany()
src/core/forget/requests.ts      # ForgetRequests on Drizzle
src/core/db/schema.ts, drizzle/  # forget_requests table and migration
src/bot/handlers/updates.ts      # forget:<request id>, take(), keyboard removal
src/bot/bot.ts, src/index.ts     # wiring
```

## 1. Tool and Turn

`forgetMemoryInput` is `{ ids: uuid[] }`, 1 to 20 ids. `forget_memory` checks every id against
the parents shown this turn; one missing id rejects the whole call and names the missing ids,
so the model can correct itself. Accepted ids go into `TurnEffects.forgetCandidates`, a map
keyed by id, so repeated calls accumulate without duplicates.

A candidate is `{ id, summary, createdAt: 'YYYY-MM-DD', fileName? }`, built from the shown
payload. `runTurn()` returns `{ text, keyboard: 'forget', candidates }`; the model's text is
dropped, as before. The forget keyboard still wins over Undo in the same turn.

## 2. Confirmation and Result

`forgetPrompt(candidates)`:

```text
Forget these 2 memories?
2026-10-23 · Programa oficial de actos de las Fallas de València 2023. · las fallas.pdf
2026-10-23 · Programa oficial de actos de las Fallas de València 2023. · las fallas.pdf
```

One candidate: `Forget this memory?` and its line. `present()` clips the plain text to the
Telegram limit as it does for every reply.

`forgetResult(removed, total)`: `Forgotten.` (1 of 1), `Forgotten N memories.` (all),
`Forgotten K of N memories. The others were already gone.` (partial), `nothing found` (none).

## 3. Request Store

Table `forget_requests`: `id` uuid pk default random, `chat_ref` text, `memory_ids` uuid[],
`created_at`, `consumed_at` nullable. No FK to `conversations`.

`ForgetRequests`:

- `create({ chatRef, memoryIds })` → request id.
- `take(id, chatRef)` → the ids, and marks the row consumed in the same statement; `undefined`
  when the row is unknown, belongs to another chat, or was consumed.

`dispatch()` calls `create()` when the turn reply is a forget proposal and sends the bot
`{ text, keyboard: 'forget', requestId }`.

## 4. Bot

The button is `forget:<request id>`. On a press: chat ref from `callback.message.chat.id`;
`take()`; `undefined` → answer the callback with `This confirmation was already used.` and
delete nothing. Otherwise `forget(ids)`, remove the keyboard with `editMessageReplyMarkup`
(errors logged, never fatal), reply with `forgetResult`, append the `forget` exchange.

## 5. Tests

Unit: schema bounds; tool accepts several shown ids, rejects on one unshown id, accumulates;
turn composes the listed text for two candidates and for one; route creates the request and
maps the reply, `forgetResult` four cases; `forgetMany` counts; bot presses with two ids, a
used request, a non-uuid, a partial result.

Integration: `requests.int.test.ts` on a temp database: create then take returns the ids; a
second take, and a wrong chat ref, return `undefined`.

Live: the agent proposes a locksmith note as one candidate.
