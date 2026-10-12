# 🧠 digital-memory

> A cloud-native personal second brain for lifestyle, bureaucracy, and city knowledge. Built using modern AI engineering practices: **RAG**, **Model Context Protocol (MCP)**, and **Spec-Driven Development (SDD)**.

---

## ✨ Features & Architecture

- **Multi-modal Telegram Ingestion:** Ingests photos, PDF documents, URLs, notes, and voice messages in real time via `grammY`.
- **Hybrid RAG Pipeline:** Combines dense vector search and sparse (BM25) indexing in **Qdrant Cloud** with metadata auto-tagging (`category`, `kind`, `location`, `tags`) and parent-child chunking.
- **Private Cloud Storage:** Secure asset storage in **Cloudflare R2** with ephemeral Pre-signed URLs (no public links).
- **Durable State:** **PostgreSQL** via **Drizzle ORM** for OAuth2 sessions, tokens and user metadata, and as the LangGraph checkpoint store.
- **IDE Access via MCP:** Native connection to Cursor/Windsurf via Server-Sent Events (SSE), protected by **Telegram OAuth2 SSO**.
- **Agentic Workflow:** Powered by **LangGraph** for multi-step OCR and web scraping. Query reformulation (HyDE) is a hypothesis, not a commitment — see ADR 002.

---

## 🛠️ Tech Stack

- **Runtime & Language:** Node.js (ESM), TypeScript
- **Telegram Framework:** `grammY`
- **Orchestration & RAG:** `@langchain/langgraph` with `@langchain/langgraph-checkpoint-postgres`, Qdrant Cloud
- **Models:** Vercel AI SDK (`ai`) over `@ai-sdk/google` (`gemini-3.8-flash`, `gemini-embedding-2`) and `@ai-sdk/anthropic` (`claude-sonnet-5-5`)
- **Object Storage:** Cloudflare R2 (`@aws-sdk/client-s3`)
- **Article Extraction:** `@mozilla/readability` over `linkedom` for saved links
- **Protocol:** `@modelcontextprotocol/sdk` (MCP)

---

## 📁 Repository Structure

```text
digital-memory/
├── AGENTS.md                  # Universal Operational Rules for AI Agents
├── MEMORY.md                  # Dynamic log of pitfalls & edge-case learnings
├── docker-compose.yml         # Local PostgreSQL and Qdrant
├── drizzle/                   # Generated SQL migrations (committed)
├── docs/
│   └── adr/                   # Architecture Decision Records (ADRs)
├── specs/                     # Feature Specifications (SDD workflow)
│   ├── 001-tg-ingestion/      # Phase 1: Ingestion Pipeline
│   └── 002-retrieval/         # Phase 1: Read path (ask, recall, forget)
└── src/                       # Core application source code
```
