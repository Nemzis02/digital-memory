# Implementation Plan: 001 Telegram Ingestion Pipeline

## 0. Directory Layout

Every concern inside `src/core/` gets its own folder. Tests are co-located as `*.test.ts`
next to the source they cover, which is what `vitest.config.ts` globs.

```text
src/
├── config/                   # consumed by every layer, so not domain logic
│   ├── env.ts                # Zod schema, parseEnv(), getEnv(), r2Endpoint()
│   └── load-env.ts           # process.loadEnvFile() shim, entrypoints only
│
├── core/                     # AGENTS.md rule 2: all domain + RAG logic
│   ├── logging/
│   │   ├── logger.ts         # structured JSON records
│   │   └── redact.ts         # credential scrubbing (AGENTS.md rule 1)
│   ├── memory/
│   │   └── payload.ts        # MemoryPayload, see §1
│   ├── storage/
│   │   ├── object-storage.ts # ObjectStorage port, consumed by the pipeline
│   │   ├── content.ts        # file-type sniffing, key layout
│   │   └── r2.ts             # Task 3 — the only file that imports the S3 SDK
│   ├── vector/
│   │   └── qdrant.ts         # Task 4
│   ├── llm/
│   │   └── router.ts         # Gemini Flash for ingest, Claude/GPT for reasoning
│   └── pipeline/             # see §2, one file per graph node
│       ├── graph.ts          # LangGraph assembly
│       ├── state.ts          # graph state type
│       └── nodes/            # receiver, file-handler, extraction,
│                             # enrichment, chunking, storage
│
├── bot/                      # Task 5 — transport only
│   ├── index.ts
│   ├── middleware/           # TELEGRAM_ADMIN_ID guard
│   └── handlers/
│
└── mcp/                      # Phase 2 — transport only
    ├── server.ts
    ├── oauth/
    └── tools/
```

Two constraints this layout exists to protect:

1. **No barrel `index.ts` files.** Beyond the usual import-cycle and tree-shaking cost, a
   barrel defeats the architecture guard: `no-restricted-imports` stops `src/bot/` importing
   `@qdrant/*` directly, but a `core/index.ts` re-exporting Qdrant types would reopen that
   path. Deep, explicit import paths keep the rule enforceable.
2. **`redact.ts` is separate from `logger.ts`.** The same scrubbing is needed anywhere text
   leaves the process — prompts sent to an LLM, error reports — not only on the logging path.

Relative imports use the real `.ts` extension; `tsc` rewrites them to `.js` on emit. See
`MEMORY.md` for why.

## 1. Data Schema (Qdrant Payload)

Every item saved to Qdrant must contain a rich payload to allow strict metadata filtering before dense search.

```typescript
interface MemoryPayload {
  id: UUID; // UUIDv5 over source + source_ref, so a retry overwrites its own point
  source: 'telegram' | 'mcp';
  source_ref: string; // Telegram message id, or the MCP caller's idempotency key
  type: 'text' | 'photo' | 'document' | 'url' | 'voice';
  original_text: string; // Extracted text, OCR result, or transcript
  summary: string; // Shown in the save confirmation; a child inherits its parent's
  source_url?: string; // Required when type is 'url'
  r2_file_path?: string; // Relative path in R2 bucket (e.g., "photos/2026/img1.jpg")
  metadata: {
    // The life domain
    category:
      | 'food'
      | 'bureaucracy'
      | 'housing'
      | 'finance'
      | 'health'
      | 'work'
      | 'travel'
      | 'transport'
      | 'shopping'
      | 'leisure'
      | 'learning'
      | 'people'
      | 'other';
    // What the item is for, independent of its domain
    kind:
      | 'reference'
      | 'event'
      | 'task'
      | 'receipt'
      | 'credential'
      | 'recommendation'
      | 'idea'
      | 'note';
    location?: string; // e.g., "Valencia", "Madrid"
    tags: string[]; // e.g., ["#paella", "#cita_previa"]
  };
  chunking: {
    is_child: boolean;
    parent_id?: UUID; // Used for Parent-Child RAG retrieval
  };
  created_at: number; // Unix timestamp
  event_at?: number; // When the thing happens, as opposed to when it was saved
}
```

`category` and `kind` are two axes rather than one longer list: a query usually remembers a
domain, a shape, or a date, and 13 × 8 values cover far more of that than 21 values on a
single axis would, while each axis stays small enough for the enrichment model to classify
reliably. `tags` remains the open axis. Both enums are append-only in practice — adding a
value leaves stored points readable, renaming one does not.

## 2. Ingestion Pipeline Workflow (LangGraph)

The processing logic in `src/core/pipeline/` should follow a directed graph:

1. **Receiver Node:** Accept payload from Telegram bot.
2. **File Handler Node:**
   - _CRITICAL:_ Telegram `getFile` URLs expire quickly. Do not store Telegram URLs.
   - Download the file into a memory buffer and immediately upload it to Cloudflare R2.
   - Return the internal `r2_file_path`.
3. **Extraction Node:**
   - If image: Run fast Vision LLM for OCR and description.
   - If URL: Scrape clean text.
   - If voice: Route to Whisper API.
4. **Enrichment Node:** Use a cheap/fast LLM (e.g., Gemini Flash or Haiku) to automatically extract `category`, `location`, and `tags` based on the content.
5. **Chunking & Vectorization Node:** Split large texts using Parent-Child strategy. Generate embeddings.
6. **Storage Node:** Save vectors and sparse index (BM25) to Qdrant Cloud.

## 3. Libraries & Dependencies

- `grammY` (Telegram Bot API)
- `@aws-sdk/client-s3` (For Cloudflare R2 integration via S3 compat)
- `file-type` (Magic-byte detection; Telegram's declared MIME types are sender-controlled)
- `@qdrant/js-client-rest` (Qdrant DB)
- `@langchain/langgraph` + `@langchain/core` (Orchestration)
- `zod` + `dotenv` (Validation)

## 4. Environment Variables

The application requires the following environment variables (to be validated by Zod in Task 2):

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_ID` (Personal Telegram ID for security/OAuth)
- `QDRANT_URL`
- `QDRANT_API_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `LLM_FAST_API_KEY`
- `LLM_STRONG_API_KEY` (optional; read when a question is asked)
