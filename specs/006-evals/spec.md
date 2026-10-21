# Feature Spec: 006 Evals

## Goal

Measure the read path with numbers, so a change to the prompt, the model, the chunking or the
sparse vector (spec 007) is judged by a score, not by a few manual messages. Two scores:
retrieval recall and tool-choice accuracy, over a committed golden set.

## User Stories

- As the maintainer, I run `npm run eval` and get recall@5 for retrieval and tool-choice
  accuracy for the agent turn, per case and in total.
- As the maintainer, I compare a run with the last committed baseline and see which cases got
  better or worse.
- As the maintainer, every eval run appears in Langfuse as a dataset run, next to its traces.
- As a contributor, CI fails when a golden case is malformed or a scorer is wrong, without
  calling any model.

## Out of Scope

LLM-as-judge scoring of answer text. Evals of ingestion quality (summary, tags). Running the
live evals in CI: they spend quota and need keys.
