# 🧠 digital-memory

> A cloud-native personal second brain for lifestyle, bureaucracy, and city knowledge. Built using modern AI engineering practices: **RAG**, **Model Context Protocol (MCP)**, and **Spec-Driven Development (SDD)**.

---

## ✨ Features & Architecture

- **Multi-modal Telegram Ingestion:** Ingests photos, PDF documents, URLs, notes, and voice messages in real time via `grammY`.
- **Hybrid RAG Pipeline:** Combines dense vector search and sparse (BM25) indexing in **Qdrant Cloud** with metadata auto-tagging (`category`, `city`, `tags`).
- **Private Cloud Storage:** Secure asset storage in **Cloudflare R2** with ephemeral Pre-signed URLs (no public links).
- **IDE Access via MCP:** Native connection to Cursor/Windsurf via Server-Sent Events (SSE), protected by **Telegram OAuth2 SSO**.
- **Agentic Workflow:** Powered by **LangGraph** for multi-step OCR, web scraping, and HyDE query processing.

---

## 🛠️ Tech Stack

- **Runtime & Language:** Node.js (ESM), TypeScript
- **Telegram Framework:** `grammY`
- **Orchestration & RAG:** `@langchain/langgraph`, Qdrant Cloud
- **Object Storage:** Cloudflare R2 (`@aws-sdk/client-s3`)
- **Protocol:** `@modelcontextprotocol/sdk` (MCP)

---

## 📁 Repository Structure

```text
digital-memory/
├── AGENTS.md                  # Universal Operational Rules for AI Agents
├── MEMORY.md                  # Dynamic log of pitfalls & edge-case learnings
├── docs/
│   └── adr/                   # Architecture Decision Records (ADRs)
├── specs/                     # Feature Specifications (SDD workflow)
│   └── 001-tg-ingestion/      # Phase 1: Ingestion Pipeline
└── src/                       # Core application source code