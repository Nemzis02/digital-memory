---
name: readme-updater
description: >-
  Updates README.md in place when this repository's features, architecture,
  tech stack, dependencies, setup, environment, or top-level layout change.
  Use when those files change or the user mentions the README. Skip internal
  refactors that do not change what the README claims.
---

# README updater

Edit `README.md` in the same turn. Do not propose a patch and wait. If the README already matches the tree, leave it.

## Sections

Keep this order and voice. Emoji only on these headings.

1. `# 🧠 digital-memory` and the one-line blockquote
2. `## ✨ Features & Architecture` — bold label, one sentence, package names in backticks
3. `## 🛠️ Tech Stack` — same bullet shape
4. `## 📁 Repository Structure` — the fenced tree

Add another section only when the README would be false without it (a command someone must run, a required env name). No changelog, badges, screenshots, contributing, or license blocks.

## What maps where

| Change                                                                               | Section                                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `package.json` `dependencies` or `engines`                                           | Tech Stack. Name the library and the job it does. Skip devDependencies unless a documented command needs them. |
| `docker-compose.yml`, `drizzle/`, a new or removed top-level directory               | Repository Structure. One comment per entry. Do not list every file under `src/`.                              |
| New `src/bot/`, `src/mcp/`, or a core subsystem the features list omits or misstates | Features & Architecture                                                                                        |
| An ADR that reverses a README claim                                                  | Fix the claim. Link the ADR the way ADR 002 is linked.                                                         |
| A new `specs/<nnn-name>/` directory                                                  | One line in the tree                                                                                           |

`.env.example`: document the variable name only, and only inside a configuration section that already exists or that this change forces you to add. Never write secret values. R2 stays a private bucket; pre-signed URLs only, never a public link.

## Leave it

- Tests, lint, formatting, comments, and renames that do not change a claim above
- `MEMORY.md`, `AGENTS.md`, and spec task checkboxes
- A feature that exists only as a spec. A spec directory is a tree line. It is not a shipped feature.
- Anything you are unsure is actually in the tree

## Reply

If you edited the README, say which section changed. If you did not, do not mention this skill.
