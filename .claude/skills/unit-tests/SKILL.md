---
name: unit-tests
description: This repo's unit-test conventions — createTestDb against real migrations, write-from-the-claim, adapter fixtures captured from real runs, env-gated live tests, renderer test placement, and the regression patterns every new column/field owes. Use when writing or reviewing tests here.
---

# Unit tests in this repo

`npm test` runs the whole suite (Vitest). `npm run build` runs typecheck + the
suite before bundling, so packaging cannot ship red. A phase is not Done until
its testable logic has tests — scope them as part of the work, not after.

## Write from the claim, not from the code

A green suite only proves the tests agree with the implementation.
`sandbox.test.ts` once had a case named "rejects sed -i" that passed while
`sed -ni` walked straight through the guard. For anything making a security or
correctness claim, execute the function with the adversarial input; don't
assert around a mock of it.

## Database-backed services

- Test against a real `:memory:` SQLite with the checked-in migrations applied:
  `createTestDb()` (`src/main/db/test-db`). **Never hand-written DDL** — a copy
  of the schema drifts from the migration the moment either changes, and the
  drift looks like a passing test.
- Services import the DB via `initDb()`; tests mock the module:
  `vi.mock('../db', () => ({ initDb: () => db }))` with `db = createTestDb()`
  in `beforeEach` (see `persona-templates.test.ts`).

### What a new column owes (learned the hard way, twice)

`updatePersonaTemplate`-style services list every column explicitly in
`.set({...})` — an omitted column is a **silent no-op, not a type error**; that
is exactly how `model` shipped unsaved. Every added column needs:

1. an update round-trip test: change it, read it back;
2. if nullable-with-meaning (the `mcp_server_ids` / `avatar_seed` idiom:
   null = "the pre-column default", coalesced in `mappers.ts`): a raw
   `db.insert(...)` of a row *without* the column, then assert the mapper's
   coalesced read — this proves the real migration + mapper pair, not the happy
   path;
3. a create test if create defaults it server-side.

### Fixture fallout when an entity grows a field

- Keep the field **optional on the draft schema** when create defaults it —
  that is what keeps the ~40 draft-shaped fixtures compiling untouched.
- Fixtures typed `: PersonaTemplate` fail typecheck and tell you where to look.
  But Zod fixtures like `domain.test.ts`'s `PERSONA` are **untyped object
  literals** — typecheck passes and the suite fails at runtime. Run both.

## Adapters and SDKs

- Anything touching a vendor SDK splits into a pure normalization layer plus a
  thin call. The pure layer is tested against event shapes **captured from real
  runs** — fabricated fixtures test our reading of the docs, not the SDK.
- `npm run probe:adapters` / `npm run probe:structured` drive the real SDKs
  outside Electron (possible because nothing under `src/main/adapters/` may
  import `electron` or the DB — everything machine-specific arrives via
  `AdapterConfig`).
- Prefer a free instrument: `codex debug prompt-input` renders the exact
  model-visible prompt locally; asking a model what it sees costs money and is
  less precise.

## Live tests

Behaviour that costs money or needs a real network lives in `*.live.test.ts` —
checked in, skipped unless its env var is set, so it can be re-run on demand:

| Gate | Proves |
| --- | --- |
| `LIVE_CODEX_CONTEXT=1` | a repository cannot instruct a Codex persona |
| `LIVE_GITHUB=1` | real PRs, create-or-comment, dead-token wording |
| `LIVE_JOURNEY2=1` / `LIVE_JOURNEY3=1` | blueprint §16 journeys end to end |
| `LIVE_WORKTREES=1` | worktree isolation against real git |

## Renderer tests

- The renderer Vitest project matches `*.test.ts` **only** — never `.tsx`.
  Logic worth testing goes in `src/renderer/src/lib/` as plain functions
  (`avatar.ts`, `home.ts`, `persona-filter.ts` are the pattern), tested there.
- Component behaviour that can't move to lib is verified through e2e or an
  ad-hoc driver (see the drive-app skill), not a renderer unit test.

## Checking a test has teeth

Mutate the code and watch the test fail — but note `npm run build` will refuse
to bundle the mutation (the gate runs the suite), leaving Playwright on the old
bundle. Use `npx electron-vite build` directly for that experiment, then revert.
