# Phase 11 — Demo Journeys & Polish

**Status:** In progress
**Blueprint refs:** §16 (all three journeys), §13 (scope cuts — verify nothing crept back in), §15 (all cross-cutting decisions)

## Goal

Final pass: run all three blueprint §16 journeys back-to-back in one sitting, on a clean app state, and fix whatever breaks at the seams between phases. Individual phases test their own slice; this phase is where integration gaps between them get caught — e.g. does Journey 2's Group summary correctly show up when Journey 1's Contact is also active, does Journey 3's routine respect a concurrency lock held by a Journey 1 interactive session, etc.

## Scope

1. **Full journey run-through, clean state**
   - Fresh app install (or a reset DB) → onboarding → Journey 1 → Journey 2 → Journey 3, in sequence, without developer intervention beyond what the journeys themselves specify (e.g. Journey 3's manual "run now" is allowed, that's by design).
   - Fix any integration bug found — a bug found here is by definition a gap between two phases that neither phase's own acceptance checks caught in isolation.

2. **Scope-cut audit (blueprint §13)**
   - Explicitly verify none of the deliberate v1 cuts crept back in as half-built features: no Cursor backend, no many-to-many persona/repo binding, no real-time multi-session sync, no vector search, no broadcast @mention, no hard budget caps. If any of these partially exist, either finish them properly or strip the half-built version — no half-finished implementations left in place.

3. **Cross-cutting decisions audit (blueprint §15)**
   - Re-check each of A–E against the actual running app: auth mirrors correctly (A), no per-action approval interrupts exist (B), failure states render consistently everywhere, not just where Phase 6 tested them (C), the concurrency lock is the same single in-memory map used consistently by messages/mentions/routines (D), tray/background residency actually works end to end (E).

4. **UI polish pass**
   - Loading states, empty states (no Contacts yet, no routines yet, empty Group), and error copy reviewed for clarity — these are easy to under-build during feature phases since acceptance checks focus on the happy path.
   - Dark/light mode spot-check across every screen built since Phase 2, since new screens in Phases 4-10 may not have been checked against both themes as carefully as the original design-system pass.

5. **README / demo runbook**
   - A short top-level `README.md` (if not already useful from Phase 1) covering: how to run the app, how to complete onboarding, and a condensed version of the three journeys as a demo script — useful both for the actual demo and for anyone picking this project up cold later.

## Explicitly out of scope

- New features not already specified in the blueprint. This phase is integration and polish, not scope expansion.

## Acceptance checks

- [x] All three blueprint §16 journeys run successfully in one continuous session on a clean/reset app state. _(2026-08-18 live run, log below — J1 pass, J2 pass, J3 pass-with-findings. Two human assists were needed: a GitHub reconnect whose root cause was the test harness's keychain context (F1 caveat), and the by-design native workspace-folder ask (F2). Re-run clean after fixes to close the letter of this check.)_
- [x] Scope-cut audit complete, nothing half-built found. _(All six §13 cuts hold: `cursor` rejected by the backend enum with a test asserting it; strictly one persona ↔ one repo path; no vector/semantic search (Phase 21's FTS5 is keyword search over messages); single-target mention enforced in the contract; budgets alert-only by construction (`budget-alerts.ts` header says so and the code can't refuse anything); no real-time multi-session sync beyond the write lock.)_
- [x] Cross-cutting decisions A–E all verified against the real running app. _(A: onboarding + Settings + repo picker all mirror real CLI/keychain/GitHub state — modulo F1's locked-state wording. B: `canUseTool` is a pure allow/deny layer, Codex sandbox is an OS preset; three journeys ran with zero approval interrupts. C: provoked failure rendered in-thread, not silently — wording/styling defect logged as F6. D: one lock module (`run-lock.ts` + `shared/locking.ts`) used by messages, mentions and routines; behaviorally: writer-blocks-writer with the draft preserved, routine skip names the holder, reader runs concurrently. E: window closed mid-routine-run, run completed in background, notification wiring confirmed, relaunch clean.)_
- [x] Every screen reachable in the app has a sane empty state and a sane error state, not just a happy-path render. _(Fresh-profile sweep of all seven sections captured before any content existed — all sane, with real copy. Error states: repo-picker error path, in-thread failure bubble, lock refusals all render; quality issues are F1/F6, not absences. Both-theme `npm run screens` sweep re-run at close.)_
- [x] Demo runbook written and another person (or a fresh read by whoever's demoing) can follow it without needing to ask what a step means. _(Top-level `README.md` rewritten: setup, onboarding, the three journeys as a demo script, the staged `npm run demo` profile, live-check gates.)_

**Findings F1–F7 below are logged, not fixed** — triage decides which land
as fixes (each its own commit on a `phase-11` branch) and which are recorded
as accepted limits. The phase closes after that pass plus a clean journey
re-run.

## Journey run log (live, 2026-08-18)

Target repo: `stevevillardi/switchboard-journey-demo` (throwaway, seeded with
a two-commit history whose HEAD plants two defects in `src/auth.ts`, plus two
trivial GitHub issues). Fresh profile; onboarding walked as part of the run.

- **Onboarding** — pass. All three connections detected (Claude CLI auth,
  Codex ChatGPT auth, GitHub), starter catalog's recommended tier selected,
  skills step accepted, landed on Home with first-steps.
- **Journey 1** — **pass**, with F1/F2 logged along the way. Code Reviewer
  (claude-sonnet-5, `read_only`, Security Checklist + TypeScript Style Guide)
  bound via the GitHub picker (clone flow); "review the changes in
  src/auth.ts" streamed a verdict-first reply in ~30s that caught **both**
  planted defects (expired branch returns the session; TTL added as seconds
  to a millisecond clock), called the first security-relevant (the injected
  Security Checklist visible in behavior), and flagged the absent tests.
  Clone's working tree untouched afterwards — `read_only` held. $0.31 /
  3.3k tokens on the UsageBadge.

- **Journey 2** — **pass**, all four steps. Refactor Buddy (gpt-5.4-mini,
  `workspace_write`, own-checkout isolation — the flow's recommendation
  adapts to the sandbox level) renamed `notesFor` → `notesForUser`, committed
  `0a6acb1` on `persona/refactor-buddy-0742` in ~50s, and its summary posted
  to the Group as a **durable DECISION** naming the commit and warning the
  branch isn't visible on disk. Code Reviewer's next (fresh-session) turn
  referenced both the branch/commit and its own earlier findings entirely
  unprompted — the coordinated-agents moment lands. `@Docs Writer` from the
  Group composer routed to a real session; along the way Docs Writer
  (`read_only`) tried to write `CHANGELOG.md` via a shell heredoc, **the
  sandbox denied it, nothing touched disk**, and the model recovered with
  "I'm read-only in this session, so here's the draft to paste" — an
  unplanned live proof of the deny layer. Reply landed as `agent_reply` in
  the Group and the 1:1 identically, followed by its `system_summary`.
  Usage split correctly across message/mention/summary rows; Codex's
  146.5k input had 131.3k cached and priced at $0.03.

- **Journey 3** — **pass with findings** (F4, F5). Routine created on
  Refactor Buddy (`gh open_pr`, GitHub tool enabled), schedule picker and
  "Fires on schedule even when the window is closed" copy correct.
  **Provoked lock case:** "Run now" while the same contact ran an
  interactive turn produced a legible skip — "Skipped — Refactor Buddy ·
  switchboard-journey-demo is already working here. Wait for it to finish,
  or stop it from that conversation." — recorded as the Last run (§15D
  behavioral pass). Real fire: window closed mid-run (hide-to-tray held,
  §15E), run completed in background in ~50s; the model picked issue #1
  (README typo), fixed it, tried to push, was **blocked by its own sandbox**,
  and the app's Phase 9 path then pushed and opened **PR #3** — bounded
  (PR, not push) exactly as designed. Branches panel shows the PR chip
  (#3) with Update PR / Merge; Usage dashboard rolls up honestly
  ($1.47 total across the whole run: CR $0.60 / DW $0.73 / RB $0.14).

## Findings (live run, 2026-08-18)

Journeys driven in the real app (Playwright Electron against the real profile,
live Claude/Codex/GitHub credentials, fresh DB, personas/skills from the
onboarding starter catalog). Log first, triage later — nothing here is fixed
mid-run. Severity: **blocking** (journey cannot proceed) / **degraded**
(works but misleads or looks broken) / **cosmetic**.

### F1 — `tokenState: locked` is discarded by the repo picker and onboarding (degraded)

- **Step:** Journey 1, New Contact → Bind a repo → GitHub tab.
- **Symptom:** picker shows "Couldn't load repositories — *Connect GitHub
  first to list your repositories*", while `auth.getStatus` simultaneously
  reported `github: { connected: true, login: 'stevevillardi', tokenState:
  'locked', error: 'This build can't unlock the stored GitHub credential (the
  app binary changed). Reconnect once to re-save it.' }`. The status layer
  (Phase 16/18) had the precise, actionable sentence; the picker replaced it
  with wrong advice ("connect first" — it *was* connected; the fix is
  *reconnect once*).
- **Also:** onboarding step 1 rendered a plain "GitHub — Connected as
  stevevillardi" with no hint of the locked state at the same moment.
- **Seam:** Phase 18's `locked` tokenState never propagated to Phase 6's
  NewContactFlow repo-picker error path (Phase 13 once fixed "repo picker
  discards main's error text" — this is the same class, one layer up) or to
  Phase 3/17's onboarding connect card. Pinned to code:
  `src/main/services/repos.ts:78` — `listRepos()` does `getGitHubToken()`
  and throws "Connect GitHub first…" when it returns null, but null there
  means *either* "no credential" *or* "credential exists and this build
  can't decrypt it" (`secrets.ts` tracks exactly this in its `unreadable`
  set, and `github-token-state.ts` carries the honest state). Same pattern
  at `pull-requests.ts:183`, so Journey 3's PR path would mislead the same
  way. The renderer shows main's error text faithfully — the wrong sentence
  is manufactured in main.
- **Caveat:** the locked state itself was provoked by the test harness
  (Playwright-launched Electron could not decrypt a credential saved by the
  `npm run dev` instance — cause not yet pinned down; possibly signature- or
  keychain-scope-related, worth understanding before trusting E2E-adjacent
  tooling with the real profile). But Phase 18 documents `locked` arising for
  real users on every rebuilt dev binary, so the surfaces that discard it are
  a real defect regardless.
- **Evidence:** `shots/08-repo-picker-error.png`, `auth.getStatus` capture.
- **Fixed** on `phase-11-demo-journeys`: both throws now route through
  `missingTokenError()` in `github-auth.ts`, which consults
  `secretUnreadable()` and single-sources the locked wording.

### F2 — first clone's workspace-root ask hides behind a "Cloning…" label (degraded)

- **Step:** Journey 1, New Contact → Confirm → Create, on a profile with no
  `workspace_root` yet (i.e. exactly the demo's fresh-install state).
- **Symptom:** the Create button flips to "Cloning…" and stays there
  indefinitely, while what is actually happening is
  `chooseWorkspaceRoot()` (`src/main/services/repos.ts:53`) waiting on a
  **native** open-directory dialog ("Choose where cloned repositories should
  go"). Nothing in the flow's own UI says a folder choice is pending; the
  confirm copy promises "creating the contact will clone it first" with no
  hint of the ask. If the native dialog opens behind the window, on another
  Space, or the presenter misses it, the flow reads as hung mid-demo.
- **Seam:** Phase 6's NewContactFlow button state vs the ask-on-first-use
  workspace-root design (Phase 6/17). The ask-once design itself is sound —
  the label lying about the current state is the defect. A "Choose where
  clones go…" state on the button (or asking *before* flipping to
  Cloning…) would fix it.
- **Evidence:** `shots/13-after-create.png` (dialog stuck on Cloning…),
  `workspace.getRoot` returning `{path: null}` at that moment.
- **Fixed** on `phase-11-demo-journeys`: the confirm step warns the ask is
  coming when the root is known-unset, and Create asks first — its own
  'Choosing a folder…' state, cancel returning to confirm untouched —
  before the clone starts. The mid-clone ask stays as the fallback.

### F3 — typing `@` in the Group composer gives no typeahead (cosmetic)

- **Step:** Journey 2, step 4. Typing `@Docs` into the group composer shows
  no completion; the affordances are the `@` icon button (a popover picker)
  and a red "Start with @ to choose who answers." hint. It works — the
  picker inserts the token, and a hand-typed `@Docs Writer ` parses — but
  every messaging app trains people to expect a popup at the `@` keystroke,
  and a demo audience will notice the dead beat. `parseMention`
  (`src/renderer/src/lib/mention.ts`) already matches names; wiring the
  existing `MentionPicker` popover to open on a draft-leading `@` would
  close the gap.

### F4 — `routine_run` group post claims the PR failed while the PR is open (degraded)

- **Step:** Journey 3, the real fire. The model (Codex, `workspace_write`)
  tried to `git push` itself, its OS sandbox blocked the network, and its
  end-of-run summary therefore says "A pull request could not be opened
  because network access prevented pushing." The app's own post-turn PR
  path (Phase 9) then pushed the branch and opened **PR #3** successfully —
  but the already-generated summary is what posted to the Group as
  `routine_run`. Anyone reading the Group is told the run failed to open a
  PR that exists.
- **Seam:** Phase 7's summarize() (model-visible state only) vs Phase 9's
  app-side PR step (runs after the turn). The summary is produced before
  the PR outcome exists and nothing amends it. Options at triage: append
  the PR outcome line to the `routine_run` content app-side (the app knows
  the PR number), or run the PR step before summarize().
- **Evidence:** `routine_run` group message vs `gh pr view 3`.
- **Fixed** on `phase-11-demo-journeys`: the scheduler amends the
  `routine_run` row with its own PR line via `appendToGroupMessage()`,
  re-announcing on the messages-changed chokepoint. The model's account is
  kept; the app's outcome lands after it.

### F5 — a model switching branches inside its worktree breaks branch bookkeeping (degraded)

- **Step:** Journey 3. The routine's model created and checked out
  `fix/readme-typo-receive` *inside* its own worktree (reasonable, given
  the prompt said "fix it on a branch"), then committed there. Nothing
  reconciles the Contact's registered branch after a turn, so:
  - The Branches panel shows only the stale `persona/refactor-buddy-0742`,
    labeled "checkout removed" (`hasWorktree` false — true, the worktree
    HEAD moved), while the branch the PR actually ships —
    `fix/readme-typo-receive`, the worktree's real HEAD — is listed nowhere.
  - The PR opened from the worktree's current branch (correct content) but
    its **title** was built from the stale registered branch name and even
    carries a literal truncation ellipsis: "…changes on persona/refactor-…".
  - The group summary/branch stamps say `persona/refactor-buddy-0742` while
    the commits live on the other branch.
  - The Merge button on the stale row would merge `persona/refactor-buddy-0742`
    (`cad9975`) — **missing the newest commit** (`89f02fb`) that PR #3 contains.
- **Seam:** Phase 12's worktree/branch registration assumes the persona
  stays on its assigned branch; nothing tells the model that, and nothing
  re-reads the worktree HEAD after a turn. Candidate fixes at triage:
  instruct the persona to stay on its branch (context injection), and/or
  reconcile `contacts.branch` to the worktree HEAD at turn end, and derive
  PR titles from the branch actually pushed.
- **Evidence:** `git worktree list` showing the worktree on
  `fix/readme-typo-receive`, Branches panel screenshot
  (`shots/31-branch-detail.png`), PR #3 title/head mismatch.

### F6 — model-failure copy is a leaked vendor string, and the bubble isn't visibly an error (degraded)

- **Step:** §15C provocation — Docs Writer's model set to
  `claude-nonexistent-model` (the field is deliberately free text), one
  message sent.
- **Symptom:** the failure did render in-thread (§15C's core demand holds —
  nothing was silent), but the copy is the Claude Code CLI's own sentence:
  "There's an issue with the selected model (claude-nonexistent-model). It
  may not exist or you may not have access to it. **Run --model to pick a
  different model.**" There is no `--model` anywhere in this app; the real
  remedy is the persona's Model picker. Visually the message is a plain
  gray bubble — indistinguishable at a glance from a normal assistant
  reply, where §15C specifies a *distinct error-type* bubble. No retry
  affordance was visible on it either (Phase 21 added retry for failed
  turns — check at triage whether this error class takes that path).
- **Seam:** Phase 17 fixed exactly this shape for dead resume keys ("a raw
  vendor string" reworded, self-heal added); the unknown-model error never
  got the same treatment. Phase 6's error-bubble styling may also not be
  applied on this path.
- **Evidence:** `shots/33-error-bubble.png`.
- **Fixed** on `phase-11-demo-journeys`: the adapter now reads `is_error`
  on success results and yields an error event, which puts the existing
  §15C error bubble and Phase 21 retry in front of it with no renderer
  change; the known unknown-model sentence is reworded to name the
  persona's model picker, anything else passes through untouched.

### F7 — a finished turn can stay rendered as "working…" in the Group view until app restart (degraded)

- **Step:** noticed after Journey 3 — the Group thread still showed Refactor
  Buddy's 14:39 doc-comment turn as a live "working…" block (avatar, tool
  calls, spinner) at ~14:50, long after the turn completed and its DECISION
  summary posted.
- **Diagnosis so far:** it is **not** persisted state — `runs.list` returns
  `[]`, every persisted tool call for the contact is terminal
  (completed/failed), and navigating away and back re-renders the same stale
  block, but **an app restart clears it**. So a renderer (or main-side
  push-channel) in-memory registry of live group turns missed/dropped this
  turn's terminal event and nothing reconciles it against `runs.list`.
  Timing hint: the turn ended while a different screen was focused and
  the window was closed to tray shortly after — a lifecycle window where a
  `done` push could be missed.
- **Seam:** Phase 6/7's streaming push channel vs Phase 20's
  window-closed/background era: the live-turn store trusts the event stream
  alone; a dropped terminal event has no fallback sweep (Phase 21's boot
  sweep covers *crash-orphaned tool calls*, not in-session stream state).
- **Why it matters for the demo:** a "working…" spinner that never resolves
  reads as a hang, in the exact screen the Journey 2 demo lingers on.
- **Evidence:** `shots/35-dark-group.png` (stale block),
  `shots/36-group-after-restart.png` (cleared), `runs.list` + tool-call
  status dumps in the run transcript.

### O1 — session summaries run on a different model than the persona (observation — resolved, deliberate)

- Refactor Buddy is pinned to `gpt-5.4-mini`, but its end-of-session
  summary was billed to `gpt-5.6-luna`; Claude personas' summaries run on
  `claude-haiku-4-5`. **Resolved at triage by reading
  `SUMMARY_MODELS` (`src/main/adapters/models.ts`): both choices are
  deliberate cheap-summarizer picks.** `gpt-5.6-luna` is the *cheapest*
  entry the price table knows (0.20/1.20 per 1M — it took over from
  gpt-5.4-mini on 2026-08-17 precisely because it is 3.75× cheaper), and
  the comment already names the quality risk to watch. The live run's
  numbers agree ($0.0025 for the summary). No change needed.
