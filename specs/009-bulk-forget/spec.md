# Feature Spec: 009 Bulk Forget

## Goal

Let one forget turn cover several memories, and show the user what will be deleted before the
press (ADR 007). Today the model proposes one memory per turn, and the confirmation names a
summary only, so two copies of one document cannot be told apart or removed together.

## User Stories

- As a user, I write "delete both copies" and get one confirmation that lists both, with one
  Forget button that removes both.
- As a user, each listed memory shows its saved date, summary and, for a file, its file name,
  so I know what goes before I press.
- As a user, I press the same Forget button a second time and nothing is deleted; the bot says
  the confirmation was already used.
- As a user, I press a Forget button after the bot was redeployed and it still works.
- As a user, I ask to forget one thing and several fit; the bot still asks which one.

## Out of Scope

Localised fixed strings (the confirmation and result stay English). Editing a memory. Forget
over MCP. Cleanup of consumed requests.
