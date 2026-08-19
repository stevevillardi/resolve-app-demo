---
name: feature-research
description: How to research a new feature in this codebase before building it — the reading order, the end-to-end seam a data-backed feature crosses, the traps that don't show up in a grep, and what a finished research write-up must contain. Use for "how would we add X" and pre-implementation exploration tasks.
---

# Researching a new feature

The goal of research here is a plan someone can execute without rediscovering
the traps. This app's bugs live at boundaries (process, schema, SDK), so the
research deliverable is the *seam*, end to end — not a pile of file summaries.

## Reading order

1. `CLAUDE.md` — the conventions, especially worktrees and the sealed-persona
   governance rules.
2. `docs/plan/00-progress.md` — the decision log. It **outranks the phase
   docs**; where a phase doc and the blueprint disagree, the blueprint wins
   unless a decision entry supersedes it. Search it for your topic before
   concluding anything is undecided.
3. The blueprint (`persona-router-blueprint.md`) section nearest your feature,
   then the relevant `docs/plan/NN-*.md`.

## Trace the whole seam

A data-backed feature crosses every one of these, in this order. Name the
exact touch-point in each file in your write-up:

| Layer | File | What to check |
| --- | --- | --- |
| DB schema | `src/main/db/schema.ts` | column shape; the nullable-no-backfill idiom below |
| Migration | `drizzle/NNNN_*.sql` via `npx drizzle-kit generate --name <slug>` | applied at startup by `migrate()` in `src/main/db/create.ts`; add the house-style comment explaining *why* |
| Row → domain | `src/main/db/mappers.ts` | null coalescing carries meaning here |
| Zod domain | `src/shared/domain.ts` | entity vs draft: fields the server defaults stay **optional on the draft** (keeps every draft-shaped fixture compiling) |
| Service | `src/main/services/*.ts` | update `.set({...})` lists columns **explicitly — an omission is a silent no-op** (the `model` regression); create fills server-side defaults |
| IPC contract | `src/shared/ipc-contract.ts` + `src/main/ipc/procedures/*` | usually zero edits if it composes the domain schemas — verify, don't assume |
| Renderer data | `src/renderer/src/hooks/*` | TanStack Query keys; invalidation on mutate |
| UI | `src/renderer/src/components/**` | see the form trap below |

Two renderer traps that don't show up in a type error:

- **Whole-form saves compare JSON**: `PersonaForm`'s `edited` object must name
  every editable field explicitly — `...persona` round-trips the stored value,
  so an omitted field edits on screen while Save stays disabled.
- **Grep for every consumer, including bypasses.** Shared components hide most
  call sites, but some inline the underlying helper (e.g. the group tile calls
  `botttsDataUri` directly instead of `AvatarColorSwatch`). Grep for the
  helper, not just the component.

## Established idioms to reuse, not reinvent

- **Nullable column, null carries the pre-column meaning, no backfill** —
  `mcp_server_ids` ("no servers"), `groups.name` ("default name"),
  `avatar_seed` ("seed = the row's id"). SQLite can't `ADD COLUMN NOT NULL`
  with a per-row default, and the coalesce in the mapper can never drift the
  way a backfill can.
- **Ids minted in main** (`crypto.randomUUID()`), never accepted from the
  renderer; drafts omit `id`.
- **Seeded data** (`src/main/db/seed-data.ts`) is typed as full entities, so a
  new required field forces explicit values there — decide what they should be.

## Governance is not an implementation detail

A persona is sealed against its repository (Claude `settingSources: []`; Codex
`project_doc_max_bytes: 0`, hooks off, discovered skills disabled). If the
feature only works by loosening one of those, that is a **decision for
`docs/plan/00-progress.md`**, not a diff. The same goes for anything giving a
routine or agent a new side-effect channel (push, PR, network).

## The write-up

A finished research task states:

1. The recommended approach and the decision(s) it rests on (with the idiom or
   decision-log entry that justifies each).
2. The seam: every file to touch, in build order, with the trap at each layer.
3. Test obligations (tests are part of the phase — see the unit-tests skill):
   what the new column/field owes, which fixtures will fall out.
4. How to verify end to end (unit suite + driving the real app — see the
   drive-app skill).
5. What was deliberately left out, so scope creep is a choice someone makes,
   not a drift.

Build in a worktree (`git worktree add ../resolve-app-demo-<slug> -b <branch>
main`), never the primary checkout — it is shared with other agents.
