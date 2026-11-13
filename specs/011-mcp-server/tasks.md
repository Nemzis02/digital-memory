# Implementation Tasks: 011 MCP Server

Blocked on spec `012-k8s-deploy` for a public URL in the live tests only; the unit and
integration tasks are not blocked. ADR 009 is the decision; this spec is the plan.

- [x] Task 1: Schema: the new columns, `oauth_login_sessions`, `npm run db:generate`,
      integration test that asserts the columns and the table. Env variables, the refine,
      `SECRET_ENV_KEYS`, `.env.example`. Tests.
- [x] Task 2: Core stores on Drizzle: clients, codes, tokens with families and rotation,
      login sessions; `forget_requests` user, client and expiry scoping. Integration tests.
- [x] Task 3: `src/core/memory/read.ts`: move `listed()` and `found()`, add `getMemory()` and
      `fileLink()`; the agent tools import them. Unit tests.
- [x] Task 4: Metadata routes and the bearer check with resource and scope; the 401 and 403
      challenges. Unit tests.
- [x] Task 5: Client resolution: metadata-document fetch and validation with an injected
      fetch, registered lookup. Unit tests for every refusal. Adds `oauth_clients.cache_until`
      for the `max-age` deadline (migration 0004).
- [x] Task 6: Authorize, Telegram OIDC redirect and callback, consent page, code minting.
      Unit tests with a fake provider and a test JWKS. The admin check reads the `id` claim
      of the `profile` scope, and `nonce` is checked only when the token carries it.
- [ ] Task 7: Token endpoint: code grant, refresh rotation, family revocation, error
      responses. Integration tests.
- [ ] Task 8: MCP handler, the six tools, the MCP file source, SSE heartbeat; `routes.ts`;
      `serve()` takes extra routes; wiring in `index.ts`; ESLint allows the MCP packages.
      Unit tests on `memoryFakes()`; `http` integration tests for 401, 403, 405.
- [ ] Task 9: `oauth:client` CLI with `add`, `list`, `remove`. Unit test.
- [ ] Task 10: Rate limit and the OAuth event log lines. Unit tests.
- [ ] Task 11: Live: MCP Inspector over a tunnel, `claude mcp add --transport http`, Cursor
      with a registered client; confirm the provider's `id` claim is the numeric user id and
      whether the ID token echoes `nonce`. The BotFather steps go into the README.
- [ ] Task 12: MEMORY.md entries for the quirks found; README through `readme-updater`;
      `change-review`, then `security-review`.
