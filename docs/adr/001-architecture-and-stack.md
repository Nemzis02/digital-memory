# ADR 001: Core Architecture & Cloud Native Stack

## Context
We are building a personal life-management knowledge hub (`digital-memory`). Content consists of unstructured personal items: city recommendations, bureaucracy guides, photos, menus, and notes.

## Decision
1. **Qdrant Cloud over PostgreSQL:** Selected for native hybrid search (Dense + BM25) and fast payload filtering (`city`, `category`, `tags`).
2. **Cloudflare R2 for Object Storage:** Private bucket with Pre-signed URLs for zero-egress cost and high security.
3. **Telegram OAuth2 for MCP:** Cursor authentication will use standard OAuth2 flow verified against the user's Telegram ID.
4. **LangGraph Engine:** Manages ingestion pipelines (OCR -> Metadata Extraction -> Parent-Child Chunking) and query reformulation (HyDE).