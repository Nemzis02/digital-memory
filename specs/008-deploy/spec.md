# Feature Spec: 008 Deploy Artifact and Integration CI

## Goal

Make the service deployable and test it against real Postgres and Qdrant in CI. Today there
is no container image, no health endpoint, and no test touches a migration, the Qdrant
collection setup or the conversation store.

## User Stories

- As the maintainer, every push to `master` publishes a container image to GHCR, tagged with
  the commit SHA and, for a release, the version.
- As a platform, I call `GET /healthz` and get 200 while the process runs, and `GET /readyz`
  and get 200 only when Postgres and Qdrant answer.
- As a contributor, CI fails when I change `src/core/db/schema.ts` without generating a
  migration.
- As a contributor, CI runs the migrations, the Qdrant collection init and the conversation
  store against real services.

## Out of Scope

Choosing a hosting provider and deploying to it: a separate ADR when Phase 2 needs a public
URL. Kubernetes manifests. Image signing (cosign) is noted in Open in the plan, not done.
