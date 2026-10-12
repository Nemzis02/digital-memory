# ADR 003: Model Provider Layer

## Context

The router and the embedding client each spoke a provider SDK directly. A third model meant
another message mapper, and two `gemini-embedding-2` behaviors are not the ones Embedding 001
taught: `taskType` is rejected, and a list of strings is a single input. A gateway would also
put the whole memory corpus, and every question, on a second hop.

## Decision

1. **Vercel AI SDK v7 is the provider layer, behind the existing ports.** `ChatModel` and
   `Embeddings` stay what the rest of core calls. `generateText` and `embedMany` are the calls.
   A new model is a registry entry.
2. **Calls go direct, with the provider key.** OpenRouter and the Vercel AI Gateway both add
   failover and one key for many models. OpenRouter's zero-retention list does not currently
   include Gemini Embedding 2. The corpus stays one hop from Google. **Revisit when** a second
   embedding provider is actually required, or a provider outage has cost a real ingestion.
3. **LangChain chat models stay out of this layer.** LangGraph owns the pipeline graph. The
   model call is not a graph.

## Consequences

`gemini-embedding-2` tasks are prompt prefixes, not `taskType`. Sparse embeddings stay on the
raw text, so the prefix tokens never enter BM25.
