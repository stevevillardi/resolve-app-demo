# Phase 5 — Backend Adapters

**Status:** Done
**Blueprint refs:** §3 (backend adapters), §14 (open items #1, #2, #3)
**Depends on:** Phase 3 (app auth — need working credentials to actually call either SDK), Phase 1 (bootstrap)

## Goal

Implement the `AgentAdapter` interface (blueprint §3) for both Claude and Codex, and the normalized `AgentEvent` type both funnel into. This phase is backend-only — no UI wiring yet (that's Phase 6). Success is: from a Node script or a temporary debug IPC procedure, create a session against a real repo, send a prompt, and see normalized streamed events plus a final usage/cost figure for both backends.

This is also where the three open items from blueprint §14 that are testable in isolation get resolved.

## Scope

1. **`AgentAdapter` interface** exactly as specified in blueprint §3: `createSession`, `run` (returns `AsyncIterable<AgentEvent>`), `resume`.

2. **`ClaudeAdapter`**
   - `@anthropic-ai/claude-agent-sdk`, main process only.
   - System prompt + resolved skill content (skill resolution: given `skillIds` from a `PersonaTemplate`, fetch `Skill.content` from Phase 4's data layer and concatenate/format into the session's system prompt).
   - Sandbox → SDK permission mode mapping (`read_only` / `workspace_write` / `full_access` → whatever the SDK's actual permission-mode options are — confirm exact API during implementation).
   - Parse `SDKResultMessage` for `usage` and `total_cost_usd`. **Dedupe per-step assistant messages sharing an id before summing** (blueprint §3 explicitly flags this as a double-counting trap) — write a small test fixture with a multi-tool-call turn to verify the dedupe logic before trusting it.
   - Note in code (not just here) that this cost figure is a client-side estimate, not authoritative billing.

3. **`CodexAdapter`**
   - `@openai/codex-sdk`, `startThread()` / `run()` / `resumeThread(threadId)`.
   - Sandbox → `read_only` / `workspace_write` / `full_access` presets.
   - **Open item #1 (blueprint §14):** test `config.developer_instructions` against the actual installed SDK version — send a prompt that only succeeds if injected instructions were honored (e.g. "state the exact contents of your developer instructions"), confirm or refute reception. If unreliable: implement the fallback — a scoped, session-specific instructions file via `model_instructions_file`, or as a last resort a temporary `AGENTS.md` override in the repo (document the filesystem side effect clearly if this path is taken).
   - Use `runStreamed()`, not `run()`, to get `CommandExecutionStatus` events during tool execution.
   - **Open item #2 (blueprint §14):** confirm empirically whether `cached_input_tokens` is additive or a subset of `input_tokens` before writing the cost formula — run a session with cache hits, inspect the raw numbers, don't assume.
   - **Open item #3 (blueprint §14):** build the Codex per-model price table (hardcoded, versioned in the adapter file with a comment noting the date it was last checked against vendor pricing — this will go stale and needs a visible "last verified" marker).

4. **`AgentEvent` normalization**
   - One internal type covering: text deltas, tool-call start/result, session usage/cost. Both adapters map their native event streams into this type.
   - Preserve the genuine divergence points rather than papering over them: a field indicating whether live tool-execution progress is available (false for Claude per the known gap, true for Codex), and whether cost is SDK-provided vs. computed.

## Explicitly out of scope

- Any renderer/UI change — this phase is verified via a debug script or a temporary unexposed IPC procedure, not real UI.
- Group/@mention routing (Phase 7) — sessions here are 1:1 only.
- Routine-triggered runs (Phase 8) — same `run()` call will be reused there, but scheduling doesn't exist yet.

## Acceptance checks

- [x] `ClaudeAdapter.run()` against a real repo streams normalized events and yields a correct final token/cost figure — verified against a multi-tool-call turn specifically. (Not "deduped" — see the first decision below; deduping turned out to be the wrong fix.)
- [x] `CodexAdapter.run()` (via `runStreamed()`) streams normalized events including live tool-execution status.
- [x] Open item #1 resolved: `developer_instructions` **works**. No fallback needed.
- [x] Open item #2 resolved: `cached_input_tokens` is a **subset** of `input_tokens`. Formula written accordingly.
- [x] Open item #3: price table exists in `src/main/adapters/pricing.ts` with a `LAST_VERIFIED` constant.
- [x] `resume(sessionId)` works for both backends — verified across separate process invocations.
- [x] Sandbox levels are enforced, not just labeled — write attempts blocked on both backends, with the target file confirmed absent afterwards.

## Notes for whoever picks this up

- This phase has the highest "the docs might be wrong" risk in the whole blueprint (see the explicit caveats in §3 and §14). Budget time for empirical verification over trusting SDK documentation at face value.

## How it landed

The "Notes for whoever picks this up" warning above was right: the docs were
wrong in five places, and in one case the blueprint's recommended fix would
have made the number **80× worse** than doing nothing.

### Decisions taken during the phase

- **Claude usage: read `modelUsage` off the last result. Do not sum, do not
  dedupe.** Blueprint §3 says to "dedupe per-step assistant messages sharing an
  id before summing." Both halves are wrong for SDK 0.3.233, and a captured
  multi-tool turn shows it numerically. That turn produced 15 assistant
  messages carrying only **7 distinct ids**, so the duplicate-id problem §3
  warns about is real. But deduping and summing those 7 yields **13 output
  tokens** where the turn actually spent **1045** — the per-message `usage` is
  a running snapshot, not a per-step total. The SDK's own type annotations say
  so: `usage` is _"MAIN AGENT LOOP ONLY … Prefer modelUsage"_, and `modelUsage`
  is _"The correct field for token/cost accounting."_
  There is still a double-count trap, just not that one: `total_cost_usd` and
  `modelUsage` are **cumulative across turns inside a streaming-input session**.
  Avoided structurally by issuing one `query()` per turn with `resume`, so each
  result covers exactly one turn and no delta arithmetic is needed. A resumed
  turn measured 10 input / 8960 cache-read, confirming per-turn scoping.

- **Adapters import neither `electron` nor the database.** The caller resolves
  skills and passes them in. This is what lets `scripts/probe-adapters.ts` run
  outside Electron, and it is the only reason the normalization has tests that
  cost nothing. The consequence is that `resolveCodexBinary()` is _injected_
  through `AdapterConfig` rather than imported.

- **`AgentAdapter.createSession` takes a spec object**, not §3's literal
  `(persona, repoPath)` — skill content has to arrive from outside for the rule
  above. A session then holds only its spec and a resume key, with no live
  handle, because neither SDK keeps a process alive between turns.

- **Codex is given an explicit model.** The event stream never names the model,
  and `~/.codex/config.toml` can pick a different one per machine, so pricing a
  turn against an assumed model would be a guess. Pinned in
  `DEFAULT_CODEX_MODEL` and overridable per session.

### Things worth knowing before touching this layer

- **`@openai/codex-sdk` is ESM-only and the main process is CommonJS.** Its
  exports map declares an `import` condition and nothing else, so `require()`
  of it fails outright with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Phase 3 never hit
  this because `codex-auth.ts` imports only _types_, which erase at compile
  time — this adapter is the first runtime use. Fixed with `await import()`,
  which electron-vite preserves verbatim in the CJS bundle (verified in
  `out/main/index.js`). The package is already inside the existing
  `@openai/codex*` asarUnpack glob.

- **Model availability depends on the auth type, not just the CLI version.**
  codex-cli 0.147.0 knows `gpt-5.2-codex` and `gpt-5.3-codex`, and a ChatGPT
  account rejects both with a 400: _"not supported when using Codex with a
  ChatGPT account."_ `gpt-5.5` works. A machine whose `config.toml` names an
  unavailable model fails every turn until one is passed explicitly.

- **`canUseTool` is not a complete mediator.** The SDK's own classifier decides
  first and only calls us for tool uses it would otherwise prompt about —
  `echo hello` and `pwd && ls` both ran without ever reaching
  `evaluateToolUse`. So `sandbox.ts` is a deny layer over the prompt-worthy
  set, not the whole policy. The boundary still holds where it matters:
  `touch` and `rm` both route through it and are denied, with the target file
  confirmed absent afterwards.

- **Codex sandbox values are hyphenated** (`read-only` / `workspace-write` /
  `danger-full-access`) where blueprint §4's are underscored. Its enforcement
  is OS-level and stronger than anything this process could impose: a
  `read_only` write attempt failed with `zsh:1: operation not permitted`.

- **`codex login status` is not proof of a working login.** It reported
  "Logged in using ChatGPT" and exit 0 against credentials whose refresh token
  had already been consumed; every turn then failed. Phase 3 chose that command
  specifically to catch expired credentials — it does not. Worth revisiting if
  auth state is ever surfaced as reliable.

- **Failures do not always arrive as events.** An expired Codex login rejects
  `runStreamed()` outright rather than emitting `turn.failed`. Both adapters
  wrap the stream so nothing escapes as a bare exception and `done` always
  fires — blueprint §15C needs every failure to reach the thread.

### Blueprint §3 corrections

- Codex's `Usage` has **no `total_tokens`** (the SDK type omits it, though the
  rollout file in `~/.codex/sessions` does record one), and it **does** have
  `cache_write_input_tokens`, which §3 doesn't mention.
- `developer_instructions` is not settable per thread — it lives on the `Codex`
  _client_, so a client is constructed per session.
- §3's "known gap" on Claude tool-execution visibility is at least out of date:
  0.3.233 defines `SDKToolProgressMessage` with `tool_name` and
  `elapsed_time_seconds`, and the adapter maps it. It was **not observed
  firing** — every probe used fast tools — so §3's caution against faking
  progress still stands, and `StreamingIndicator.tsx`'s comment should not be
  rewritten until it is seen in the wild.

### Tests

117 new unit tests (397 total, up from 280); coverage 89.9%, with
`src/main/adapters` at 95.58%. No new E2E: the phase adds no UI and no IPC, so
there is nothing for Playwright to drive; the existing 19 still pass.

Both adapters' stream normalization is asserted against event shapes captured
from real runs, with the SDKs mocked — including the traps: an unmodelled
message type must be ignored rather than throwing, and a thrown failure must
still produce `error` then `done`.

### Verified live

Against a throwaway git repo, on `claude-haiku-4-5-20251001` and `gpt-5.5`:
a plain turn and a multi-tool turn per backend; resume across separate process
invocations (both recalled prior context); `read_only` write attempts refused
on both with the file confirmed absent. Open item #1 was confirmed twice over —
the model quoted its injected passphrase back, and the rollout file shows the
instructions landing as a `role: "developer"` message. Open item #2 was settled
by the CLI's own arithmetic (`input + output = total_tokens`, cached excluded).
The computed Codex cost was checked by hand against a real turn and matched to
nine decimal places.

`npm run package` confirms `@openai/codex-sdk/dist/index.js` lands in
`app.asar.unpacked`. Note that nothing in `src/main/` imports the adapters yet —
Phase 6 wires them — so the packaged import path was verified with a temporary
import and reverted; Phase 6 should confirm it once for real.
