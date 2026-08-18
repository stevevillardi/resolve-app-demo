---
name: commit
description: Create git commits in this repo using Conventional Commits / Commitizen format (type(scope): subject). Use whenever asked to commit changes, write a commit message, or run /commit.
---

# Commit — Conventional Commits (Commitizen format)

This repo commits using the [Conventional Commits](https://www.conventionalcommits.org/) format that
Commitizen (`cz`) prompts for. Follow this format exactly rather than freeform messages.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type** — one of:
  - `feat` — new feature or capability
  - `fix` — bug fix
  - `docs` — docs/plan-only changes (`docs/`, `persona-router-blueprint.md`, README, etc.)
  - `refactor` — code change that's neither a fix nor a feature
  - `perf` — performance improvement
  - `test` — adding/fixing tests only
  - `style` — formatting/whitespace, no logic change
  - `build` — packaging, electron-builder, bundler/config changes
  - `ci` — CI/workflow changes
  - `chore` — deps, tooling, repo maintenance
  - `revert` — reverts a previous commit
- **scope** (optional but preferred) — the area touched. Use one of, or the closest fit, lowercase-kebab:
  `bootstrap`, `design-system`, `auth`, `data`, `adapters`, `messaging`, `groups`, `routines`, `github`,
  `usage`, `ui`, `deps` — these line up with the `docs/plan/NN-*.md` phases so scope maps to phase.
- **subject** — imperative mood ("add", not "added"/"adds"), no capitalized first letter unless a proper
  noun, no trailing period, first line ≤72 chars total including `type(scope): `.
- **body** (optional) — wrap ~72 chars, blank line after subject. Explain _what changed and why_, not a
  line-by-line restatement of the diff. Omit for small/obvious commits.
- **footer** (optional) — `BREAKING CHANGE: <description>` if applicable; `Refs #<n>` / `Closes #<n>` for
  issue/PR references.

Do **not** add a `Co-Authored-By` trailer or any other AI-attribution line — this project's commits stay
plain Conventional Commits, no exceptions.

## Examples

```
feat(adapters): add Codex runStreamed event normalization

Maps CommandExecutionStatus into the shared AgentEvent shape so the
UI can show live tool-execution state, matching blueprint §3.
```

```
fix(usage): stop double-counting Codex cached_input_tokens

cached_input_tokens is a subset of input_tokens per SDK output, not
additive — cost formula was summing both.
```

```
docs(routines): note tray requirement as hard dependency for §7
```

## Process

1. `git status` and `git diff` (staged + unstaged) to see the actual change set — don't infer the
   message from the request alone.
2. Never stage `.env`, credentials, tokens, or anything matching `.gitignore` — double-check before
   `git add` rather than trusting a blanket `-A`, and if something sensitive is unstaged-but-dirty,
   leave it out and say so.
3. If the working tree mixes unrelated changes, split into separate commits by logical concern rather
   than one grab-bag commit — one `type(scope)` per commit is the point of the convention.
4. Pick `type`/`scope` from what's actually in the diff (schema + migration → `feat(data)` or
   `refactor(data)`; adapter bug → `fix(adapters)`; plan doc edit → `docs`).
5. Stage only the relevant files, draft the message per the format above, commit.
6. Only commit when asked; only push or open a PR if explicitly asked to. If currently on `main` and the
   change is more than trivial, create/switch to a feature branch first unless told otherwise.
7. Show the final commit message and `git log -1` result so the user can confirm it landed as intended.
