# Phase 4 — Data Layer

**Status:** Not started
**Blueprint refs:** §4 (data model), §12 (SQLite schema)
**Depends on:** Phase 1 (bootstrap — DB pipeline proven)

## Goal

Real Drizzle schema and migrations for every table in blueprint §12, plus IPC CRUD procedures (via Phase 1's hand-rolled `ipc-contract.ts` layer — see `docs/plan/00-progress.md` decisions log for why this replaced tRPC) for the entities that don't depend on a backend adapter existing yet (skills, persona templates, contacts-as-records — not contacts-with-live-sessions). This turns Phase 2's static shells into real, persisted data for the parts of the UI that are pure CRUD.

## Scope

1. **Schema** — translate blueprint §12 directly into Drizzle table definitions: `skills`, `persona_templates`, `contacts`, `groups`, `group_messages`, `messages`, `routines`, `usage_events`. Match field types/nullability to blueprint §4's TypeScript shapes.
2. **Migrations** — real drizzle-kit migration files checked into the repo (not just `db push`), so schema evolution is tracked.
3. **IPC procedures** (entries in `src/shared/ipc-contract.ts`, handlers in `src/main/ipc/procedures/`): full CRUD for `skills` and `persona_templates`. Create/list/get for `contacts` (no session logic yet — that's Phase 6). Create/list for `groups` (one per repo, likely auto-created on first contact bound to a repo).
4. **Wire Phase 2's static shells to real data**: `SkillLibraryView`, `PersonaDetailPanel` (create/edit), sidebar `ConversationList` now reads real `contacts`/`groups` instead of mocks (will be empty until Phase 6 lets you create one via `NewContactFlow`).
5. **Zod schemas** for all IPC procedure inputs/outputs, defined once in `src/shared/ipc-contract.ts` and shared between main and renderer.

## Explicitly out of scope

- `backend_session_id` actually pointing at a live session (Phase 5/6).
- `group_messages`, `messages`, `usage_events` writes — no producer of this data exists until later phases; tables exist and are queryable but stay empty.
- Routine execution — `routines` table CRUD only, scheduler is Phase 8.

## Acceptance checks

- [ ] All 8 tables exist via checked-in migrations, match blueprint §12 field-for-field.
- [ ] Creating a Skill and a PersonaTemplate through the UI persists across app restart.
- [ ] Deleting/editing works and reflects immediately via TanStack Query cache invalidation.
- [ ] Zod validation rejects malformed input at the IPC boundary (test with an obviously bad payload).
