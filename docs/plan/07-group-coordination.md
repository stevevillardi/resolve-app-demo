# Phase 7 — Group Coordination

**Status:** In progress — built and unit/E2E-verified; live Journey 2 outstanding
**Blueprint refs:** §6 (shared context and compaction), §8 (@mention/Group behavior), §15D (concurrency lock), §16 Journey 2
**Depends on:** Phase 6 (core messaging — real sessions to summarize and route to)

## Goal

Make the Group layer real: end-of-session structured summaries posting as `system_summary`, durable decision/tradeoff entries injected into future sessions on that repo, and live @mention routing to a Contact's real session from within the Group thread. This is blueprint §16 Journey 2 — "proves this is coordinated, not three parallel chatbots."

## Scope

1. **Compaction (blueprint §6)**
   - At session end (after each `AgentAdapter.run()` completes, not just on explicit "close"), request a structured summary from the model: `{ summary: string, category: "decision" | "tradeoff" | "routine" }`, schema-enforced via Zod + the SDK's structured-output support (both backends claim to support this per blueprint §3 — confirm during implementation).
   - `decision` / `tradeoff` → `durable: true`, `routine` → `durable: false`.
   - Persist as a `GroupMessage` with `type: "system_summary"` on the repo's Group.
   - **Leave room for branch metadata.** Once `12-worktree-isolation.md` lands,
     this summary is how the rest of the repo finds out a writer produced work
     on a branch nobody can see on disk — the Group becomes the awareness
     channel for branch state. Adding an optional `branch` (and later `needs`)
     to the structured output is cheap now and awkward retrofitted.

2. **Context injection of durable/recent entries (blueprint §5)**
   - On session start (or resume), inject the last N `durable` GroupMessages for that repo plus the last N `routine`-category ones into the session's context, on top of the persona's own system prompt/skills (Phase 5's context injection).
   - Make N configurable (even if just a constant for now) since blueprint §14 flags retention tuning as an open question — leave a clear seam for this to become smarter later without a redesign.

3. **`GroupThreadView` goes live**
   - Replace Phase 2's mock data with real `GroupMessage` rows.
   - Render all four types correctly with real data now, not fixtures.

4. **@mention routing (blueprint §8)**
   - `MentionPicker` (`cmdk`-based, shell from Phase 2) filtered to real Contacts bound to that repo.
   - Selecting a Contact and sending routes to that Contact's real session via the same `AgentAdapter.run()` from Phase 5/6 — reply streams back as `agent_reply` in the Group thread, using the same live-streaming mechanism as `ThreadView`.
   - **v1: single-target only** — no broadcast. Enforce this in the picker (single-select, not multi).
   - 1:1 threads and the Group thread must render from the same underlying session/message state — no duplicated storage of the same conversation.

5. **Concurrency lock — extend to @mentions (blueprint §15D, as narrowed in Phase 6)**

   **Read `00-progress.md`'s entry on this before assuming §15D's wording.** Phase 6
   deliberately did not build the `repoPath → busy` map §15D describes. The lock
   is a *write* lock keyed on the working path: `read_only` personas take a
   shared hold and are never refused, and only writer-vs-writer serializes.

   - An @mention-triggered run acquires through the same
     `acquire()` / `lockModeFor()` / `workingPathFor()` in
     `src/main/services/run-lock.ts` that a 1:1 message uses. There is nothing
     to extend in the lock itself — the work is routing the refusal into the
     Group thread's UI rather than the composer's.
   - So an @mentioned **reader** is never blocked, which is what makes Journey 2
     work as scripted: Refactor Buddy (`workspace_write`) and Code Reviewer
     (`read_only`) run against one repo *concurrently*, with no worktrees
     involved. Journey 2 does not need `12-worktree-isolation.md`.
   - What still serializes is two writers. If that becomes the limiting factor
     here rather than in Phase 8, pull the worktree phase forward.

## Explicitly out of scope

- Routine-triggered `routine_run` messages (Phase 8) — the `GroupMessage` type exists and renders, but nothing produces it yet.
- Broadcast @mentions — deliberately cut per blueprint §13.

## Acceptance checks

- [ ] Blueprint §16 Journey 2 runs live: "Refactor Buddy" (`workspace_write`) makes a change and states a rationale; its structured summary posts to the Group as a durable `system_summary`; opening "Code Reviewer" scoped to the same repo shows it referencing the refactor without being told manually; @mentioning a third persona from the Group thread gets a live routed reply. — **outstanding, needs real credentials**
- [x] `decision`/`tradeoff` summaries persist indefinitely and are always injected; `routine`-category summaries only show the most recent N but remain queryable in SQLite. — `contextForRepo()` runs two queries rather than one precisely so routine chatter cannot bury the decision log; pinned by `group-messages.test.ts`.
- [x] An @mentioned `read_only` Contact runs while a writer holds the same repo. — **This did not hold when the phase started**: the shipped lock refused it. See Step 1 below; now covered by `messaging.test.ts` and `run-lock.test.ts`.
- [x] Two _writing_ Contacts on one repo serialize, with the refusal visible in the Group thread rather than only in a log. — `groups.mention` throws through IPC and the Group composer renders it via `Composer.notice` + `ipcErrorMessage`, the same path `ThreadView` uses. Nothing is written on refusal.
- [x] 1:1 thread and Group thread both reflect the exact same message when a Contact replies via @mention (no divergent copies). — falls out of `useRunStore` being contact-keyed; asserted in `messaging.test.ts` ("lands the same reply in both threads").

## Found while building

- **A Phase 6 lock defect that this phase's third acceptance check depended on.**
  `blockingHolder` refused a `shared` acquire whenever an exclusive holder existed, so a
  reader could not *start* while a writer held the path. Four documents said the opposite,
  and three tests asserted the code rather than the claim — including one titled
  `lets a reader run while a writer holds the repo` that asserted the writer was refused,
  and one titled `lets a reader and a writer run together` that asserted neither could join
  the other. Fixed, and the tests rewritten from the claim.
- **Structured output differs enough between the two SDKs to change the design.** Claude's
  `outputFormat` is session-level and its structured turns carry a *placeholder* in the field
  `run()` treats as authoritative; Codex's `outputSchema` is per-turn and returns JSON where
  prose would go. Hence `summarize()` beside `run()` rather than an option on it. Full detail
  in `00-progress.md`.
- **`usage_events.source` needed no migration to widen** — the enum was never a database
  constraint.
- **Fixture provenance gap, deliberately left open.** The `summarize()` tests are built from
  the vendored SDKs' typings, not from captured live runs, which is weaker than this repo's
  standing rule. `npm run probe:structured -- --backend <b> --raw` is what closes it, and the
  tests say so at the top of each block.
