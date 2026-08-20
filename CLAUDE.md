# Working on Switchboard

Conventions an agent joining this repository cannot infer from the code. Read
this before making changes; everything here was learned the expensive way.

This file is how to _work on_ Switchboard. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
is how it _works_ — the process boundary, the two adapters, the permission axes,
the measured facts about both SDKs, and what the app deliberately refuses to do.
Read that one first if the question is "why is it built like this".
`docs/plan/` is the build history behind it, kept for provenance and not shipped;
nothing in `src/` should cite it.

## Where to work

**Use a git worktree. Do not build in the primary checkout.**

```bash
git worktree add ../resolve-app-demo-<slug> -b <slug> main
cd ../resolve-app-demo-<slug> && npm ci && cp ../resolve-app-demo/.env .
```

More than one agent works this repository at a time. One checkout with two
writers means `git checkout` pulls the floor out from under whoever else is
mid-edit, a broad `git add -A` sweeps up their uncommitted work, and two builds
race over the same `out/` directory. This has already gone wrong once: a branch
was cut from another agent's unmerged tip, and two commits from one branch
landed in history under another's merge.

Worktrees share the object store, so a sibling's branch is fully readable —
`git show <branch>:<file>`, `git diff main...<branch>` — without a merge and
without leaving your own tree. It is the same property the app's own worktree
isolation relies on for personas — see ARCHITECTURE.md.

`node_modules` is **not** shared. Each worktree needs its own `npm ci`, because
`postinstall` runs `electron-builder install-app-deps` and rebuilds
better-sqlite3 against Electron's ABI — and then re-signs the freshly unpacked
dev Electron with the app's Developer ID (`scripts/sign-dev-electron.sh`), which
is what lets every worktree read the same stored credentials. The very first
signing on a machine raises a one-time keychain dialog; approve it ("Always
Allow") or the install leaves the binary ad-hoc and stored secrets read as
locked. A machine without the certificate skips signing and still installs.

## Commits

- **Conventional Commits.** `fix(codex):`, `feat(data):`, `test(e2e):`,
  `docs(architecture):`, `perf(adapters):`.
- **No `Co-Authored-By` trailer.** Not in this repo.
- One logical change per commit. A defect fix found while building a feature
  lands on its own, ahead of the feature, so it stays bisectable and can be
  reverted without taking the feature with it.
- The message says **why**, and what was measured. `git log` here is a design
  record, not a changelog — it is where the reasoning that did not fit in a
  comment lives.
- Never `git add -A` without reading `git status` first.

## Where a design decision lives

`docs/ARCHITECTURE.md` is the current design record and outranks everything in
`docs/plan/`, which is a build log written phase by phase and stale in places —
it still describes tool calls as unpersisted, isolation as immutable, and a
`full_access` persona as free to carry a narrower GitHub scope. All three were
reversed. When the two disagree, ARCHITECTURE.md is right; if it turns out not
to be, fix it there rather than adding a correction somewhere else.

A decision that changes what the app refuses to do goes in ARCHITECTURE.md as
part of the change that makes it, not in a commit message alone.

## Tests

**A change is not done until its testable logic has tests.** They are part of
the work, not bolted on afterwards.

- `npm test` runs the unit suite, and `npm run build` runs typecheck + tests
  before bundling — so packaging cannot ship a red suite. Note the consequence:
  a deliberate mutation to check that a test has teeth will fail the gate and
  leave Playwright driving the _previous_ bundle. Rebuild with
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

| Gate                   | What it proves                                            |
| ---------------------- | --------------------------------------------------------- |
| `LIVE_CODEX_CONTEXT=1` | a repository cannot instruct a Codex persona              |
| `LIVE_GITHUB=1`        | real pull requests, create-or-comment, dead-token wording |
| `LIVE_JOURNEY2=1`      | Journey 2 — two personas coordinating, end to end         |
| `LIVE_JOURNEY3=1`      | Journey 3 — a routine to a pull request, end to end       |
| `LIVE_WORKTREES=1`     | worktree isolation against real git                       |

`npm run probe:adapters` and `npm run probe:structured` drive the real SDKs
outside Electron. That only works because **nothing under `src/main/adapters/`
may import `electron` or the database** — everything machine-specific is
injected through `AdapterConfig`, built in exactly one place
(`src/main/services/adapter-host.ts`).

Prefer a free instrument where one exists. `codex debug prompt-input` renders the
exact model-visible prompt locally; asking a model what it can see costs money
and is less precise.

## Icons

Every icon PNG in `build/` and `resources/` is **generated**. Edit the SVG
beside it and run `npm run icons`; hand-editing a PNG means the next person to
run that script silently reverts you.

`build/icon.icns` and `build/icon.ico` are absent on purpose — electron-builder
derives both from `build/icon.png`, so adding either back means maintaining a
copy that drifts.

The tray marks are **not** the app icon scaled down. They are drawn separately
because the icon's proportions collapse into one black blob at 16px, and they are
black-on-transparent because a macOS template image keeps only alpha — which is
also why "a turn is running" is signalled by shape rather than by a green dot.

## Two words that mean two things

A **Skill** in this app is injected prose, composed into the
system prompt by `composeInstructions`. A **Claude Code / Codex skill** is an
executable capability the model chooses to invoke, discovered from disk. Same
word, different things — UI copy has to keep them apart.

## What this app deliberately does not do

A persona is sealed against the repository it works in. Claude gets
`settingSources: []`; Codex gets `project_doc_max_bytes: 0`, `features.hooks =
false`, and every discovered skill disabled by name. Repo `CLAUDE.md`,
`AGENTS.md`, skills, hooks, subagents and `.mcp.json` reach a session only when
a human has opted that Contact in.

The full list is ARCHITECTURE.md's "What this app deliberately does not do".
If you find yourself removing one of them to make something work, that is a
governance decision and belongs in that section, not in a diff.
