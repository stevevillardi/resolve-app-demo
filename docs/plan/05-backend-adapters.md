# Phase 5 — Backend Adapters

**Status:** Not started
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

- [ ] `ClaudeAdapter.run()` against a real repo streams normalized events and yields a deduped, correct final token/cost figure — verified against a multi-tool-call turn specifically.
- [ ] `CodexAdapter.run()` (via `runStreamed()`) streams normalized events including live tool-execution status.
- [ ] Open item #1 resolved: `developer_instructions` reliability confirmed either way, with the fallback implemented if unreliable.
- [ ] Open item #2 resolved: cached-token accounting confirmed either way, cost formula written accordingly.
- [ ] Open item #3: price table exists with a "last verified" date comment.
- [ ] `resume(sessionId)` works for both backends — kill and restart the debug script, resume a prior session, confirm context carries over.
- [ ] Sandbox levels are enforced, not just labeled — attempt a write in a `read_only` session for both backends and confirm it's actually blocked.

## Notes for whoever picks this up

- This phase has the highest "the docs might be wrong" risk in the whole blueprint (see the explicit caveats in §3 and §14). Budget time for empirical verification over trusting SDK documentation at face value.
