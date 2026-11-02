# ADR 007: Bulk Forget and the Confirmation Store

## Context

ADR 004 made `forget_memory` a proposal: the model names one memory shown in the turn, the bot
asks `Forget <summary>?` with one inline button, and the press deletes it. The button's
callback data carried the memory id itself (`forget:<uuid>`, 43 bytes).

Use on 2026-11-02 showed the limits. The archive held two copies of one PDF programme. The user
asked to delete both; the model could propose only one per turn, so the user had to ask twice.
The confirmation named only a summary, so the user could not see which memories were about to
go, and two copies with the same summary were indistinguishable.

Telegram caps inline-button callback data at 64 bytes. Two uuids do not fit, so a list of ids
cannot ride on the button.

## Decision

1. **`forget_memory` takes a list of ids.** Every id must be one that `search_memory` or
   `list_memories` returned in the same turn, as before. Calls within a turn accumulate into
   one candidate set. The model is told to pass every memory the user means, one or several,
   and to ask only when the user means one and several fit.
2. **Pending ids live in Postgres.** A `forget_requests` row holds the chat ref and the memory
   ids. The button carries `forget:<request id>`. A press consumes the row atomically
   (`UPDATE … WHERE consumed_at IS NULL RETURNING memory_ids`), so a second press on the same
   button finds nothing and says so. The row has no foreign key to `conversations`: the
   conversation exchange is appended only after the reply is sent.
3. **The request is created by `dispatch()`, not by the agent turn.** `runTurn()` returns the
   candidates; routing stores them and hands the bot a request id. The turn stays a pure
   proposal, and an MCP client, which has no buttons, never needs the table.
4. **The confirmation lists what will go.** One line per memory, `YYYY-MM-DD · summary`, with
   ` · <file name>` when the memory has a stored file. The header is `Forget this memory?` or
   `Forget these N memories?`. The strings stay fixed English (ADR 004 decision 3): the model's
   wording never becomes the confirmation.
5. **The result reports counts.** `Forgotten.` for one of one, `Forgotten N memories.` when all
   went, `Forgotten K of N memories. The others were already gone.` for a partial, and
   `nothing found` when none. After a successful press the bot removes the keyboard, best
   effort.

## Alternatives Rejected

- **An in-process map with a TTL.** No migration, but every deploy or restart kills the live
  buttons, a regression from a button that worked for as long as the memory existed.
- **Several ids in the callback data.** At most two uuids fit in 64 bytes, and base85 packing
  buys one more. Not enough for "delete both copies" to generalise.
- **Ids on the `conversation_turns` row of the confirmation.** The append is best effort and
  happens after the send, so a failed append would kill the button, and the log would carry
  state that is not conversation.

## Consequences

- One new table and migration. The bot gains a `ForgetRequests` dependency next to
  `ConversationLog`.
- `RouteReply`'s forget variant carries a request id; the turn's reply carries candidates.
  Tests that asserted `Forget Appointment card?` assert the listed format.
- Consumed rows are kept. There is one user and the rows are small.

## Open

- A TTL or a cleanup of consumed rows, when the table grows or a second user arrives.
- Per-user scoping of a request, which MCP or multi-user would need.
- Telegram refuses edits on messages older than 48 hours, so the keyboard removal can fail
  silently; the consumed row still makes the press harmless.
- The row is consumed before the delete runs. A Qdrant or R2 failure therefore burns the
  confirmation: the user reads "Could not forget that." and must ask again. Chosen over
  consume-after-delete, which would let two fast presses run the delete twice. Revisit if
  store failures turn out to be common.

Spec `009-bulk-forget` carries the implementation.
