# Feature Spec: 002 Retrieval

## Goal

Turn a question into an answer over what spec 001 ingested. The same core serves two clients
with opposite needs: Telegram has no model on the far side and wants prose, Cursor is a model
and wants chunks (ADR 002).

## User Stories

- As a user, I ask the bot a question in plain language and get an answer with the memories it
  came from, each openable as a file when one exists.
- As a user, I ask "what is coming up" and get my dated items in chronological order, with no
  model involved.
- As a user, I notice a wrong memory and tell the bot to forget it, and its chunks go too.
- As a user in Cursor, I search my memory from the IDE and my own model reasons over the result.
- As a user, I send a follow-up as an ordinary message and the bot treats it as part of the
  same conversation. Replying to a specific older message pulls that message back in.

## Out of Scope

Re-ranking and HyDE (ADR 002, Open). Conversation text is context for the next turn, never a
memory: it is not embedded and not written to Qdrant.
