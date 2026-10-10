# Implementation Plan: 001 Telegram Ingestion Pipeline

## 1. Data Schema (Qdrant Payload)
Every item saved to Qdrant must contain a rich payload to allow strict metadata filtering before dense search.

```typescript
interface MemoryPayload {
  id: string;                  // UUID
  telegram_message_id: number;
  type: 'text' | 'photo' | 'document' | 'url' | 'voice';
  original_text: string;       // Extracted text, OCR result, or transcript
  r2_file_path?: string;       // Relative path in R2 bucket (e.g., "photos/2026/img1.jpg")
  metadata: {
    category: 'food' | 'bureaucracy' | 'housing' | 'leisure' | 'finance' | 'other';
    location?: string;         // e.g., "Valencia", "Madrid"
    tags: string[];            // e.g., ["#paella", "#cita_previa"]
  };
  chunking: {
    is_child: boolean;
    parent_id?: string;        // Used for Parent-Child RAG retrieval
  };
  created_at: number;          // Unix timestamp
}
```

## 2. Ingestion Pipeline Workflow (LangGraph)
The processing logic in `src/core/pipeline/` should follow a directed graph:
1. **Receiver Node:** Accept payload from Telegram bot.
2. **File Handler Node:** 
   - *CRITICAL:* Telegram `getFile` URLs expire quickly. Do not store Telegram URLs.
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
- `LLM_API_KEY` (e.g., Gemini or Anthropic key for LangGraph)