# AGENTS.md — Digital Memory Project Rules

## Language & Communication
- All conversations, commit messages, code comments, and specifications MUST be in English.

## Project Overview
`digital-memory` is a personal second brain / life management hub. It ingests Telegram content (text, URLs, photos, documents, voice) and exposes it via a RAG pipeline to both Telegram (Phase 1) and an MCP Server (Phase 2).

## Tech Stack
- **Language & Runtime:** TypeScript, Node.js (ESM)
- **Telegram Framework:** `grammY`
- **Orchestration:** `@langchain/langgraph`
- **Vector Storage & Search:** Qdrant Cloud (Hybrid Search: Dense Vectors + Sparse BM25)
- **Object Storage:** Cloudflare R2 (S3 API via `@aws-sdk/client-s3`)
- **MCP Framework:** `@modelcontextprotocol/sdk`
- **Primary LLM Routing:** Gemini 3.8 Flash (Ingestion/Fast) & Claude Sonnet 5.5 / GPT-5.6 Sol (Reasoning/MCP)

## Non-Negotiable Rules & Security
1. **Security:** Cloudflare R2 bucket MUST be strictly private. NEVER generate public links. All file access must go via Pre-signed URLs with a TTL <= 15 minutes or proxied streams.
2. **Architecture:** Core logic MUST reside in `src/core/`. Neither `src/bot/` nor `src/mcp/` should implement RAG logic directly.
3. **Authentication:** MCP SSE transport MUST use Telegram OAuth2 Authorization Code Flow (`/oauth/authorize`).
4. **SDD Workflow:** Always check `specs/` before writing features. Update `MEMORY.md` whenever hitting edge cases or library quirks.