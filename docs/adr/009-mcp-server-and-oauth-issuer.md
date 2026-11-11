# ADR 009: MCP Server and OAuth Issuer

## Context

ADR 001 decision 3 and ADR 002 decisions 1, 2, 5 and 7 commit Phase 2 to an MCP server in the
process that runs the bot: Streamable HTTP, OAuth 2.1 Authorization Code with PKCE (S256), this
service as the resource server, protected resource metadata (RFC 9728), tokens bound to this
server as audience (RFC 8707), Client ID Metadata Documents for registration, and Telegram as
the identity provider behind `/oauth/authorize`. The data model stays single-user: the admin
Telegram account is the only user, as it is for the bot.

Some of it exists. Postgres holds `oauth_clients`, `oauth_authorization_codes` with the PKCE
columns, and `oauth_tokens`, all unused; `users` is written by the conversation store. `mcp`
is a memory source and a conversation source, and `readableSources('mcp')` returns the
Telegram memories too. The tool input schemas carry no transforms so that MCP can validate
against them. The HTTP router matches an exact method and path and parses no body. ESLint
keeps `src/mcp/` away from the bot, the storage SDKs and the model SDKs.

Research on 2026-11-09 changed four things the earlier ADRs assumed.

- MCP revision 2026-07-28 is current and has no sessions, but every major client (Claude,
  Claude Code, Cursor, VS Code, ChatGPT) still opens with `initialize` and a session id. A
  server that speaks only the new revision serves nobody today.
- The TypeScript SDK is now the v2 packages `@modelcontextprotocol/server`, `core` and `node`.
  Their resource-server helpers are runtime-neutral, but the authorization-server helpers
  are frozen in `server-legacy`, need Express, and are deprecated. The issuer must be ours.
- Telegram shipped an OpenID Connect provider at `https://oauth.telegram.org` in 2026-04 and
  archived the Login Widget. The widget's hash signs no domain, audience or nonce, so a payload
  captured on one site replays on any other site that uses the same bot.
- Claude, Claude Code and ChatGPT register with a Client ID Metadata Document. Cursor does
  not; it needs Dynamic Client Registration or a pre-registered client id.

## Decision

1. **The identity step is Telegram's OpenID Connect provider.** `/oauth/authorize` sends the
   browser to `oauth.telegram.org` with PKCE, `state` and `nonce`, exchanges the code with the
   bot's client secret, verifies the ID token against the provider's JWKS, and accepts the
   login only when `sub` equals `TELEGRAM_ADMIN_ID`. Any other account sees a fixed refusal
   page and nothing is stored. The OIDC client id is the numeric prefix of the bot token.
   This is Telegram Login as BotFather now defines it, so AGENTS.md rule 3 holds.
2. **A client is known by its Client ID Metadata Document or by pre-registration.** There is
   no registration endpoint. When `client_id` is an `https` URL with a non-root path, the
   issuer fetches the document without following redirects, caps the body at 5 KB, refuses
   special-use addresses, requires the document's `client_id` to equal the URL, takes the
   `redirect_uri` only from the document (exact match; a loopback address matches on any
   port), caches by the HTTP cache headers and never caches an error. The auth method is
   `none`. For a client without a document, the maintainer runs a CLI that stores a row in
   `oauth_clients` and prints the client id to paste into the client's config.
3. **Tokens are opaque and stored as hashes.** A token is 32 random bytes, base64url, and
   only its SHA-256 is stored, as the schema already requires. An access token lives 1 hour
   and a refresh token 30 days. Every refresh rotates: the old refresh token is revoked and a
   reuse of a rotated token revokes the whole family of that client and user. An
   authorization code lives 10 minutes, is single-use through `consumed_at`, and is bound to
   its PKCE challenge; only `S256` is accepted. Every code and token carries the `resource` it
   was issued for, which must equal `<PUBLIC_URL>/mcp`, and every bearer check compares it.
4. **Three scopes and one consent page.** `memory:read` covers search, list, get and the file
   link; `memory:write` covers save; `memory:delete` covers forget. After the Telegram login
   the issuer shows a server-rendered consent page with the client name, the redirect host,
   and the three scopes as checkboxes, all on. A call outside the token's scopes gets 403 with
   `insufficient_scope` and the full list of missing scopes. The check runs on the HTTP
   layer before the MCP handler, from the `Mcp-Method` and `Mcp-Name` headers or, for a
   2025-era client, from the request body, so the client sees a real challenge and can
   authorize again; each tool checks its scope a second time as a guard.
5. **Six tools over the core primitives, with structured output.** `search_memory`,
   `list_memories`, `get_memory`, `get_file_link`, `save_memory` and `forget_memory`. The
   inputs reuse the agent schemas where one exists. Every tool declares an output schema and
   returns `structuredContent` next to the same JSON as text. Read tools are marked read-only.
   `get_file_link` exists only for a photo or a document with a stored object; it returns a
   resource link whose URI is a pre-signed URL with the TTL of `R2_PRESIGN_TTL_SECONDS`, never
   more than 15 minutes, and states when the link expires. `search_memory` clips each
   memory's text to 4,000 characters, because a client caps a tool result and ten full
   documents would exceed it; `get_memory` returns the whole text. No tool synthesises an
   answer: the client's model reasons over the chunks (ADR 002 decision 1).
6. **Forget is a two-step confirmation with a server handle.** The first call takes the ids,
   stores them in `forget_requests` under the user and the client, and returns the ADR 007
   listing, one `YYYY-MM-DD · summary · file name` line per memory, with a confirmation id.
   The second call takes the confirmation id, consumes the row atomically, and deletes. The
   row carries an expiry 5 minutes out and `take()` refuses a row past it; a Telegram row has
   no expiry, so a button still works after a redeploy (spec 009). A reused or expired id
   deletes nothing and says so. The tool is marked destructive. This works on every client,
   with or without elicitation.
7. **`save_memory` takes text, a URL or a base64 file.** Exactly one of the three, with an
   optional note. A file is at most 10 MiB decoded. The bytes go through the same ingestion
   graph as a Telegram file, behind an MCP file source that keeps them in memory for the one
   ingest. The source is `mcp` and the source ref is the client's `idempotency_key` when it
   sends one, else a server UUID, so a retried call with a key overwrites its own point.
8. **MCP calls are traced, not logged as conversations.** The transport has no thread, so an
   MCP call writes no `conversations` or `conversation_turns` row. Each tool call is one trace
   with source `mcp`, the user id as user ref and the client id as chat ref (ADR 005).
9. **One stateless endpoint that serves both protocol eras.** `POST /mcp` runs through the
   SDK v2 handler in stateless legacy mode, which answers an `initialize` from a 2025-era
   client and a 2026-07-28 request alike, per request, with no session state. `GET` and
   `DELETE` on `/mcp` return 405. A request with an `Origin` that is not the public origin,
   or a `Host` that is not the public host, gets 403. A streamed response sends a comment
   line every 15 to 20 seconds so that no proxy closes it as idle. The MCP and OAuth routes
   exist only when `PUBLIC_URL` is set, because it is the issuer and the resource; without it
   the process serves the bot alone, as today.
10. **The OAuth endpoints are rate limited and never log a credential.** A fixed window per
    client address on `/oauth/authorize`, `/oauth/callback` and `/oauth/token`. A failed
    bearer check logs a warning with the hash prefix of the token, never the token.
11. **New configuration and schema.** `TELEGRAM_OIDC_CLIENT_SECRET` (a secret, masked in
    logs), `OAUTH_ACCESS_TTL_SECONDS` (default 3600), `OAUTH_REFRESH_TTL_SECONDS` (default
    30 days in seconds) and `MCP_MAX_FILE_BYTES` (default 10 MiB). `oauth_clients` gains a kind
    (`cimd` or `registered`), the metadata URL, its fetch time and its entity tag; codes and
    tokens gain `resource`; tokens gain a family id; `forget_requests` gains an optional user
    id, client id and expiry, which stay empty for Telegram rows; a new `oauth_login_sessions`
    table holds
    the OIDC `state`, `nonce`, PKCE verifier and the pending authorize request for 10 minutes,
    consumed once.

## Alternatives Rejected

- **The legacy Login Widget.** Archived by Telegram, blocked by Safari's tracking protection,
  one domain per bot, and the hash signs no domain or nonce, so it replays.
- **A bot deep-link login (`t.me/<bot>?start=<nonce>`).** No BotFather domain and a good
  mobile path, but a protocol of our own: a polling page, a match code against login CSRF,
  and cookie binding. OIDC gives the same guarantees as a standard.
- **A Dynamic Client Registration endpoint.** An unauthenticated POST that anyone can call;
  the spec deprecates it. A pre-registered row covers Cursor, and the endpoint can be added
  later if a needed client lacks a metadata document.
- **JWT access tokens.** Stateless validation, but revocation needs a list anyway, and the
  schema already stores hashes. Opaque tokens keep one path.
- **Direct delete with the destructive hint.** Claude Code and Cursor ask the user before a
  destructive tool; the hosted Claude connector can auto-approve. A hallucinated id list
  would delete at once.
- **Elicitation as the only confirmation.** Native in Claude Code and Cursor, absent in the
  hosted Claude connector, and the request state would need its own integrity protection.
  A handle works everywhere; elicitation can be layered on later.
- **Soft delete with a restore window.** Reversible mistakes, but a new payload field, a
  filter in every query, a restore tool and a purge job. More than the gain for one user.
- **Express for the issuer.** The SDK's legacy issuer helpers need it. The app runs on
  `node:http` with four exact routes; a second framework for six endpoints is not worth it.

## Consequences

- New dependencies: `@modelcontextprotocol/server`, `core` and `node`, and `jose` for the
  ID token check. None carries OpenTelemetry, so the 2.x pin in MEMORY.md stands; verify
  with `npm ls @opentelemetry/core` after install. AGENTS.md names the v1
  `@modelcontextprotocol/sdk`; the v2 packages replace it.
- One migration, generated with `npm run db:generate`, and four new environment variables.
  The secret joins `SECRET_ENV_KEYS`.
- `serve()` takes extra routes. The `listed()` and `found()` mappers move out of the agent
  tools into a core module that also offers get-by-id and the file link, so the bot and MCP
  render a memory the same way. `app.ts` gains the MCP file source wiring.
- ESLint restricts nothing under `@modelcontextprotocol/*` for `src/mcp/`; the useful rule
  is the reverse, and keeps those packages out of `src/core/`.
- The `security-review` skill triggers on `src/mcp/`, the env schema and the DB schema.
- ADR 002 decision 5 is amended: an MCP thread is not a conversation. ADR 007's open item
  on per-user scoping is closed by the user and client columns.

## Open

- A `/oauth/revoke` endpoint and a way to list and revoke a client's tokens.
- A Dynamic Client Registration fallback, if a needed client ships without a metadata
  document. Cursor is the first candidate.
- Cleanup of expired codes, tokens and login sessions; the table is small for one user.
- The provider shipped in 2026-04. Confirm with the real bot that `sub` is the numeric
  Telegram user id before the first deploy, and keep the claim comparison in one place.
- Multi-user needs an owner field in the Qdrant payload and in every filter. Out of scope.
- Whether `save_memory` accepts a summary the client's model wrote (ADR 004 Open) matters
  more over MCP, where the caller is a strong model.

Spec `011-mcp-server` carries the implementation.
