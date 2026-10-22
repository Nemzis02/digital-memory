# ADR 002: Read Path and the Two-Client Split

## Context

ADR 001 fixed the stack but described only the write path. Spec `001-tg-ingestion` likewise
covers ingestion alone, so how a question becomes an answer — and what changes when the client
is Cursor rather than Telegram — was never decided. The two clients differ in one way that
drives everything else: Telegram has no model on the far side, Cursor has a strong one.

Decision 6 originally refused a relational database, on the grounds that a single-user service
should not carry one for durable resume alone. That reasoning was incomplete: ADR 001 decision 3
commits to OAuth2 for MCP, and authorization codes, refresh tokens and client registrations are
durable state no matter what the pipeline does. Postgres was therefore already required by
Phase 2, and the only question was whether to pretend otherwise until then.

## Decision

1. **The core exposes `search()` and `ask()`; each client takes what suits it.** Telegram calls
   `ask()`, which retrieves and synthesises. MCP exposes retrieval primitives (`search_memory`,
   `get_memory`, `get_file_link`) and lets Claude reason over the chunks. Returning synthesised
   prose to a reasoning client would summarise a summary and blur the citations.
   _Amended 2026-10-21:_ `ask()` is deleted. Telegram runs the ADR 004 tool turn over `search()`
   and the same primitives, so the two clients converge.
2. **MCP is a two-way client, not a reader.** It also exposes ingestion tools, so a snippet or a
   file can be saved from the IDE. Core ingestion is therefore transport-neutral: a payload
   carries `source` and `source_ref`, never a Telegram message id.
3. **Intent is classified, not guessed from syntax.** One cheap structured-output call maps each
   inbound message to `save`, `ask`, `recall-by-filter`, or `forget`, which is what the graph
   branches on. `recall-by-filter` skips vector search entirely and runs a payload query.
   _Superseded 2026-10-21 by ADR 004:_ nothing is classified. One tool-calling turn on the strong
   model chooses among four tools, and one message can do more than one thing.
4. **Misclassification is recovered by the user, not by saving everything.** The reply carries an
   inline keyboard — save-as-memory on an answer, undo on a save. Saving every question instead
   would fill the collection with transient text and degrade retrieval.
   _Amended 2026-10-20:_ the save-as-memory button is removed. It offered to store the
   question text, which is rarely wanted; an explicit save is an explicit message. Undo on a
   save stays.
   _Superseded 2026-10-21 by ADR 004:_ no classification exists to recover from. Undo on a save
   and the Forget confirmation stay inline buttons (ADR 004 decision 3).
5. **A chat is a conversation, stored in Postgres.** Each Telegram chat (and each MCP thread)
   is one `conversations` row; every user message and bot reply is a `conversation_turns` row.
   A new message sees the recent turns of that chat with no reply gesture required. The window
   is the last 20 turns, cut at a 30-minute silence, so a message the next morning does not
   inherit yesterday's thread. `reply_to_message` stays as an explicit jump: replying to an
   older message pulls that one turn back in. Conversation turns are not memories and are never
   written to Qdrant.
6. **PostgreSQL is the state store, and LangGraph checkpoints into it.**
   `@langchain/langgraph-checkpoint-postgres` resumes a failed run from its last completed node
   instead of replaying OCR and extraction from the start. Drizzle owns the application schema
   — users, OAuth2 clients, authorization codes, tokens — and both share one `pg.Pool`.
   Deterministic ids do not go away: a checkpoint says where to resume, UUIDv5 over `source` and
   `source_ref` makes resuming safe, and a replayed write overwrites its own point.
7. **One long-running Node service.** The Telegram webhook, the MCP SSE endpoint and the OAuth
   routes share an origin and a process. Serverless is ruled out by SSE's long-lived connection.
   _Amended 2026-10-22:_ the MCP endpoint is Streamable HTTP (ADR 001 decision 3). MCP spec
   2026-07-28 removes sessions, so the transport no longer rules out serverless. One process
   stays: the webhook handlers run the ingestion graph and the model turn in this process, and
   the OAuth issuer, the MCP resource and the webhook share one origin.

## Open

**HyDE (ADR 001, decision 4) is unproven here.** It costs a model call per query and tends to
hurt short keyword-like queries, which is most of what a personal hub receives; the BM25 branch
already covers that case. Revisit once a few hundred real memories exist and some query actually
disappoints — delete the commitment if it does not pay for itself.

Spec `002-retrieval` carries the read path, and spec `003-agentic-read-path` replaces its intent
routing. Spec `001-tg-ingestion` stops at the write path.
