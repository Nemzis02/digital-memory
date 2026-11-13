# Implementation Plan: 011 MCP Server

## 0. Files

```text
src/mcp/server.ts                  # createMcpHandler in stateless legacy mode, tool registry
src/mcp/tools/search.ts            # search_memory, list_memories, get_memory
src/mcp/tools/file-link.ts         # get_file_link
src/mcp/tools/save.ts              # save_memory, base64 file decode and size cap
src/mcp/tools/forget.ts            # forget_memory, two-step handle
src/mcp/files.ts                   # in-memory FileSource for one ingest
src/mcp/oauth/metadata.ts          # the two /.well-known documents
src/mcp/oauth/authorize.ts         # GET /oauth/authorize: request validation
src/mcp/oauth/telegram-oidc.ts     # redirect to oauth.telegram.org, code exchange, ID token check
src/mcp/oauth/callback.ts          # GET /oauth/callback: state, nonce, sub == admin
src/mcp/oauth/consent.ts           # GET|POST /oauth/consent: page and approval
src/mcp/oauth/token.ts             # POST /oauth/token: code grant, refresh rotation
src/mcp/oauth/cimd.ts              # Client ID Metadata Document fetch and validation
src/mcp/oauth/bearer.ts            # bearer check: hash, expiry, resource, scope
src/mcp/oauth/scopes.ts            # the three scopes, tool-to-scope map
src/mcp/oauth/rate-limit.ts        # fixed window per address
src/mcp/routes.ts                  # HttpRoute list, only when PUBLIC_URL is set
src/core/oauth/clients.ts          # oauth_clients on Drizzle
src/core/oauth/codes.ts            # oauth_authorization_codes
src/core/oauth/tokens.ts           # oauth_tokens, families, rotation
src/core/oauth/login-sessions.ts   # oauth_login_sessions
src/core/memory/read.ts            # listed(), found(), getMemory(), fileLink()
src/core/forget/requests.ts        # user and client scoping
src/core/db/schema.ts, drizzle/    # columns and the new table, migration
src/config/env.ts                  # new variables
src/core/logging/redact.ts         # TELEGRAM_OIDC_CLIENT_SECRET in SECRET_ENV_KEYS
src/app.ts, src/index.ts           # extra routes, wiring
src/core/oauth/clients-cli.ts      # npm run oauth:client -- add <name> <redirect-uri>...
eslint.config.js, .env.example     # keep the MCP packages out of src/core/, document the variables
```

No barrel files, as in spec 001. `src/mcp/` imports core ports and the MCP packages only.

## 1. Routes

All routes below exist only when `PUBLIC_URL` is set. `<origin>` is `PUBLIC_URL` without a
path.

| Method      | Path                                        | Auth    | Purpose                                        |
| ----------- | ------------------------------------------- | ------- | ---------------------------------------------- |
| GET         | `/.well-known/oauth-protected-resource`     | none    | RFC 9728 document for the resource `/mcp`      |
| GET         | `/.well-known/oauth-protected-resource/mcp` | none    | the same document at the path-suffix form      |
| GET         | `/.well-known/oauth-authorization-server`   | none    | RFC 8414 document, `issuer` = `<origin>`       |
| GET         | `/oauth/authorize`                          | none    | validate the request, start the Telegram login |
| GET         | `/oauth/callback`                           | none    | finish the Telegram login                      |
| GET, POST   | `/oauth/consent`                            | session | show and record the approval                   |
| POST        | `/oauth/token`                              | client  | code grant and refresh grant                   |
| POST        | `/mcp`                                      | bearer  | the MCP endpoint                               |
| GET, DELETE | `/mcp`                                      | none    | 405                                            |

The protected resource document: `resource` is `<origin>/mcp`, `authorization_servers` is
`[<origin>]`, `scopes_supported` the three scopes, `bearer_methods_supported` `["header"]`.

The authorization server document: `issuer`, `authorization_endpoint`, `token_endpoint`,
`response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code",
"refresh_token"]`, `code_challenge_methods_supported: ["S256"]`,
`token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported:
true`, `authorization_response_iss_parameter_supported: true`, `scopes_supported`. No
`registration_endpoint`.

A `POST /mcp` without a valid bearer gets 401 with `WWW-Authenticate: Bearer
resource_metadata="<origin>/.well-known/oauth-protected-resource"`; when a token was
presented and refused, the header also carries `error="invalid_token"` (RFC 6750 section
3.1). A valid bearer with a missing scope gets 403 with `error="insufficient_scope"`,
`scope="<every missing scope>"` and the same `resource_metadata`.

## 2. Authorization Flow

1. The client opens `/oauth/authorize` with `response_type=code`, `client_id`,
   `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `scope` and
   `resource`. The issuer resolves the client (section 3), requires `redirect_uri` to match
   one of the client's, requires `S256`, requires `resource` to equal `<origin>/mcp`, and
   requires `scope` to be a subset of the three; an empty scope means all three. A failure
   that happens before the redirect URI is trusted renders a plain error page; after it, the
   error goes back to the client as `error` and `state` on the redirect URI.
2. The issuer stores an `oauth_login_sessions` row: a random session id, the validated
   request, a `state` and a `nonce` for Telegram, a PKCE verifier for Telegram, and an
   expiry 10 minutes out. The session id travels in an `HttpOnly`, `Secure`, `SameSite=Lax`
   cookie, and the browser goes to `https://oauth.telegram.org/auth` with
   `client_id=<bot id>`, `redirect_uri=<origin>/oauth/callback`, `scope=openid`, `state`,
   `nonce`, `code_challenge` and `S256`.
3. `/oauth/callback` loads the session from the cookie, requires `state` to match, exchanges
   the code at `https://oauth.telegram.org/token` with the client secret and the verifier,
   verifies the ID token with `jose` against the provider's JWKS (`iss`, `aud`, `exp`,
   `nonce`), and requires `sub` to equal `TELEGRAM_ADMIN_ID` as a string of digits. Any other
   `sub` renders the fixed refusal page, deletes the session and stores nothing. On success
   the session records the user (upserted in `users` by Telegram id) and the browser goes to
   `/oauth/consent`.
4. `/oauth/consent` shows the client name, the redirect host, and the requested scopes as
   checked boxes. Deny sends `error=access_denied` to the redirect URI. Approve mints a code:
   32 random bytes, stored as SHA-256 with the client id, user id, redirect URI, code
   challenge, the approved scopes, `resource`, and an expiry 10 minutes out. The session is
   consumed. The browser goes to the redirect URI with `code`, `state` and `iss=<origin>`.
5. `POST /oauth/token` with `grant_type=authorization_code` takes `code`, `client_id`,
   `redirect_uri`, `code_verifier` and `resource`. It consumes the code atomically (`UPDATE …
WHERE consumed_at IS NULL RETURNING`), checks the client id, the redirect URI, `S256` of
   the verifier against the stored challenge, the expiry and the `resource`. It issues an
   access token (1 hour) and a refresh token (30 days) in one new family, both stored as
   hashes with the scopes and the `resource`. The response carries `token_type: "Bearer"`,
   `expires_in`, `refresh_token` and `scope`.
6. `grant_type=refresh_token` looks the hash up. An unknown, expired or revoked token gets
   `invalid_grant`. A valid one is revoked, and a new access and refresh pair is issued in the
   same family with the same scopes (or a subset, when `scope` narrows). A refresh token that
   is revoked but presented again revokes every token of its family and answers
   `invalid_grant`: a stolen token and its owner cannot both keep a valid token.
7. Every `POST /mcp` hashes the bearer, loads the token, requires type `access`, no
   `revoked_at`, an expiry in the future, and `resource` equal to `<origin>/mcp`. The route
   then reads the tool name from `Mcp-Name` (or from the body of a 2025-era `tools/call`)
   and answers the 403 challenge when the token lacks that tool's scope, so the client can
   authorize again. The scopes go into the request's auth info, and each tool checks its
   scope a second time before it runs.

## 3. Client Resolution

A `client_id` that is an `https` URL with a non-root path is a metadata-document client.
The issuer fetches it with a 5 second timeout and a 5 KB cap, follows no redirect, and refuses
a host that resolves to a loopback, link-local, private or other special-use address. The
document must be JSON with `client_id` equal to the URL, a `client_name`, and a non-empty
`redirect_uris` array of `https` URLs or loopback `http` URLs. A loopback redirect URI
matches the request's on scheme, host and path with the port ignored; every other redirect
URI matches exactly. `token_endpoint_auth_method` is `none` when absent, and any other value
is rejected. A document is cached in `oauth_clients` (`kind = 'cimd'`, `metadata_url`,
`fetched_at`, `cache_until`, `etag`): the deadline comes from `Cache-Control: max-age`, at
most 24 hours; `no-store`, `no-cache` or no `max-age` means the next request revalidates with
`If-None-Match`, and a 304 extends the deadline. A fetch error is never cached and fails the
request.

Any other `client_id` must be a registered row (`kind = 'registered'`). `npm run oauth:client
-- add <name> <redirect-uri>...` creates one with a random id and prints it; `list` and
`remove <id>` complete the CLI. Registered clients are public too: no secret is issued, and
PKCE is the proof.

## 4. Tools

| Tool            | Scope           | Input                                                                 | Output (`structuredContent`)                                                    |
| --------------- | --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `search_memory` | `memory:read`   | `searchMemoryInput`                                                   | `{ memories: FoundMemory[] }`                                                   |
| `list_memories` | `memory:read`   | `listMemoriesInput`                                                   | `{ memories: ListedMemory[] }`                                                  |
| `get_memory`    | `memory:read`   | `{ id: uuid }`                                                        | `{ memory: FoundMemory }` or `isError` with `not found`                         |
| `get_file_link` | `memory:read`   | `{ id: uuid }`                                                        | `{ url, file_name, expires_at }` plus a `resource_link`                         |
| `save_memory`   | `memory:write`  | one of `{ text }`, `{ url }`, `{ file }`; `note?`, `idempotency_key?` | `{ id, summary, category, kind, tags }`                                         |
| `forget_memory` | `memory:delete` | `{ ids: uuid[] }` or `{ confirmation_id: uuid }`                      | step 1 `{ confirmation_id, memories, expires_at }`; step 2 `{ removed, total }` |

Annotations: the four read tools `readOnlyHint: true`, `destructiveHint: false`;
`save_memory` `idempotentHint: true` when a key is given; `forget_memory`
`destructiveHint: true`. Every tool also returns the JSON as one `text` block. `FoundMemory`
and `ListedMemory` are the agent tool shapes, moved to `src/core/memory/read.ts` with
`listed()` and `found()`, so the bot and MCP render a memory the same way.

`search_memory` and `list_memories` call `search()` and `recall()` with
`readableSources('mcp')`, at most 10 parents. `get_memory` uses `VectorStore.fetch([id])` and
requires a parent with a readable source. `get_file_link` requires type `photo` or
`document` and an `r2_file_path`, and calls `presignDownload(key, R2_PRESIGN_TTL_SECONDS)`;
`expires_at` is the ISO time, and the `resource_link` carries the URL and the file name;
the payload stores no MIME type, so none is claimed. A text or url memory answers `isError`
with `This memory has no file.`

`save_memory` builds an `InboundMessage` with `sourceRef` = the key or a UUID, `chatRef` =
the client id, `userRef` = the user id, `type` `text`, `url`, or `photo`/`document` by the
MIME type, and runs `pipeline.ingest({ source: 'mcp', message })`. A file is decoded from
base64, rejected over `MCP_MAX_FILE_BYTES` before any decode of the full string (the length
bound is checked first), and placed in the MCP `FileSource` under a random file id that the
pipeline downloads once and that is dropped after the ingest, success or failure. An
`idempotency_key` is 1 to 128 characters.

`forget_memory` with `ids` (1 to 20) fetches the parents, drops unknown ids, and when none
is left answers `isError` with `nothing found`. Otherwise it creates a `forget_requests` row
with the user id, the client id and `expires_at` 5 minutes out, and returns the confirmation
id, the ADR 007 listing and `expires_at`. With `confirmation_id` it calls `take(id, {
userId, clientId })`, which also refuses a row past its expiry; `undefined` answers
`isError` with `This confirmation was already used or has expired.`;
otherwise `forgetMany(ids)` and the ADR 007 result string with `{ removed, total }`.

## 5. Transport

`POST /mcp` is the SDK v2 `createMcpHandler(factory, { legacy: 'stateless' })` wrapped by
`toNodeHandler()`, mounted as one `HttpRoute`. The factory builds a server per request with
the six tools and the request's auth info. Legacy mode answers a 2025-era `initialize`
without a session id and a 2026-07-28 request as is, so Claude, Cursor and Claude Code all
connect today. `GET` and `DELETE` return 405. The `Origin` header, when present, must equal
`<origin>`, and the `Host` header must equal its host, else 403. The handler sends an SSE
comment every 15 seconds while a response streams (ADR 010 decision 8). `search_memory`
clips each memory's text to 4,000 characters so a result stays under every client's cap.

## 6. Schema and Environment

| Table                       | Change                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `oauth_clients`             | `kind` enum `cimd`/`registered`, `metadata_url`, `fetched_at`, `cache_until`, `etag`                   |
| `oauth_authorization_codes` | `resource` text                                                                                        |
| `oauth_tokens`              | `resource` text, `family_id` uuid, index on `family_id`                                                |
| `oauth_login_sessions`      | new: `id`, `request` jsonb, `state`, `nonce`, `code_verifier`, `user_id?`, `expires_at`, `consumed_at` |
| `forget_requests`           | `user_id` uuid null, `client_id` text null, `expires_at` timestamp null                                |

| Variable                      | Default                    | Purpose                                  |
| ----------------------------- | -------------------------- | ---------------------------------------- |
| `TELEGRAM_OIDC_CLIENT_SECRET` | required with `PUBLIC_URL` | secret from BotFather; masked            |
| `OAUTH_ACCESS_TTL_SECONDS`    | `3600`                     | access token lifetime                    |
| `OAUTH_REFRESH_TTL_SECONDS`   | `2592000`                  | refresh token lifetime                   |
| `MCP_MAX_FILE_BYTES`          | `10485760`                 | decoded size cap for `save_memory` files |

The env refine: `TELEGRAM_OIDC_CLIENT_SECRET` is required once `PUBLIC_URL` is set, with an
error that says why (the issuer cannot finish a login without it).

## 7. Observability and Limits

Each tool call runs inside `traceTurn({ source: 'mcp', chatRef: clientId, userRef: userId })`,
so Langfuse shows one trace per call with the tool name, as for a bot turn (ADR 005). OAuth
events log at `info` with the client id and the hashed user ref: login started, login
refused, consent given, token issued, token refreshed, family revoked. A refused bearer token
logs at `warn` with the first 8 hex characters of the token hash; a request with no token is
the normal first contact of a client and logs at `debug`. No log line carries a code, a
token, the client secret or an ID token.

The rate limit is a fixed window of 60 seconds and 30 requests per client address on
`/oauth/authorize`, `/oauth/callback` and `/oauth/token`, answered with 429. The map lives in
memory and clears each window; one process, one user.

## Tests

Unit: PKCE challenge and verifier; token minting and hashing; refresh rotation and family
revocation on a fake store; code consume once; client resolution with an injected fetch
(happy path, redirect refused, over 5 KB, special-use address, `client_id` mismatch, missing
redirect URI, loopback port match, error not cached); scope check and the 403 challenge
string; the Telegram ID token check against a test JWKS (good, wrong `nonce`, wrong `aud`,
expired, wrong `sub`); consent page rendering; each tool on `memoryFakes()` (search, list,
get found and not found, file link on a document and on a text, save text, URL, file over
the cap, forget step 1, step 2, reused id); the env refine; the rate limit window.

Integration (`*.int.test.ts`, temp database): the migration creates the columns and the
table; a code is consumed once and a second consume returns nothing; a refresh rotates and a
reuse revokes the family; a login session is consumed once; `forget_requests.take` with the
user and client scope. `http`: the metadata routes answer, `POST /mcp` without a bearer
answers 401 with the challenge, `GET /mcp` answers 405, a foreign `Origin` answers 403.

Live (gated on env): `INGEST_LIVE=1` saves a file over MCP and finds it with the bot's
`search()`; a manual run with the MCP Inspector against a local `PUBLIC_URL` tunnel; `claude
mcp add --transport http` end to end; Cursor with a registered client.

## Dependencies

`@modelcontextprotocol/server` and `core` 2.4, `node` 2.1 (brings `hono`), `jose` 6. Zod 4.2
or later is already present. After install, `npm ls @opentelemetry/core` must show one 2.x
line (MEMORY.md 2026-10-23). BotFather: open the bot, Bot Settings, Login Widget, Switch to
OpenID Connect Login, add `<origin>` and `<origin>/oauth/callback` to the Allowed URLs, and
copy the client secret. `PUBLIC_URL` and TLS come from spec `012-k8s-deploy`; until then
live tests use a tunnel.

## Open

Mirrors ADR 009 Open: revocation endpoint, Dynamic Client Registration fallback, cleanup of
expired rows, the `sub` format check against the real provider, multi-user, and a
client-written summary on save.
