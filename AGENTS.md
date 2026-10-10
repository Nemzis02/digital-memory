# AGENTS.md — Digital Memory Project Rules

## Language & Communication

- All conversations, commit messages, code comments, and specifications MUST be in English.

## Code Comments

- Default to no comment. Code shows _how_; a comment earns its place only by carrying _why_ — a non-obvious constraint, a deliberate deviation, a gotcha, a workaround, or the reason a tempting simpler version is wrong.
- Never narrate the code ("loop over users", "parse the body"), restate names, types or signatures, or mark block ends.
- Never narrate the change ("fixed X", "updated to Y", "as requested"). A comment must read correctly to someone opening the file fresh who never saw the diff; change context belongs in the commit message.
- Never point at a moving target: spec names, section numbers, design docs, or rule numbers from this file. Encode the substance instead. Ticket IDs, RFCs, standards and permalinks are fine as trailing breadcrumbs, but the comment must still stand on its own with the link removed.
- Razor every comment you keep, not just the ones you delete. "Carries a real _why_" and "is worded minimally" are independent judgments. Keep the single non-obvious fact a reader needs at that line, in the fewest words. A five-line block almost never survives intact; the razored answer is sometimes zero.
- A one-line summary on an exported function is fine. Inline restatement of a single clear line never is.
- TODOs are fine and need no issue ID, but a TODO is a marker, not a substitute for doing the work in scope.

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
