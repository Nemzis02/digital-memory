# Implementation Plan: 008 Deploy Artifact and Integration CI

## 0. Files

```text
Dockerfile, .dockerignore
src/http/health.ts           # healthz and readyz routes over the existing HttpRoute shape
src/bot/listen.ts / src/app.ts  # routes added next to the webhook route
src/core/db/client.ts        # ping(): SELECT 1 with a 2 s timeout
src/core/vector/qdrant.ts    # VectorStore.ping(): collection info with a 2 s timeout
.github/workflows/ci.yml     # integration job, drizzle-kit check
.github/workflows/image.yml  # build and push to GHCR
vitest.integration.config.ts
src/**/*.int.test.ts
```

## 1. Image

Multi-stage build:

1. `node:24-alpine` (pinned by digest) as build: `npm ci`, `npm run build`.
2. Runtime on the same base: `npm ci --omit=dev`, copy `dist/` and `drizzle/`, run as the
   `node` user, `ENV NODE_ENV=production`, `CMD ["node", "dist/index.js"]`. No `--env-file`:
   the platform injects the environment.
3. `HEALTHCHECK` calls `/healthz` with Node's `fetch`, since alpine has no curl by default.

Check that `dist/index.js` resolves every import with `--omit=dev`, because Node type
stripping is a dev-time path and the build output must stand alone. `.dockerignore` excludes
`.env*`, `node_modules`, `coverage`, `.git`.

Migrations do not run on boot. A deploy runs `npx drizzle-kit migrate` as a separate step,
because `drizzle-kit` is a dev dependency; document this in the README. If that is too awkward,
switch to the runtime migrator from `drizzle-orm/node-postgres/migrator` behind an explicit
`npm run migrate`, and record the choice in MEMORY.md.

## 2. Health

- `GET /healthz`: 200, empty body. No dependency calls.
- `GET /readyz`: Postgres ping and Qdrant ping in parallel, 2 s each. 200 if both pass, 503
  with `{ "postgres": "ok" | "down", "qdrant": "ok" | "down" }` otherwise. R2 and the model
  APIs are not checked: an outage there must not take the process out of rotation.
- Neither route needs auth, and neither returns versions, hosts or error text.

## 3. Integration Tests

A second Vitest config, `vitest.integration.config.ts`, includes `src/**/*.int.test.ts` only.
The main config excludes them. `npm run test:integration` needs `DATABASE_URL` and
`QDRANT_URL` and fails fast without them.

Cases: migrations apply on an empty database; the conversation store appends and reads a
window; Qdrant `init()` is idempotent and creates every payload index; upsert, search and
delete round-trip one memory; `/readyz` returns 200 against both and 503 with Qdrant stopped
(stop it in the test by pointing at a closed port, not by stopping the container).

## 4. CI

- `verify` job: add `npx drizzle-kit check` and a step that runs `drizzle-kit generate` and
  fails if `git status --porcelain drizzle/` is not empty.
- New `integration` job with GitHub Actions `services:` for `postgres:16-alpine` and
  `qdrant/qdrant` at the version in `docker-compose.yml`, health-checked. Runs
  `npm run db:migrate`, then `npm run test:integration`.
- `image.yml`: on push to `master` and on release tags. `docker/setup-buildx-action`,
  `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN`, `docker/build-push-action` with
  `cache-from/cache-to: type=gha`, tags `sha-<short>` and the version. Permissions:
  `contents: read`, `packages: write`. Pin actions to current majors.
- Dependabot: add the `docker` ecosystem for the Dockerfile base image.

## 5. Open

Image signing with cosign and an SBOM attestation (`docker/build-push-action` supports
`sbom: true`). A Trivy scan of the image in CI.
