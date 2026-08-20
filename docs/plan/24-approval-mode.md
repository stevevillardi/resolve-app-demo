# Phase 24 — Approval Mode

**Status:** Done
**Origin:** The 2026-08-17 workflow review ("The Missing Half of the Loop"), §E1 — the
last open fix area. Blueprint §15B decided sandbox-at-creation _is_ the approval, and
for v1 that was defensible. But the tools this app's users already run have normalized
per-action asks, and the all-or-nothing choice forces over-granting: a developer who
mostly wants read-only but occasionally wants one approved write had no home here. The
review called it what it is — a deliberate v2 governance change, not a quick win.

## Scope

One posture, end to end: a fourth `SandboxLevel`, **`ask_writes`**, that reads as
freely as `read_only` and holds every write for an approve/deny decision **in the
thread** — a message-shaped question, fitting the metaphor — instead of refusing it.

1. **The classifier** (`sandbox.ts`). `SandboxDecision` gains an `ask` marker.
   At `ask_writes`, the `read_only` command allowlist is reused as the line between
   "runs freely" and "waits for a human"; `Write`/`Edit`/`MultiEdit`/`NotebookEdit`
   inside the repo ask too. What was denied at `workspace_write` stays denied —
   writes outside the repo boundary, `dangerouslyDisableSandbox` — because approval
   widens _when_ a write may happen, never _where_. The GitHub axis is untouched.
2. **The Claude translation.** `ask_writes` gets the write grants of
   `workspace_write` under the permission mode of `read_only`: `permissionMode:
'default'` keeps `canUseTool` in the path for every write (where `acceptEdits`
   would auto-approve the file tools), and the OS sandbox already allows the write
   so a human's yes is sufficient. The write tools stay in context — "you may ask"
   is the point.
3. **The pause itself.** `canUseTool` is an async callback the SDK awaits, so the
   hold is just a promise: the adapter calls an injected
   `AdapterConfig.onApprovalRequest` and returns allow or deny from its answer.
   No handler (a probe run) fails closed.
4. **The registry** (`services/approvals.ts`). Pending asks live in memory keyed by
   run; they ride on `runs.list` as `ActiveRun.approval` and announce themselves
   with the existing `runs-changed` push, so the card costs no new channel,
   survives a renderer reload, and appears for turns nobody started from a thread —
   a routine's ask is exactly the one that must not be invisible. Every ask
   auto-denies after five minutes (`APPROVAL_TIMEOUT_MS`), deliberately under the
   Phase 21 watchdog's ten, so a held ask can never read as backend silence or
   wedge the write lock. The turn teardown denies whatever was left unanswered.
5. **The surfaces.** An `ApprovalPrompt` card in both thread views (the group card
   names the member), answered over `runs.resolveApproval`; a stale click resolves
   `false` and the refetch removes the card. An OS notification when the window is
   unattended, clicking through to the contact's thread. A `## Writes need
approval` block in the stable prefix tells the model to batch writes and treat
   a refusal as a decision, not a flaky tool. `ScopeChip` gains the `ask_writes`
   descriptor; both persona editors offer "Ask to write".
6. **The honest exclusion.** Claude-only. Codex's `codex exec` channel has no
   approval-request event and no way to deliver an answer mid-turn
   (`approval_policy` only reaches the CLI as `--config`, which exec mode has
   nobody to ask). `askBeforeWritesSupported()` in `shared/domain.ts` is the one
   statement of that fact: the editors filter the option out on Codex (and fall
   back to `read_only` on a backend switch), validation refuses the pairing at
   both doorways (Zod refinement + service), and `codexSandboxMode('ask_writes')`
   maps to `read-only` so even an impossible row fails toward the posture's
   promise.

## Deliberately not in scope

- **Remembered allowlists** ("always allow `npm test`"). The v1 ask is per-action;
  a remembered grant is durable persona state with UI to review and revoke it —
  real scope, recorded as a natural follow-on, not started here.
- **Persisted approval history.** The card is live-only, like error bubbles and
  the streaming timeline; the durable record is the tool-call row an approved
  write produces and the model's own account of a refusal. Same treatment as
  doc 15 item 1 before Phase 19 widened it.
- **Codex support** via the app-server/MCP channel. Possible in principle; a
  different process model from the exec-per-turn shape both adapters share.

## Acceptance

- `sandbox.test.ts`: at `ask_writes` reads pass without asking, everything else
  asks with the act named in the reason, boundary and sandbox-disable stay hard
  denies, and the Claude/Codex translations are pinned.
- `approvals.test.ts`: the held promise settles on the human's answer, the
  timeout's, or the teardown's — exactly one, exactly once; stale and cross-run
  clicks are refused; both ends emit `runs-changed`.
- `messaging.test.ts`: an ask raised by the adapter mid-turn is keyed to that
  run, visible on `runs.list`, answerable, and denied by the teardown if the
  turn ends first — asserted against the real `startTurn`/`finish`, scripted
  backend only.
- `persona-templates.test.ts` / `context.test.ts`: the Codex pairing is refused
  at create and update; the prefix block appears for `ask_writes` only.
- Live: `npm run probe:adapters -- --backend claude --sandbox ask_writes
--approve-writes` drives the real SDK through an approved write; without the
  flag the same probe exercises the fail-closed deny. **Measured 2026-08-18**,
  both directions: the approved `Write` executed and the file landed; the
  handler-less run refused with the fail-closed sentence, no file was created,
  and the model — reading the prefix block — reported the refusal, said what it
  would have done, and did not retry. The result-time denial surfaced with the
  ask-mode wording ("Write was not approved"), not the sandbox one.
