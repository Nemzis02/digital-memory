# Feature Spec: 010 Progress Feedback

## Goal

Show the user that the bot is working while a turn runs (ADR 008). Today the chat is silent
from the moment a message arrives until the reply lands, which can be 30 seconds. The user
cannot tell a slow turn from a dead bot.

## User Stories

- As a user, I ask a question and within a second a "Thinking" bubble appears under my
  message. It changes to "Searching memory" while the bot searches, back to "Thinking" while
  the model writes, and it disappears when the answer arrives. No bubble is left behind.
- As a user, I send a photo without a caption and see "Reading the file", then "Saving", then
  the Saved reply with Undo.
- As a user, I ask the bot to keep a message and see "Saving" while it is filed.
- As a user, I press Undo and the bubble shows again during the re-run.
- As a user, when a draft cannot be shown, I still see "Digital memory is typing…" instead of
  silence.
- As a user, after the reply, or after the bot gives up on a turn, no status survives.

## Out of Scope

Streaming the words of the answer into the bubble. The "stop" button on a draft. Group chats
beyond the typing status. Progress for a Forget press, which takes one short call.
