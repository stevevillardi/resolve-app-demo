# Phase 22 — Sessions & Cost

**Status:** Done
**Origin:** The 2026-08-17 workflow review ("The Missing Half of the Loop"), §D — and
the last of its three _systemic_ findings to be closed. §1 "the app can't show the
work" became Phase 19; §2 "the unattended story has no delivery and no brakes" became
Phase 20; this is §3, "the forever-thread collides with session economics".

The tension is real and this repo measured it before the review did: three one-word
Codex turns went 12,122 → 25,610 → 39,114 cumulative input tokens (Phase 6/7
close-out). A thread you can scroll through forever sits on a session that both fills
up and re-bills its whole history every turn, and nothing on screen said so. The one
remedy — a fresh session — existed since Phase 6 and was reachable only as a side
effect of changing persona.

## Scope

Two defects first, then the three review items. Eleven commits.

- **F1** — the composer's busy check, wrong in three directions.
- **F2** — three destructive paths with no in-flight guard.
- **D1** — session controls: a divider, a fresh-session action, a context meter.
- **D2** — isolation mutable on a live contact; recreate adopts the conversation.
- **D3** — a per-contact model override.

**User decisions taken during planning:** the context meter gets a real per-model
window table (reversing a recorded stance); the fraction is marked `≈` rather than
shown bare or withheld; recreate adopts the thread; D3 stays in scope; the
SDK-reported window is **not** read (table only, no migration on `usage_events`).

## Decisions (recorded in 00-progress.md)

- **The meter shows a fraction now, and the denominator is written down.**
- **A message is stamped with the session that _answered_ it, at turn end.**
- **Isolation is mutable; `repoPath` is not; `branch` outlives `worktree_path`.**
- **Recreate adopts the conversation rather than orphaning it.**
- **`contextTokens` returned the bill and called it the prompt.**

## What was built

1. **F1 — one definition of who the lock refuses.** `workingPathFor`, `lockModeFor`
   and the refusal wording moved to `src/shared/locking.ts`, with `blockingRun` as
   the pure rule; `run-lock.ts` keeps the state and applies it. The renderer was
   barred from `src/main`, which is the only reason the rule was ever written twice.
   Three bugs, not the review's two — it also ignored _this_ contact's mode, so a
   `read_only` contact refused by nobody had its composer disabled whenever anything
   touched the repo. That is the reviewer-plus-writer pair Journey 2 runs together.
2. **F2 — `assertNoActiveRun`.** Applied to `deleteContact`, `clearAppData`, and
   `updatePersonaTemplate`'s backend switch specifically. Narrow on purpose: every
   other persona field is read when a turn starts, so editing one mid-turn applies
   from the next.
3. **Migration 0018 + the session stamp.** `messages.session_id`, written at turn end
   for both rows of the turn.
4. **The divider.** `sessionBoundaries` in `lib/session.ts`, `SessionSeparator` in the
   muted register, plus `awaitingFreshSession` for the pending case.
5. **`contacts.startFreshSession`.** `clearBackendSessionId` finally gets an IPC
   caller.
6. **`src/shared/context-windows.ts`.** Dated, per-row `published` / `inferred`, two
   lookups and then null.
7. **The meter.** `contextTokens` split into `lastPromptTokens` / `billedInputTokens`,
   `contextFill` beside it, `ContextMeter` in the thread header.
8. **`contacts.setIsolation`.** Both directions, guarded, worktree removed on the way
   out with `deleteContact`'s dirty-tree posture.
9. **`contacts.recreate`.** One procedure replacing the renderer's create-then-delete.
10. **Migration 0019 + `contacts.setModel`.**

## Deferred, deliberately

Reading `ModelUsage.contextWindow` from the Claude SDK (verified present and free —
`sdk.d.ts:1274`, and the captured fixture in `claude.test.ts:69` has carried
`contextWindow: 200000` since Phase 5). It would make Claude's denominator a
measurement rather than a transcription, at the cost of a second migration and
changes to both adapters, `shared/agent.ts`, the domain schema and the mapper. **Cut
by user decision**; recorded here so a later phase picks it up knowing the field is
there. Its absence is why the meter reads `≈` on _both_ backends rather than only on
Codex — with a table on both sides, neither numerator is a per-request figure.

Also deferred: a per-_turn_ model choice ("use the big model for this one"), which
needs a composer control, a per-turn spec override, and a story for what the resumed
session's model was; repo mutability, whose remedy is still delete-and-recreate — now
without losing the conversation; and any _enforcement_ on the meter, which reports
and never blocks.

## Verification

- 1,689 unit tests green (`npm test`); gated `npm run build` green.
- Playwright e2e: **77 passed**, including the new `e2e/sessions.spec.ts` — the
  divider over a staged two-session thread, the meter at ≈25% of 200k, the
  fresh-session dialog clearing the key with every message still on screen, the meter
  vanishing with the session, isolation moving the row into a worktree, and a contact
  model overriding its persona's without touching the persona.
- Screens sweep, both themes, both widths, eyeballed. `showcase.ts` gained a matching
  resume key and a mid-thread session change, without which the sweep photographed a
  meter with nothing to measure and a thread announcing a fresh session nobody asked
  for — both correct readings of that profile, neither the state under review.
- Mutation-checked, six of them: dropping the shared-request guard fails the
  reader-typeable case; dropping the path comparison fails the isolated-writer case;
  removing each of the three F2 guards fails only its own test; letting a null session
  id count as its own session fails the two upgrade cases; dividing the bill instead
  of the last prompt fails the Codex fill case; deleting a `CONTEXT_WINDOWS` row fails
  the drift check by name.
- The FTS tripwire in `upgrade.test.ts` was itself verified by dropping a trigger
  against a real FTS5 table: the write goes unindexed and the count falls to 0, so the
  assertion would catch a `messages` rebuild.
