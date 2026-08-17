# Working on Switchboard

Conventions an agent joining this repository cannot infer from the code. Read
this before making changes; everything here was learned the expensive way.

## Where to work

**Use a git worktree. Do not build a phase in the primary checkout.**

```bash
git worktree add ../resolve-app-demo-<phase> -b phase-<n>-<slug> main
cd ../resolve-app-demo-<phase> && npm ci && cp ../resolve-app-demo/.env .
```

More than one agent works this repository at a time. One checkout with two
writers means `git checkout` pulls the floor out from under whoever else is
mid-edit, a broad `git add -A` sweeps up their uncommitted work, and two builds
race over the same `out/` directory. This has already gone wrong once: a branch
was cut from another agent's unmerged tip, and two commits from one phase landed
in history under another phase's merge.

Worktrees share the object store, so a sibling's branch is fully readable —
`git show <branch>:<file>`, `git diff main...<branch>` — without a merge and
without leaving your own tree. That property is the same one Phase 12 relies on
for personas, and the reasoning is worth reading in
`docs/plan/12-worktree-isolation.md`.

`node_modules` is **not** shared. Each worktree needs its own `npm ci`, because
`postinstall` runs `electron-builder install-app-deps` and rebuilds
better-sqlite3 against Electron's ABI.

## Commits

- **Conventional Commits.** `fix(codex):`, `feat(data):`, `test(e2e):`,
  `docs(plan):`, `perf(adapters):`.
- **No `Co-Authored-By` trailer.** Not in this repo.
- One logical change per commit. A defect fix found while building a feature
  lands on its own, ahead of the feature, so it stays bisectable and can be
  reverted without taking the feature with it.
- The message says **why**, and what was measured. `git log` here is a design
  record, not a changelog — it is where the reasoning that did not fit in a
  comment lives.
- Never `git add -A` without reading `git status` first.

## Planning and progress

`docs/plan/00-progress.md` is the source of truth for build order and for every
decision that resolved an ambiguity in the blueprint. It outranks the individual
phase docs; where a phase doc and the blueprint disagree, the blueprint wins
unless a decision entry explicitly supersedes it.

Keep it honest as you go. A phase whose commits are on `main` while the tracker
says "Not started" is a document lying about the build.

## Tests

**A phase is not Done until its testable logic has tests.** The scope is called
out as part of the phase, not bolted on afterwards.

- `npm test` runs the unit suite, and `npm run build` runs typecheck + tests
  before bundling — so packaging cannot ship a red suite. Note the consequence:
  a deliberate mutation to check that a test has teeth will fail the gate and
  leave Playwright driving the *previous* bundle. Rebuild with
  `npx electron-vite build` directly when doing that.
- Database-backed services test against a real `:memory:` SQLite with the
  checked-in migrations applied (`createTestDb`), never hand-written DDL. A copy
  of the schema drifts from the migration the moment either changes, and the
  drift looks like a passing test.
- Anything touching a vendor SDK is split into a pure normalization layer plus a
  thin call, and the pure layer is tested against event shapes **captured from
  real runs**. Fabricated fixtures test our reading of the docs rather than the
  SDK.
- The renderer Vitest project matches `*.test.ts` only, never `.tsx`. Logic worth
  testing goes in `src/renderer/src/lib/`.

**Write tests from the claim, not from the code.** A green suite proves the
tests agree with the implementation and nothing more. `sandbox.test.ts` once had
a case named "rejects sed -i" that passed while `sed -ni` walked straight
through the guard it was testing. For anything making a security or correctness
claim, prefer executing the function over reading it.

## Live checks

Behaviour that costs money or needs a real network lives in `*.live.test.ts`,
**checked in** and skipped behind an env var, so it can be re-run on demand
rather than being a thing someone once did:

| Gate | What it proves |
|---|---|
| `LIVE_CODEX_CONTEXT=1` | a repository cannot instruct a Codex persona |
| `LIVE_GITHUB=1` | real pull requests, create-or-comment, dead-token wording |
| `LIVE_JOURNEY2=1` | blueprint §16 Journey 2, end to end |
| `LIVE_JOURNEY3=1` | blueprint §16 Journey 3, end to end |
| `LIVE_WORKTREES=1` | worktree isolation against real git |

`npm run probe:adapters` and `npm run probe:structured` drive the real SDKs
outside Electron. That only works because **nothing under `src/main/adapters/`
may import `electron` or the database** — everything machine-specific is
injected through `AdapterConfig`, built in exactly one place
(`src/main/services/adapter-host.ts`).

Prefer a free instrument where one exists. `codex debug prompt-input` renders the
exact model-visible prompt locally; asking a model what it can see costs money
and is less precise.

## Two words that mean two things

A **Skill** in this app (blueprint §4) is injected prose, composed into the
system prompt by `composeInstructions`. A **Claude Code / Codex skill** is an
executable capability the model chooses to invoke, discovered from disk. Same
word, different things — UI copy has to keep them apart.

## What this app deliberately does not do

A persona is sealed against the repository it works in. Claude gets
`settingSources: []`; Codex gets `project_doc_max_bytes: 0`, `features.hooks =
false`, and every discovered skill disabled by name. Repo `CLAUDE.md`,
`AGENTS.md`, skills, hooks, subagents and `.mcp.json` reach a session only when
a human has opted that Contact in.

If you find yourself removing one of those to make something work, that is a
governance decision and belongs in `00-progress.md`, not in a diff.
