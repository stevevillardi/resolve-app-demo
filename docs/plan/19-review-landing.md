# Phase 19 — Review & Landing

**Status:** In progress
**Origin:** The 2026-08-17 workflow review ("The Missing Half of the Loop"), Theme A — the
app delivers *delegate → watch* and has no surface for *review → land*. Six items, built
together because they share one data spine: what a turn or a branch actually changed.

## Goal

A developer can see the work inside the app and land it inside the app. Concretely:

1. **A1 — Diff viewer.** `BranchDetail` renders per-file diffs (Monaco's diff editor,
   read-only) instead of a filename list. The merge decision stops being blind.
2. **A6 — Turns say what they changed.** Each assistant message that changed the tree
   carries a work record (branch, head before/after, committed + newly-dirty files),
   rendered as chips; clicking opens the per-turn diff.
3. **A5 — Tool calls can be inspected.** The persisted tool record gains the bounded
   `detail` and result `output` the live stream already shows; rows expand on click.
4. **A3 — The merge loop closes.** A branch knows whether it is merged
   (`merge-base --is-ancestor`); merging or discarding stamps the matching
   `branch_request` rows resolved; Home's "waiting" count excludes merged branches.
5. **A4 — Commit affordance.** A branch whose worktree holds uncommitted work gets a
   human-clicked "Commit work…" — author is the persona, committer is the user. The app
   still never commits *unattended*; see the decision below.
6. **A2 — Open / reveal.** `shell.openPath` / `shell.revealPath`, validated against known
   roots (bound repos + the worktree root), with buttons where the paths appear.

## Decisions (recorded in 00-progress.md when the phase closes)

- **Tool detail/output persistence reverses doc-15 item 1.** That item chose
  name-and-status-only "never arguments". The workflow review made the cost visible: the
  morning after an MCP routine, "what did it write" has no answer. Bounded excerpts
  (detail ≤ 500 chars, output ≤ 4,000) are persisted; the columns are nullable and the
  bound lives in one place.
- **The app now authors commits, but only human-clicked ones.** Phase 9's "the first
  commit this app ever authors should not be an unattended one" stands — routine and
  turn paths still never commit. The new path is a button a person presses, with the
  persona as `--author` so `git log` attributes the work truthfully.
- **Diff content is served whole, with stated budgets.** Per file 300 KB, per response
  3 MB; beyond that a file is marked `truncated` and served without text. Binary files
  are detected via `--numstat`'s `-` marker and never served as text.
- **Three-dot semantics via an explicit merge-base.** The pair shown is
  `merge-base(HEAD, branch)` → `branch`, matching `changedFiles`' three-dot question
  ("what did this branch do"), not "how does it differ from base right now".

## Live checks already run

Verified against a real scratch repo + worktree before any code (2026-08-17):
`--name-status -M` rename format (`R100\told\tnew`), `--numstat`'s `-\t-` binary marker,
`git show rev:path` for added/deleted sides (clean 128 on the missing side),
`merge-base --is-ancestor` exit codes flipping on merge, worktree commits with
`--author` keeping the user as committer.

## Testable scope

- Real-git suites for the new plumbing (diff name-status parsing, binary detection,
  file-at-rev with the size cap, is-ancestor, commitAll authorship) — same pattern as
  `git-worktree.test.ts`.
- Turn-work capture: committed, dirty, and nothing-happened cases against a real repo.
- Branch service: `merged` flag, `dirtyFiles`, commit refusals (no worktree, active
  run), branch_request resolution stamping (`createTestDb`).
- Adapter fixtures updated for `tool_end.output` from captured shapes.
- Renderer: pure helpers (`languageForPath`, diff assembly for the panel) in `lib/`.

## Acceptance checks

- [ ] A branch's diff renders per file with old/new panes, renames and binaries handled,
      in both themes; the merge flow is unchanged around it.
- [ ] A turn that edits files shows chips; clicking shows that turn's diff; a read-only
      persona's turns show none.
- [ ] A persisted tool row expands to its detail/output; a live one matches.
- [ ] Merging a requested branch resolves its `branch_request` in the group thread, and
      the branch row reads merged; Home stops counting it.
- [ ] "Commit work…" commits with persona author / user committer and refreshes the
      panel; it is absent for orphan branches and refused while a run is active.
- [ ] Open folder / reveal works from thread and branch surfaces; a path outside known
      roots is refused.
- [ ] `npm test`, `npm run build`, and the E2E suite pass; `npm run screens` reshoots
      clean.
