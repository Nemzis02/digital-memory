# ADR 001: Core Architecture & Cloud Native Stack

## Context

We are building a personal life-management knowledge hub (`digital-memory`). Content consists of unstructured personal items: city recommendations, bureaucracy guides, photos, menus, and notes.

## Decision

1. **Qdrant Cloud over PostgreSQL:** Selected for native hybrid search (Dense + BM25) and fast payload filtering (`city`, `category`, `tags`).
2. **Cloudflare R2 for Object Storage:** Private bucket with Pre-signed URLs for zero-egress cost and high security.
3. **Telegram OAuth2 for MCP:** Cursor authentication will use standard OAuth2 flow verified against the user's Telegram ID.
   _Amended 2026-10-22, checked against MCP spec 2026-07-28:_ MCP is Phase 2 and is not built yet. The transport is Streamable HTTP, which has no sessions in that revision; HTTP+SSE is deprecated. The MCP server is an OAuth 2.1 resource server: Authorization Code with PKCE (S256), protected resource metadata at `/.well-known/oauth-protected-resource` (RFC 9728), and tokens bound to this server as audience (RFC 8707). Clients register with a Client ID Metadata Document; Dynamic Client Registration (RFC 7591) is deprecated and is only a fallback. Telegram Login stays the identity provider behind `/oauth/authorize`. The clients are any MCP client (Claude, Cursor), not only Cursor.
4. **LangGraph Engine:** Manages ingestion pipelines (OCR -> Metadata Extraction -> Parent-Child Chunking) and query reformulation (HyDE).
