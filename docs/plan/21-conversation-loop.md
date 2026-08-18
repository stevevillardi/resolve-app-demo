# Phase 21 — Conversation Loop

**Status:** Done
**Origin:** The 2026-08-17 workflow review ("The Missing Half of the Loop"), §B — the
conversation surface works beautifully until something goes wrong or scale arrives,
and then it strands the user. A failed turn rendered its error and offered nothing
(the retry button existed in `MessageBubble`, wired by nobody). A repo-lock refusal
destroyed the draft it was refusing. No attachments, no message search, no timeout on
a wedged turn holding the write lock, no reconciliation after a crash, and streamed
reasoning — the only sign of life on a long tool turn — dropped on the floor.

## Scope

Seven review items. User decisions: **B3 is `@file` path autocomplete only** (image
paste deferred); **B2 is draft preservation only** (the opt-in "send when free" queue
deferred); **B8** (edit / regenerate / fork) stays deferred per the review's own call.

1. **B1 — Retry.** `messages.retry` re-runs the thread's tail user message; both the
   live error bubble and a durable "interrupted" notice offer it.
2. **B2 — Drafts survive refusals.** The composer clears only on an accepted send,
   drafts live in a per-conversation store, and thread views are keyed so state
   stops bleeding across conversations.
3. **B3 — `@file` autocomplete** over the contact's working tree, caret-anchored,
   inserting the bare relative path as literal text.
4. **B4 — Full-text search** (FTS5, migration 0017) surfaced as a Messages section
   in ⌘K.
5. **B5 — Inactivity watchdog.** Ten minutes of silence aborts the turn through the
   existing controller, with wording that survives the adapter's abort noise.
6. **B6 — Crash reconciliation.** A synchronous boot sweep marks orphaned
   `running` tool calls failed; the unanswered-tail notice covers the stranded
   question.
7. **B7 — Reasoning disclosure.** A collapsed "Thinking…" `<details>` on the
   streaming bubble; live-only, Codex-only by nature.

## Decisions (recorded in 00-progress.md)

- **Retry reuses the persisted user message — no new row, no new `user_mention`.**
  The original send persisted both before the turn ran; a re-send would duplicate
  them into history, previews, unread counts, and compaction input. Origin derives
  from the surface retried from (`groupId` present ⇒ mention), because `Run.origin`
  dies with the process. Accepted limitation: a crashed mention retried from the 1:1
  thread answers in the 1:1 thread.
- **B1/B6 unify on a renderer-computed unanswered tail; nothing persists error
  state.** Last message is the user's + no run in the store + none in main's active
  set ⇒ interrupted notice. Persisting failure was rejected: it needs a migration
  and a policy for user Stop (which sets both `failure` and `aborted` — durably
  labelling deliberate stops as failures). The group variant recovers its retry
  target from the mention's durable side effect — the member whose own thread holds
  the unanswered row — because `user_mention` rows record neither target nor token.
- **The watchdog measures silence, not duration.** A thorough turn can run half an
  hour emitting tool events; a stalled one goes quiet. It records `failure` and
  emits its error event _before_ aborting, and a `timedOut` guard keeps the
  adapters' SIGTERM-shaped teardown from overwriting the wording — asserted from
  the claim (final wording), not the flag. Ten minutes, exported constant, no
  Settings surface (pre-release; one number).
- **The boot sweep is synchronous, before `setupIpc()`.** At boot the run registry
  is empty by construction, so every `running` tool row is dead. Unbilled crash
  spend stays unrecorded — both SDKs report usage only at turn end, so there is
  nothing durable to recover; the usage dashboard undercounts killed turns.
- **FTS is external-content FTS5 + triggers, unicode61.** Triggers, not the insert
  chokepoints, because contact deletion cascades messages without passing through
  `insertMessage` — and the cascade-fires-triggers assumption is pinned by an
  executing test. UPDATE triggers are defensive (B8 deferred, not dead).
  `buildMatchQuery` quotes every term (FTS5 syntax is unrepresentable as an error);
  snippet markers are ``/`` because printable markers collide with code.
  The snapshot for 0017 is 0016's schema body re-chained — virtual tables are
  invisible to drizzle-kit.
- **`@file` inserts literal text.** The path is just prompt text, persisted and sent
  verbatim — `startTurn`'s no-rewriting invariant holds, and both SDKs read files
  themselves. Ranking is basename-first (people type suffixes), a deliberate
  departure from `scoreCommand`'s label/detail tiers. Groups complete against the
  _mentioned_ contact's tree, only once a mention resolves.
- **Composer drafts clear on success, never restore on error** (a restore would
  clobber text typed while the IPC was in flight), live in a RAM-only
  `useDraftStore` (a resurrected week-old draft would surprise more than help), and
  the thread views gained `key={id}` — the draft-bleed bug was one instance serving
  every conversation.

## Deferred, deliberately

B8 (edit/regenerate/fork — session-forking against vendor SDKs), image paste (needs
per-backend vision capability flags), the "send when free" queue, a Chats-filter
search surface (⌘K is the one search surface), a watchdog Settings control, and the
pre-existing duplicate lock-refusal wording (main's vs ThreadView's) — flagged here
so it isn't rediscovered as new.

## Verification

- 1,582 unit tests green (`npm test`); gated `npm run build` green.
- Playwright e2e: 63 passed, including the new `conversation-loop.spec.ts` —
  draft survival across a conversation switch, `@file` picker inserting the bare
  path, the boot sweep reconciling a staged orphan, the interrupted notice + Retry
  rendering over a staged unanswered tail, and ⌘K message search landing in the
  right thread. Retry is rendered, not clicked (a real turn spawns a real SDK);
  lock-refusal draft preservation needs a live blocking run and is pinned at the
  unit layer instead.
- Screens sweep, both themes, eyeballed.
