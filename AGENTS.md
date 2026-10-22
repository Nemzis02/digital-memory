# AGENTS.md — Digital Memory Project Rules

## Language & Communication

- All conversations, commit messages, code comments, and specifications MUST be in English.
- Write English that a non-native reader understands on the first read: plain common words, short sentences, active voice, no phrasal verbs or idioms. Apply the `asd-ste100` skill in STE-flavored mode to prose, and in Strict mode to error messages, tool descriptions, and prompts.

## MEMORY.md Discipline

`MEMORY.md` holds only what a competent engineer could not derive from the repo itself. A stale entry is worse than a missing one, because it is believed.

- **One entry, one constraint.** The heading states the constraint ("Relative imports must use `.ts`"), never the topic ("imports").
- **Non-derivable only.** If it is visible in `package.json`, a config file, or a single source file, it does not belong here. Never restate current code, or a decision the code already reflects.
- **No change narration.** Record the constraint, not the work that produced it. Never "verified", "fixed", "as requested".
- **Search before writing; update in place.** Two entries on one subject is a defect — merge them.
- **Delete on contradiction, in the session you notice it.** Deletion is most of the value.
- **Budget 80 lines, max 5 lines per entry.** Over budget, a new entry must be paid for by removing another. The cap exists to force the question "what is the least useful line here?".
- **Check the entry is in the right file.** A decision with alternatives and a revisit trigger belongs in `docs/adr/`; a repeatable procedure belongs in a skill. Leave at most a one-line pointer.
- **Absolute dates only.** `2026-10-10`, never "last week".

## Committing

**The agent never commits.** Finish the work, leave it unstaged in the working tree, and say
what changed. The same goes for `git add`, `stash`, and `reset` — nothing may move work out of
`git status`. Propose a commit message in chat if one is useful.

**Review before calling it done.** Once code or specs changed, run the `change-review` skill on
the working tree before saying the task is finished or proposing a commit message. Fix its
Critical and required findings in the same turn; leave the rest to the user.

## Commit Convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). This is enforced
locally by a `commit-msg` hook (husky + commitlint) and in CI by the `commits` job, so a
non-conforming message cannot land.

```
<type>(<scope>): <subject>
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes:** `config`, `core`, `logging`, `storage`, `vector`, `llm`, `pipeline`, `bot`, `mcp`, `ci`, `deps`, `docs`, `spec`, `tooling`. The scope is optional; when present it MUST be from this list. Extend the list in `.commitlintrc.json` rather than inventing one.
- **Subject:** imperative mood, lower case, no trailing period. Header capped at 72 characters, body lines at 72.
- A breaking change is marked with `!` after the scope (`feat(mcp)!: ...`) or a `BREAKING CHANGE:` footer.

## Code Comments

- Default to no comment. Code shows _how_; a comment earns its place only by carrying _why_ — a non-obvious constraint, a deliberate deviation, a gotcha, a workaround, or the reason a tempting simpler version is wrong.
- Never narrate the code ("loop over users", "parse the body"), restate names, types or signatures, or mark block ends.
- Never narrate the change ("fixed X", "updated to Y", "as requested"). A comment must read correctly to someone opening the file fresh who never saw the diff; change context belongs in the commit message.
- Never point at a moving target: spec names, section numbers, design docs, or rule numbers from this file. Encode the substance instead. Ticket IDs, RFCs, standards and permalinks are fine as trailing breadcrumbs, but the comment must still stand on its own with the link removed.
- Razor every comment you keep, not just the ones you delete. "Carries a real _why_" and "is worded minimally" are independent judgments. Keep the single non-obvious fact a reader needs at that line, in the fewest words. A five-line block almost never survives intact; the razored answer is sometimes zero.
- A one-line summary on an exported function is fine. Inline restatement of a single clear line never is.
- TODOs are fine and need no issue ID, but a TODO is a marker, not a substitute for doing the work in scope.

## Project Overview

`digital-memory` is a personal second brain / life management hub. It ingests Telegram content (text, URLs, photos, documents, voice) and exposes it via a RAG pipeline to both Telegram (Phase 1) and an MCP Server (Phase 2).

## Tech Stack

- **Language & Runtime:** TypeScript, Node.js (ESM)
- **Telegram Framework:** `grammY`
- **Orchestration:** `@langchain/langgraph`
- **Vector Storage & Search:** Qdrant Cloud (Hybrid Search: Dense Vectors + Sparse BM25)
- **Object Storage:** Cloudflare R2 (S3 API via `@aws-sdk/client-s3`)
- **MCP Framework:** `@modelcontextprotocol/sdk` (Phase 2, not yet installed)
- **Primary LLM Routing:** Gemini 3.8 Flash (Ingestion/Fast) & Claude Sonnet 5.5 / GPT-5.6 Sol (Reasoning/MCP)

## Non-Negotiable Rules & Security

1. **Security:** Cloudflare R2 bucket MUST be strictly private. NEVER generate public links. All file access must go via Pre-signed URLs with a TTL <= 15 minutes or proxied streams.
2. **Architecture:** Core logic MUST reside in `src/core/`. Neither `src/bot/` nor `src/mcp/` should implement RAG logic directly.
3. **Authentication:** The MCP endpoint (Phase 2) MUST use Streamable HTTP and OAuth 2.1 Authorization Code with PKCE (S256). Telegram Login is the identity provider behind `/oauth/authorize`.
4. **SDD Workflow:** Always check `specs/` before writing features. Update `MEMORY.md` whenever hitting edge cases or library quirks.
