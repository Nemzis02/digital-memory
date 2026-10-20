# Feature Spec: 003 Agentic Read Path

## Goal

Replace the intent classifier with one tool-calling model turn per text message (ADR 004). The
bot keeps what works: hybrid search, parent-child citations, attached files, Undo on a save,
and the Forget confirmation button. What goes is the single-intent routing and its slot
schema.

## User Stories

- As a user, I ask a question in plain language and get an answer that cites the memories it
  came from, with their files attached.
- As a user, I ask "what is coming up next week" and get my dated items in order, found by a
  filter, not a similarity search.
- As a user, I write "save: the tapas bar on Calle Ruzafa is great" and it is stored, with an
  Undo button under the confirmation.
- As a user, I write one message that both saves and asks, and both happen.
- As a user, I ask the bot to forget something, it shows me the one memory it found, and
  nothing is deleted until I press Forget.
- As a user, I send a photo, document or voice note without a caption, and it is saved at once
  with no model deciding anything.
- As a user, I send a follow-up and the bot reads it in the context of the conversation, as
  ADR 002 decision 5 describes.
- As a user, a saved web page that contains instructions cannot make the bot do anything.

## Out of Scope

Tracing of model calls. HyDE and re-ranking (ADR 002, Open). Any MCP change. Editing a memory
after it is saved.
