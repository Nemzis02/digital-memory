# 🧠 digital-memory

> A cloud-native personal second brain for lifestyle, bureaucracy, and city knowledge. Built using modern AI engineering practices: **RAG**, **Model Context Protocol (MCP)**, and **Spec-Driven Development (SDD)**.

---

## ✨ Features & Architecture

- **Multi-modal Telegram Ingestion:** Ingests photos, PDF documents, URLs, notes, and voice messages in real time via `grammY`.
- **Hybrid RAG Pipeline:** Combines dense vector search and sparse (BM25) indexing in **Qdrant Cloud** with metadata auto-tagging (`category`, `kind`, `location`, `tags`) and parent-child chunking.
- **Private Cloud Storage:** Secure asset storage in **Cloudflare R2** with ephemeral Pre-signed URLs (no public links).
- **Durable State:** **PostgreSQL** via **Drizzle ORM** for user metadata, OAuth 2.1 clients and tokens (Phase 2), and as the LangGraph checkpoint store.
- **IDE Access via MCP (Phase 2, planned):** Cursor, Claude and other MCP clients over Streamable HTTP, protected by **OAuth 2.1** with Telegram Login.
- **Agentic Read Path:** Each text message is one tool-calling turn on `claude-sonnet-5-5` over `search_memory`, `list_memories`, `save_memory` and `forget_memory`, so one message can save and ask at once, within 4 steps and 30 seconds. Undo and Forget stay inline buttons ([ADR 004](docs/adr/004-agentic-read-path.md)).
- **Ingestion Graph:** Powered by **LangGraph** for multi-step OCR and web scraping.
- **Tracing:** One **Langfuse** trace per Telegram message, with each tool step, tokens, cost, the turn outcome and a hashed chat ref. Secrets are masked before export, and nothing is exported without keys ([ADR 005](docs/adr/005-observability.md)).

---

## 🛠️ Tech Stack

- **Runtime & Language:** Node.js 24 (ESM), TypeScript
- **Telegram Framework:** `grammY`, with `@grammyjs/auto-retry` retrying flood control (429) and `md-to-telegram` turning an answer's Markdown into Telegram HTML
- **Orchestration & RAG:** `@langchain/langgraph` with `@langchain/langgraph-checkpoint-postgres`, Qdrant Cloud
- **Models:** Vercel AI SDK (`ai`) over `@ai-sdk/google` (`gemini-3.8-flash`, `gemini-embedding-2`) and `@ai-sdk/anthropic` (`claude-sonnet-5-5`)
- **Object Storage:** Cloudflare R2 (`@aws-sdk/client-s3`)
- **Article Extraction:** `@mozilla/readability` over `linkedom` for saved links
- **Observability:** Langfuse over OpenTelemetry (`@langfuse/vercel-ai-sdk`, `@langfuse/otel`, `@langfuse/tracing`, `@opentelemetry/sdk-trace-node`)
- **Planned (Phase 2):** `@modelcontextprotocol/sdk` (MCP)

---

## 🚀 Local Development

Copy `.env.example` to `.env` and fill it in. `POSTGRES_PASSWORD` and `QDRANT_API_KEY` are values you
choose — `docker-compose.yml` configures the containers to demand them. The credentials that come
from elsewhere are `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_ID` (BotFather), `LLM_FAST_API_KEY`
(fast model and embeddings), and `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
`R2_BUCKET_NAME` (Cloudflare, on a bucket with public access left disabled). The strong model
answers every text message, so the process starts without `LLM_STRONG_API_KEY` but answers no
message until it is set.
`PUBLIC_URL` with `TELEGRAM_WEBHOOK_SECRET` are only needed when serving a webhook —
leaving both unset selects long polling, which needs no public address. `npm run dev` starts `src/index.ts`, and that process binds `PORT` either way: Telegram, and later MCP and OAuth, share one HTTP server.
Tracing is optional. Set both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` (Langfuse project
settings, API Keys) to export traces, or neither. `LANGFUSE_BASE_URL` defaults to the EU region.

```bash
npm run db:up        # PostgreSQL and Qdrant; COMPOSE="docker compose" to use Docker
npm run db:migrate   # must precede the first run: nothing else creates the Drizzle tables
npm run dev
```

`npm run dev` creates the Qdrant collection and the LangGraph checkpoint tables itself, both
idempotently. `npm test` needs no services and no keys.

`npm run test:live` is opt-in and spends real quota: it embeds, calls the models, and writes to R2
and Qdrant, cleaning up after itself. Set `INGEST_PHOTO`, `INGEST_VOICE` or `INGEST_DOCUMENT` to a
file path to include that medium; each case is skipped without one. Use files saved out of a real
Telegram chat, since Telegram re-encodes what it forwards.
The agent cases also need `LLM_STRONG_API_KEY`.

---

## 📏 Evals

`npm run eval` scores the read path against the synthetic golden set in `evals/`: recall@5 for
retrieval and tool-choice accuracy for the agent turn, per case and in total. Like
`npm run test:live`, it is opt-in and spends real quota. It needs `LLM_FAST_API_KEY`,
`LLM_STRONG_API_KEY` and `QDRANT_API_KEY`. It seeds the corpus into Qdrant with `source: 'eval'`
and deletes those points at the end. It writes `evals/last-run.json` (git-ignored) and prints
each case next to the baseline, with the delta. A drop does not fail the run.

When the new scores are the ones to keep, `npm run eval:accept` copies the run into
`evals/baseline.json`. Commit it with the change that caused it. With the Langfuse keys set, each
run also appears in Langfuse as a dataset run.

Accepted baseline, 2026-10-27, `claude-sonnet-5-5` and `gemini-embedding-2`:

| Suite              | Score | Cases |
| ------------------ | ----- | ----- |
| Retrieval recall@5 | 0.95  | 40    |
| Turn tool choice   | 0.89  | 27    |

`npm test` checks the golden set and the scorers without calling a model. `evals/README.md` has
the row formats and the steps to add a case.

---

## 📁 Repository Structure

```text
digital-memory/
├── AGENTS.md                  # Universal Operational Rules for AI Agents
├── MEMORY.md                  # Dynamic log of pitfalls & edge-case learnings
├── docker-compose.yml         # Local PostgreSQL and Qdrant
├── drizzle/                   # Generated SQL migrations (committed)
├── evals/                     # Synthetic golden set and the accepted baseline scores
├── docs/
│   └── adr/                   # Architecture Decision Records (ADRs)
├── specs/                     # Feature Specifications (SDD workflow)
│   ├── 001-tg-ingestion/      # Phase 1: Ingestion Pipeline
│   ├── 002-retrieval/         # Phase 1: Read path (search, recall, forget)
│   ├── 003-agentic-read-path/ # Phase 1: One tool-calling turn per message
│   ├── 004-stack-currency/    # MCP wording, turn timeout, Telegram retry
│   ├── 005-observability/     # Langfuse tracing of model calls
│   ├── 006-evals/             # Golden set, recall and tool-choice scores
│   ├── 007-sparse-bm25/       # Real BM25 sparse vectors
│   └── 008-deploy/            # Container image, health checks, integration CI
└── src/                       # Core application source code
```
