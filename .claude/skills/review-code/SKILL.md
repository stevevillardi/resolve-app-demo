---
name: review-code
description: Review Persona Router code changes for DRY violations, edge cases, missing test coverage, and stack-specific pitfalls (Electron process boundary, tRPC/IPC, Drizzle, Claude/Codex adapter normalization, concurrency lock, Zustand/TanStack Query). Use when reviewing a diff, PR, or feature before merging in this repo.
---

# Persona Router — Code Review

Project-specific review lens for this repo (Electron + Vite + React, tRPC-over-IPC, Drizzle/SQLite,
Claude Agent SDK + Codex SDK adapters, GitHub OAuth device flow, Zustand, TanStack Query, shadcn/Tailwind).
Architecture reference: `persona-router-blueprint.md` (repo root) and `docs/plan/*.md`.

For a general correctness/simplification pass over a diff, the built-in `/code-review` skill already
does mechanical scanning. Use _this_ skill as the additional, stack-aware checklist — DRY, edge cases,
missing tests, and the architecture rules this specific app depends on — whether run standalone or
layered on top of that pass.

## Process

1. Get the full diff (`git diff` against `main`, or the PR/branch given). Read touched files in full,
   not just the hunk — this app's bugs are usually about a boundary being crossed, which a hunk alone
   won't show.
2. Walk the categories below; skip categories with nothing relevant in the diff.
3. Rank findings: correctness and architecture-boundary violations first (they're effectively security/
   stability bugs in this app's threat model), then DRY, then missing tests, then style.
4. Report each finding as: `file:line`, one-sentence defect statement, a concrete failure scenario
   (specific input/state → wrong behavior or crash), and a suggested fix.

## 1. DRY / duplication

- Claude/Codex adapter logic duplicated instead of going through the shared `AgentEvent` normalization
  layer (blueprint §3) — UI and cost logic should only branch where the backends _genuinely_ diverge
  (tool-execution visibility, presence/absence of a direct dollar cost).
- Zod schemas hand-duplicated between a tRPC procedure's input and the Drizzle table shape, instead of
  deriving one from the other (e.g. `drizzle-zod`) or sharing a single source of truth.
- Repeated TanStack Query key arrays / fetcher bodies across components instead of a shared query hook.
- Copy-pasted tRPC router/procedure boilerplate (auth checks, error mapping) that belongs in shared
  middleware.
- Cost-calculation logic (Claude vs Codex) reimplemented per call site instead of centralized — this is
  the kind of drift that produces the double-counting bug called out in blueprint §14.
- Repeated Tailwind class clusters that should be a shadcn variant, a `cn()` helper, or a shared
  component.

## 2. Process boundary & architecture (blueprint §2)

Hard rule: **the renderer never touches the filesystem, SQLite, the SDKs, node-cron, or `safeStorage`
directly** — only typed tRPC procedures. Treat any violation as high severity, not style.

- Renderer-side code importing `better-sqlite3`, `fs`, an SDK client, or `node-cron`.
- A tRPC procedure returning something non-serializable, or echoing a secret (GitHub token,
  `ANTHROPIC_API_KEY`) back into a renderer-bound payload.
- A new tRPC procedure with no Zod input schema, or one whose schema is looser than the DB constraint
  it feeds.
- Secrets stored or logged in plaintext instead of via Electron `safeStorage` (GitHub token) or env
  (`ANTHROPIC_API_KEY`) — check new logging statements too, not just storage code.
- Git/GitHub side effects (push, PR, comment) issued by trusting the agent to shell out, instead of
  going through the explicit Octokit-backed action (blueprint §9) — this must stay an explicit user/UI
  action, never an automatic one, especially for routine-triggered runs.

## 3. Concurrency & governance (blueprint §6, §7, §15D)

- Any new call path that invokes `AgentAdapter.run()` (message, @mention, or routine fire) without
  checking/acquiring the `repoPath → busy` lock first, or without releasing it on completion/error
  (including thrown exceptions and stream aborts — a leaked lock wedges that repo permanently).
- Routine-triggered runs that skip the concurrency check, don't log a `UsageEvent` with
  `source: "routine"`, or default to a `githubScope` broader than `open_pr`.
- Anything that lets a routine push directly instead of opening a PR.

## 4. Edge cases

General:

- Empty/zero states: no personas, no contacts, no repo bound yet, empty skill library.
- A message/action sent to a contact while a run is already in-flight on that repo.
- Streaming interrupted mid-turn (network drop, process crash, app quit) — is partial state left
  consistent in SQLite and reflected correctly in the UI on next load, or does it look silently stuck?

Stack-specific:

- Session resume (`resume(sessionId)`) called with a stale/invalid id (app updated, session expired,
  DB out of sync with backend state).
- Codex `cached_input_tokens` vs `input_tokens` — additive or subset is still explicitly unconfirmed
  per blueprint §14.2. Any change touching usage/cost math must not silently assume one or the other;
  flag if it's not tested against real SDK output.
- Claude adapter's known tool-execution visibility gap (blueprint §3) — UI must show a distinct
  "working, no live detail" state, not a fake progress indicator and not Codex's live
  `CommandExecutionStatus` treatment reused verbatim.
- Codex `config.developer_instructions` reliability (blueprint §3, §14.1) is unverified — if a diff
  depends on it actually reaching the model, check whether the `model_instructions_file`/`AGENTS.md`
  fallback is wired or at least stubbed.
- Drizzle migrations: does a schema change ship a migration, and does it handle existing rows (defaults,
  backfill) rather than assuming an empty table?
- GitHub OAuth device flow: expired/revoked token, user with zero accessible repos.
- Cron edge cases in Routine scheduling: invalid cron string, DST transitions, a routine enabled while
  its repo has no bound Contact.

## 5. Test coverage

- Changed business logic — adapters, cost/usage math, compaction summary handling, the concurrency
  lock — should have a corresponding unit test. These three areas are explicitly the ones the blueprint
  flags as bug-prone (§3, §14); treat a diff touching them with no test as a real gap, not a nit.
- tRPC procedures: at least one test exercising the Zod validation failure path, not just the happy path.
- No leftover test-only artifacts: stray `console.log`, `.only`/`.skip`, commented-out assertions.

## 6. Data model & schema fidelity

- New/changed fields match the shapes in blueprint §4/§12 (`Skill`, `PersonaTemplate`, `Contact`,
  `Group`/`GroupMessage`, `Routine`, `UsageEvent`) unless a decision in `docs/plan/00-progress.md`
  explicitly supersedes it — check that file's "Decisions made during planning" section before flagging
  a mismatch as a bug.
- `GroupMessage.durable` handling matches the compaction rule (§6): `decision`/`tradeoff` → durable,
  always injected; `routine` → non-durable, only most-recent-N injected, rest stay queryable only.

## Output

List findings ranked by severity (correctness/architecture first). For each: file:line, the defect in
one sentence, the concrete failure scenario, and a suggested fix. If nothing survives review, say so
plainly rather than padding with style nits.
