---
name: commit
description: Create git commits in this repo using Conventional Commits / Commitizen format (type(scope): subject). Use whenever asked to commit changes, write a commit message, or run /commit.
---

# Commit — Conventional Commits (Commitizen format)

This repo commits using the [Conventional Commits](https://www.conventionalcommits.org/) format that
Commitizen (`cz`) prompts for. Follow this format exactly rather than freeform messages.

`git log` here is a **design record, not a changelog** — it is where the reasoning that did not fit
in a comment lives. Write the body for the person running `git log` in six months, and say what was
measured when something was.

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
- **scope** — lowercase-kebab name of the area or feature touched. In practice this repo's scopes
  are free-form area names (`adapters`, `messaging`, `personas`, `groups`, `shell`, `usage`,
  `data`, `e2e`, `plan`, …). Check `git log --oneline` and reuse an existing scope when one fits
  the same area; coin a new one only for a genuinely new area.
- **subject** — imperative mood ("add", not "added"/"adds"), no capitalized first letter unless a
  proper noun, no trailing period, first line ≤72 chars total including `type(scope): `.
- **body** — wrap ~72 chars, blank line after subject. Explain _what changed and why_ — the
  constraint, the alternative rejected, the number measured — not a line-by-line restatement of
  the diff. Omit for small/obvious commits.
- **footer** (optional) — `BREAKING CHANGE: <description>` if applicable; `Refs #<n>` /
  `Closes #<n>` for issue/PR references.

Do **not** add a `Co-Authored-By` trailer or any other AI-attribution line — this project's
commits stay plain Conventional Commits, no exceptions.

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
   `git add` rather than trusting a blanket `-A`. **Never `git add -A` without reading
   `git status` first**: worktrees share this repo with other agents, and a sweep has already once
   captured someone else's uncommitted work. If something sensitive is unstaged-but-dirty, leave it
   out and say so.
3. One logical change per commit. In particular: **a defect fix found while building a feature
   lands on its own, ahead of the feature**, so it stays bisectable and can be reverted without
   taking the feature with it. A working tree mixing unrelated changes becomes several commits.
4. Pick `type`/`scope` from what's actually in the diff (schema + migration → `feat(data)` or the
   feature's own scope; adapter bug → `fix(adapters)`; plan doc edit → `docs(plan)`).
5. If the change embodies a decision — a governance change, an idiom chosen, an ambiguity resolved —
   pair it with an entry in `docs/plan/00-progress.md`, committed as its own `docs(plan)` commit.
   The tracker outranks the phase docs and must not lie about the build.
6. Stage only the relevant files, draft the message per the format above, commit.
7. Only commit when asked; only push or open a PR if explicitly asked to. If currently on `main`
   and the change is more than trivial, work belongs on a branch in a worktree per `CLAUDE.md`.
8. Show the final commit message and `git log -1` result so the user can confirm it landed as
   intended.
