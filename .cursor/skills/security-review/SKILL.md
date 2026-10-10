---
name: security-review
description: >-
  Reviews changes for exploitable security issues and fixes the high-confidence
  ones in the same turn. Use when docker-compose.yml, .env.example,
  src/config/env.ts, src/core/logging/redact.ts, src/core/storage/,
  src/core/db/schema.ts, src/bot/, src/mcp/, or .github/workflows/ change, or
  when the user asks for a security review.
---

# Security review

Review the change, then fix every high-confidence finding before you finish. Do not stop at a report. Research the repo before flagging anything: trace where the value comes from, and check the validation that already exists.

Report and fix only a vulnerable pattern fed by attacker-controlled input. A value from the environment, a config file, or a constant is server-controlled. Note a medium-confidence issue under "Needs verification" and leave it. Do not report low-confidence or defense-in-depth nits.

## Confidence

| Level  | Meaning                                                  | Action        |
| ------ | -------------------------------------------------------- | ------------- |
| High   | Vulnerable pattern, and the input is attacker-controlled | Fix it        |
| Medium | Vulnerable pattern, input source unclear                 | Note it only  |
| Low    | Theoretical, or a best practice with no exploit          | Do not report |

## Project invariants

A generic review misses these. Treat a violation as high confidence.

- R2 stays private. No `pub-*.r2.dev` literal, no URL built by hand, no pre-signed TTL above `R2_PRESIGN_TTL_SECONDS` (hard max 900), and uploads keep `Content-Disposition: attachment`.
- A reachable webhook checks `X-Telegram-Bot-Api-Secret-Token` before grammY parses the body. `TELEGRAM_ADMIN_ID` is not authentication: a forged update can claim any `from.id`.
- OAuth rows store `code_hash` and `token_hash`, never the credential. A code is single-use through `consumed_at`, and expiry is checked on read.
- A new secret env var goes into `SECRET_ENV_KEYS` in `src/core/logging/redact.ts`. Otherwise the first error that quotes it prints the secret.
- Compose publishes on `127.0.0.1` only and defines no credential default. `${VAR:-secret}` is the bug; `${VAR:?message}` is the fix. Rootless podman does not make an exposed port or a known password safe.
- Text from Telegram, a scraped URL, or a retrieved memory is untrusted. Once it reaches a model it is a prompt-injection input, so it never becomes instructions.

## Do not flag

- SHA-1 inside `uuidV5` in `src/core/memory/id.ts`. RFC 4122 requires it, and it hashes no secret.
- An `as UUID` cast on the same line as the `z.uuid()` that justified it.
- A `// gitleaks:allow` placeholder in a test or in `.env.example`.
- The moderate esbuild advisory pulled in by `drizzle-kit`. It is dev-only and recorded in `specs/001-tg-ingestion/tasks.md`.

## Scope

Node and TypeScript, plus the compose file. Podman and Docker share the compose rules. Skip framework guides for React, Vue, Django, Java, Terraform, and Kubernetes; none of them are in this repo.

## Verify

After a fix: `npm run lint`, `npm run typecheck`, and `npm test`. When `docker-compose.yml` changed, also run `docker compose config` with the required variables set and confirm the published ports are `127.0.0.1`. That command only parses the file, so it needs no running machine.

## Reply

If you fixed something, name the finding and the file. If you found nothing at high confidence, say so in one line.
