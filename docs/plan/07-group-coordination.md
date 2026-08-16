# Phase 7 — Group Coordination

**Status:** Not started
**Blueprint refs:** §6 (shared context and compaction), §8 (@mention/Group behavior), §15D (concurrency lock), §16 Journey 2
**Depends on:** Phase 6 (core messaging — real sessions to summarize and route to)

## Goal

Make the Group layer real: end-of-session structured summaries posting as `system_summary`, durable decision/tradeoff entries injected into future sessions on that repo, and live @mention routing to a Contact's real session from within the Group thread. This is blueprint §16 Journey 2 — "proves this is coordinated, not three parallel chatbots."

## Scope

1. **Compaction (blueprint §6)**
   - At session end (after each `AgentAdapter.run()` completes, not just on explicit "close"), request a structured summary from the model: `{ summary: string, category: "decision" | "tradeoff" | "routine" }`, schema-enforced via Zod + the SDK's structured-output support (both backends claim to support this per blueprint §3 — confirm during implementation).
   - `decision` / `tradeoff` → `durable: true`, `routine` → `durable: false`.
   - Persist as a `GroupMessage` with `type: "system_summary"` on the repo's Group.

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

5. **Concurrency lock, full version (blueprint §15D)**
   - Extend Phase 6's `repoPath → busy` map to also gate @mention-triggered runs, not just direct 1:1 messages — an @mention firing while that Contact (or any Contact on that repo, per the soft single-session-per-repo rule) is already busy should queue or be rejected with a clear UI signal, not silently race.

## Explicitly out of scope

- Routine-triggered `routine_run` messages (Phase 8) — the `GroupMessage` type exists and renders, but nothing produces it yet.
- Broadcast @mentions — deliberately cut per blueprint §13.

## Acceptance checks

- [ ] Blueprint §16 Journey 2 runs live: "Refactor Buddy" (`workspace_write`) makes a change and states a rationale; its structured summary posts to the Group as a durable `system_summary`; opening "Code Reviewer" scoped to the same repo shows it referencing the refactor without being told manually; @mentioning a third persona from the Group thread gets a live routed reply.
- [ ] `decision`/`tradeoff` summaries persist indefinitely and are always injected; `routine`-category summaries only show the most recent N but remain queryable in SQLite.
- [ ] Two Contacts cannot run simultaneously against the same repo — verified by triggering an @mention while a 1:1 session on that repo is mid-stream.
- [ ] 1:1 thread and Group thread both reflect the exact same message when a Contact replies via @mention (no divergent copies).
