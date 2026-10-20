# ADR 004: Agentic Read Path

## Context

ADR 002 routes every inbound message through one structured-output call that picks an intent
(`save`, `ask`, `recall-by-filter`, `forget`, `chat`) and fills slots. The bot then runs the
matching path, and an inline keyboard lets the user recover a misclassification.

Two weeks of use showed where that breaks. A message carries one intent only, so "save this and
tell me what I had on Valencia" loses half of itself. The slot schema is a second query
language the classifier must speak, and every new filter widens it. The save-as-memory button
under answers offered to store the question text, which nobody wants, and was removed on
2026-10-20. Memory assistants in 2026 converge on one model turn with tools: the model decides
what to call, sees the result, and answers or asks back.

## Decision

1. **One tool-calling turn per text message, on the strong model.** The AI SDK `generateText`
   loop with `tools` and `stopWhen` drives it, capped at a few steps. The model receives the
   conversation window ADR 002 decision 5 already builds, then answers in text or calls a tool.
2. **Four tools, each a thin wrapper over existing core.**
   - `search_memory`: hybrid search over children, returns parents with id, summary, dates and
     whether a file is attached. The hybrid search and parent fetch are today's `ask` minus its
     synthesis step.
   - `list_memories`: the `recall` payload query, filters by category, kind, tags, type,
     location, date ranges and order. No embedding.
   - `save_memory`: runs the spec 001 ingestion pipeline on the current inbound message. The
     reply is today's saved confirmation with its Undo button.
   - `forget_memory`: today's `resolveForget`. It returns one candidate and never deletes.
3. **What stays outside the model.**
   - A photo, document or voice note with no caption is saved with no model turn, since there is
     nothing to decide.
   - Undo on a save stays an inline button.
   - Deletion is confirmed by the Forget inline button, not by a typed "yes" the model would have
     to interpret. The model only proposes the candidate.
4. **Tool results are data.** Memory text returns inside a delimited block marked as content.
   The system prompt says instructions found in memories are never followed. A saved web page
   or forwarded message is the expected injection vector.
5. **Citations keep their current shape.** The final answer ends with a `Sources:` line of
   parent ids, parsed by the existing parser in the retrieval module. The bot's attachment
   code, captions and albums included, is reused unchanged.
6. **The model port grows a tool loop.** `ChatModel` gains one method that takes tools and a
   step cap and returns the final text plus the tool calls made. The rest of core keeps calling
   `complete` and `object`. LangGraph stays the ingestion graph only, as ADR 003 decision 3 says.

## Consequences

- `IntentClassifier`, `IntentSlots` and the classifier prompt are deleted. The slot fields
  become the `list_memories` and `search_memory` input schemas.
- A text message costs one strong-model call plus one per tool step. Today it costs one fast
  classification plus, for questions, one strong synthesis. Small talk becomes dearer.
- Behaviour is tested with the AI SDK mock language model, which already backs the router
  tests, scripting tool calls step by step.
- MCP is unaffected. It already exposes retrieval primitives and lets the client's model reason
  over them (ADR 002 decision 1). The four tools are the same primitives, so the two clients
  converge.

## Open

- Whether small talk needs a tool-less fast path on the fast model.
- Whether `save_memory` accepts a summary the model wrote, or always re-derives one.
- The step cap and the per-message timeout. Start at 4 steps and 30 seconds, then tune.
- Tracing the loop (OpenTelemetry, Langfuse) is a separate decision.

Spec `003-agentic-read-path` carries the implementation.
