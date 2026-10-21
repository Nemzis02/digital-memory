# Feature Spec: 005 Observability

## Goal

Trace every model call, tool step and ingestion run in Langfuse, as ADR 005 decides, so a
wrong answer can be explained from what the model saw and did.

## User Stories

- As the maintainer, I open Langfuse and find one trace per Telegram message, with each tool
  step, its input and output, the tokens and the cost.
- As the maintainer, I filter traces by outcome and find every turn that hit the step cap or
  the timeout.
- As the maintainer, a message that saved a memory shows the ingestion steps (extraction,
  enrichment, embedding) inside the same trace.
- As the maintainer, I run the service and the tests without Langfuse keys, and nothing is
  exported.
- As the maintainer, no API key, bot token or raw Telegram user id appears in any span.

## Out of Scope

Metrics and dashboards beyond what Langfuse shows. Sampling. Self-hosting Langfuse. Tracing
MCP requests (Phase 2 adds `source: 'mcp'` to the same attributes).
