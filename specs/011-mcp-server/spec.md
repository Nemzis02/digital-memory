# Feature Spec: 011 MCP Server

## Goal

Let an MCP client (Claude, Claude Code, Cursor) read and write the same memories as the
Telegram bot, over one public origin, after one Telegram login (ADR 009). Today the OAuth
tables exist and nothing uses them, `mcp` is a source nobody writes, and the process serves
the bot alone.

## User Stories

- As an MCP user, I add `<PUBLIC_URL>/mcp` in Claude Code or as a Claude connector, log in
  with my Telegram account once in the browser, approve the three scopes, and the tools
  appear. No client id or secret is typed.
- As an MCP user, I add the server in Cursor with the client id the maintainer registered,
  and the same login works.
- As a stranger, I follow the login and sign in with another Telegram account; I see a fixed
  refusal page, no code is issued, and nothing about me is stored.
- As an MCP user, `search_memory` and `list_memories` return the memories the bot would
  return, with id, summary, dates and the text inside a `<memory>` block, and `get_memory`
  returns one memory by id, so the client's model can quote and cite.
- As an MCP user, `get_file_link` on a photo or document returns a link that works for at
  most 15 minutes, and then returns 403; on a text memory it says there is no file.
- As an MCP user, I save a snippet, a URL or a file from the IDE and the bot finds it a minute
  later in Telegram; a retried save with the same idempotency key does not create a copy.
- As an MCP user, I ask to forget two memories; the first call lists them with dates and file
  names and returns a confirmation id; the second call deletes them; a third call with the
  same id deletes nothing and says the confirmation was already used.
- As an MCP user, my token lacks `memory:delete` and `forget_memory` answers with
  `insufficient_scope` naming that scope, so the client can ask for it.
- As an MCP user, I come back after a week and the client refreshes the token without a new
  login; after 30 days of silence I log in again.
- As a platform, an unauthenticated `POST /mcp` gets 401 with a `WWW-Authenticate` header
  that points at the resource metadata, and the metadata documents at `/.well-known/` tell
  the client where to authorize, that PKCE S256 is required, and that a metadata-document
  client id is accepted.
- As a platform, `GET /mcp` and `DELETE /mcp` get 405, and a `POST /mcp` with a foreign
  `Origin` gets 403.
- As the maintainer, I run one command to register a client for Cursor and get its id.
- As the maintainer, I see one trace per tool call with source `mcp`, and no token or
  secret in any log line.

## Out of Scope

Dynamic Client Registration. More than one user. A conversation log over MCP. Elicitation.
A revocation endpoint or a token list. MCP prompts and resources. Hosting and the public URL
(spec `012-k8s-deploy`). Moving Qdrant.
