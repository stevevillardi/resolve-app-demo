# Phase 4 — Data Layer

**Status:** Done
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

- [x] All 8 tables exist via checked-in migrations, match blueprint §12 field-for-field.
- [x] Creating a Skill and a PersonaTemplate through the UI persists across app restart.
- [x] Deleting/editing works and reflects immediately via TanStack Query cache invalidation.
- [x] Zod validation rejects malformed input at the IPC boundary (test with an obviously bad payload).

## How it landed

### Decisions taken during the phase

- **Routines are table-only, not CRUD.** The scope list above never included routine procedures, while the out-of-scope note said "`routines` table CRUD only" — read together they were ambiguous. Resolved in favour of the table alone: a Routine is bound to a Contact, and no contact can exist until Phase 6, so routine CRUD would have meant shipping a create flow with a permanently empty foreign key to point at. `RoutineList`/`RoutineEditor` stay on mock data; the carry-forward is recorded in `08-routines-scheduler.md`.

- **First run seeds skills and personas, nothing else.** Five skills and three persona templates (`src/main/db/seed-data.ts`), guarded by an `app_state.seed_version` marker. Both are library-level and machine-independent, so seeding them offers starting content rather than fabricating state. Contacts and Groups are deliberately not seeded — they bind to a real local repo path that nothing can know until the user picks one.
  The guard is a **marker, not an emptiness check**. "Seed if the tables are empty" would silently resurrect content the user deliberately deleted on the next launch; the marker records that seeding happened, not what survived it.
  The seed reuses the same ids as `src/renderer/src/mocks/` (`persona-code-reviewer`, `skill-typescript-style`, …), so the screens still running on mocks — `RoutineList`, `UsageDashboard`, `UsageScopeList` — keep joining correctly against the now-real personas instead of rendering orphans.

- **Delete semantics: block a persona, detach a skill.** Deleting a PersonaTemplate with bound Contacts is refused, with an error naming them. Deleting a Skill succeeds and strips its id from every persona's `skill_ids` in one transaction — a skill is injected text, so losing one degrades a persona's instructions rather than breaking the persona, and blocking would force the user to hand-unattach it everywhere first. `SkillLibraryView`'s confirm dialog names the affected personas before the click.

- **`messages` has no `status` or `error` column.** Blueprint §12 lists exactly five fields, and the renderer's extra two (`streaming`, `error`) describe a turn currently in flight rather than a stored fact — a message reloaded from disk is by definition finished. The persisted shape lives in `src/shared/domain.ts`; `src/renderer/src/types/message.ts` extends it with the transient fields. Recorded so Phase 6 doesn't quietly add columns for them.

- **Domain types moved to `src/shared/domain.ts`.** They were renderer-only (`src/renderer/src/types/*.ts`), which would have meant main redeclaring all eight. They are now Zod schemas with inferred types — the same pattern `ipc-contract.ts` already used — so the tables, the contract, and the renderer are one definition. `@/types` re-exports them, so no import in the thirteen consuming components changed.

### Things worth knowing before touching this layer

- **`PRAGMA foreign_keys` is OFF by default in better-sqlite3.** Without the explicit `ON` in `src/main/db/create.ts`, every `references()` in the schema is decorative — including the `ON DELETE RESTRICT` the persona-delete rule relies on. There is a test that deliberately bypasses the service check and asserts SQLite itself blocks the delete, so this can't silently regress.

- **`cost_usd` is REAL, not INTEGER.** A turn costs fractions of a cent. Drizzle's `integer()` was the obvious-looking choice and would have been wrong.

- **drizzle-kit needs a TTY when a table is removed**, because it prompts about rename-vs-drop. Adding eight tables while deleting `_bootstrap_check` in one step hits that prompt and fails in a non-interactive shell. Split into two unambiguous generates instead — `0002_add_blueprint_schema` (additive only) then `0003_drop_bootstrap_check` (deletion only) — which also reads better as history.

- **`createDb` is separate from `initDb`** (`src/main/db/create.ts` vs `index.ts`) purely so it can be imported without pulling in `electron`. That is what lets `src/main/db/test-db.ts` build an identically-migrated `:memory:` database by running the real `drizzle/` folder, instead of hand-copying DDL that then drifts. `app-state.test.ts` was retro-fitted onto it.

- **E2E: use `waitForBridge`, not `waitForShell`, when a test only needs IPC.** The shell doesn't exist until onboarding is complete, so waiting on the sidebar in a profile that hasn't onboarded just times out against the splash.

### Tests

91 new unit tests (280 total, up from 183) plus 5 new E2E (19 total). Statement coverage 86.7%, up from ~83%.

- `src/main/db/mappers.test.ts` — row↔domain round trips through a real migrated database, since the Date/boolean/JSON conversions are things Drizzle does on the way out.
- `src/main/services/{skills,persona-templates,contacts,seed}.test.ts` — CRUD, both delete rules, group auto-creation and its transaction rollback, and that a user-deleted seed skill stays deleted.
- `src/shared/domain.test.ts` — the enum unions, since SQLite has no enum type and would happily store `'telepathy'` in `backend`.
- `src/renderer/src/lib/ipc-client.test.ts` — unwrapping Electron's `Error invoking remote method '…'` prefix, so a service's user-facing message isn't shown with the transport wrapped around it.

### Verified manually

Upgrade path on the real Phase 3 profile (`_bootstrap_check` dropped, `app_state` and the GitHub token preserved, seed applied, `PRAGMA foreign_key_check` clean), then the full UI loop over CDP: create a skill via "+", rename, save, confirm the row in SQLite; delete a skill attached to two personas and watch both `skill_ids` arrays lose it while a third persona is untouched; create a persona via "+" with `read_only` defaults and save; bind a contact and confirm the persona delete is refused with the contact named inline. Packaged `.app` runs all four migrations and seeds on a clean profile.
