# Implementation Tasks: 008 Deploy Artifact and Integration CI

Blocked on spec 004 Task 2 (`engines.node` at 24, which the base image matches). Independent of
specs 005-007. Answers the stack audit: no deploy artifact, no health endpoints, no integration
tests, no migration drift check.

- [ ] Task 1: `ping()` on the database client and the vector store. `/healthz` and `/readyz`
      routes, unit tests with fakes.
- [ ] Task 2: Dockerfile and `.dockerignore`. Build locally with `podman build`, run with the
      local `.env`, check `/readyz`.
- [ ] Task 3: Integration Vitest config, `test:integration` script, the cases in plan
      section 3.
- [ ] Task 4: CI: drizzle drift check, integration job with service containers.
- [ ] Task 5: `image.yml` to GHCR, Dependabot docker ecosystem.
- [ ] Task 6: README (run with the image, migrations on deploy) through `readme-updater`.
      `security-review`, since CI workflows changed.
