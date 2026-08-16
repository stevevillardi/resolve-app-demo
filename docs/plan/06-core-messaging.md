# Phase 6 — Core Messaging

**Status:** Not started
**Blueprint refs:** §9.1 (repo discovery/binding), §15C (failure states), §16 Journey 1
**Depends on:** Phase 2 (design system shells), Phase 3 (GitHub auth for repo picker), Phase 4 (data layer), Phase 5 (backend adapters)

## Goal

Wire everything built so far into the first real end-to-end loop: create a Contact bound to a real repo, send it a message, watch a real streamed response respecting its sandbox. This phase is where blueprint §16 Journey 1 becomes real. It's explicitly called out as "the foundational loop... if this doesn't work, nothing else matters" — treat it as the phase to get most polished before moving on.

## Inherited from Phase 4 — what already exists

- **`contacts.create` / `contacts.list` / `contacts.get` and `groups.list` are live IPC procedures.** `createContact` already auto-creates the repo's Group in the same transaction, so blueprint §4's "one Group per repo" is handled — item 1's last bullet is done. The `groups.repo_path` unique index enforces it at the schema level too.
- **`ConversationList` already reads real contacts and groups.** What it doesn't have is the per-row `preview`, `timestamp`, and `UsageBadge`: those come from `messages` and `usage_events`, which stay empty until this phase writes to them. The rows currently render a literal "No messages yet" / "No activity yet" — replace those with real values rather than rewiring the component.
- **`NewContactFlow`'s persona picker reads real personas.** The repo picker is still `src/renderer/src/mocks/repos.ts` and the Create button is still a no-op — both are this phase's.
- **`messages` has no `status` or `error` column, on purpose.** Blueprint §12 lists five fields; `streaming` and `error` describe an in-flight turn, not a stored fact, so they live in `src/renderer/src/types/message.ts` as a renderer-only extension of `PersistedMessage`. Keep them there — a message loaded from disk is by definition finished.
- `src/main/db/mappers.ts` has `toMessage` and `toUsageEvent` ready; `messageSchema` and `usageEventSchema` are in `src/shared/domain.ts`.

## Inherited from Phase 5 — what already exists

- **`adapterFor(backend, config)` (`src/main/adapters/index.ts`) is live for both backends**, with `createSession` / `resume` / `run` and a normalized `AgentEvent` stream (`src/shared/agent.ts`). Item 2's "calls `AgentAdapter.run()`" is a call, not a build.
- **Nothing in `src/main/` imports the adapters yet.** Wiring them up is this phase's first job, and it needs three things the probe CLI supplies today: `codexBinaryPath: resolveCodexBinary()` (without it a _packaged_ app cannot find the Codex binary — dev works either way, so this fails late), resolved `Skill[]` for the persona, and an absolute `repoPath`. Adapters deliberately import neither `electron` nor the database, so the caller does all three.
- **`AgentSession.sessionId` is filled in mid-stream**, at the `session_started` event. Read it _after_ the run to persist onto `Contact.backendSessionId`; it is null before the first turn.
- **Usage is ready to become a `UsageEvent` row.** `AgentUsage` mirrors `usageEventSchema` field-for-field. Do not re-derive it — in particular, do not sum Claude's per-step assistant messages; see the decisions log for why that reads 80× low.
- **Errors already arrive as events, classified.** `AgentErrorKind` is a superset of the renderer's `MessageBubbleError['kind']`, so item 4 maps across without a translation table. Both adapters guarantee a `done` event even when a turn throws, so the UI always has a terminal state to settle on.
- **Sandbox enforcement is done and tested** (`src/main/adapters/sandbox.ts`), including live proof on both backends. Item 3 is a demonstration in the real app, not new enforcement code.
- **`npm run probe:adapters` reproduces any turn without the UI.** Use it to tell "the adapter is wrong" apart from "the wiring is wrong" — that distinction is most of the debugging cost in this phase.

Still entirely this phase's:

- **The streaming IPC push channel.** Phase 1's bridge is strictly request/response — `src/preload/index.ts` exposes only `invoke`, and there is no `webContents.send` anywhere. Item 2's event-push mechanism is unbuilt, and it is the genuinely new thing here.
- **`ThreadView`, `GroupThreadView`, `NewContactFlow`'s Create button, and the repo picker** are all still on Phase 2 mocks.
- **The concurrency lock** (item 5) does not exist in any form.

One caveat carried forward: `StreamingIndicator.tsx`'s comment says Claude emits nothing during tool execution. The SDK now defines `SDKToolProgressMessage` and the adapter maps it, but it was never observed firing (every probe used fast tools), so `capabilities.streamsToolProgress` is true on both backends while only Codex has been _seen_ to stream progress. Don't rewrite that comment on the strength of the type alone.

## Scope

1. **`NewContactFlow` goes live**
   - Repo picker calls the real GitHub API (via the token stored in Phase 3) to list the user's repos, replacing Phase 2's mock list.
   - Offer to clone if the selected repo isn't present locally (define a local clone root, e.g. a configurable workspace directory).
   - Creates a real `Contact` row (Phase 4) bound to a `PersonaTemplate` + resolved local `repoPath`.
   - Auto-create the repo's `Group` row if one doesn't exist yet for that `repoPath` (blueprint §4: one Group per repo).

2. **Real `ThreadView`**
   - Replace Phase 2's mocked messages with real `messages` table rows (Phase 4 schema) for the selected Contact.
   - Sending a message: calls `AgentAdapter.run()` (Phase 5) for the Contact's backend, persists both the user message and the streamed response to `messages`, updates `backend_session_id` on first run, uses `resume()` on subsequent turns.
   - Stream `AgentEvent`s into the UI live via the IPC layer's streaming primitive (not polling) — since Phase 1 dropped `electron-trpc` (see `docs/plan/00-progress.md` decisions log), this is not a tRPC subscription: extend the hand-rolled IPC layer with an event-push channel — main calls `webContents.send('agent-event:<sessionId>', event)` per streamed chunk, preload exposes a matching `onAgentEvent(sessionId, callback)` listener via `contextBridge`/`ipcRenderer.on`, and the renderer wires that into local component state (or a TanStack Query cache update) for the active thread. Text deltas update the in-progress bubble, tool-call events feed `StreamingIndicator`, respecting the Claude-vs-Codex visual distinction noted in Phase 5. Build and test this specific mechanism first, since it's new in this phase — Phase 1 only proved request/response IPC, not streaming.
   - On turn completion, log a `UsageEvent` with `source: "message"` (Phase 4 schema, real data now).

3. **Sandbox enforcement, visibly**
   - Confirm in the actual running app (not just Phase 5's debug script) that a `read_only` persona's session cannot edit files — this should be demonstrably true against a real repo in Journey 1's exact scenario ("review the changes in `auth.ts`," no edit attempts).

4. **Failure states (blueprint §15C)**
   - Errors (rate limit, sandbox denial, network failure) render as a distinct error-type message bubble in the same thread — not a silent failure, not console-only.
   - Cover at minimum: SDK auth failure, network failure mid-stream, and a sandbox-denial case.

5. **Concurrency lock, minimal version**
   - Even though Groups/routines aren't built yet, the "one active session per repo" rule (blueprint §15D) should exist now as the in-memory `repoPath → busy` map, since Phase 7 and 8 both depend on it and it's simplest to introduce while there's only one caller (a user-sent message) to test it against.

## Explicitly out of scope

- Group thread real functionality (Phase 7) — `GroupThreadView` can stay on Phase 2's mock data for now.
- @mention routing (Phase 7).
- Routine-triggered runs (Phase 8).
- `OpenPRButton` / real GitHub write actions (Phase 9) — Journey 1 is read-only by design.

## Acceptance checks

- [ ] Blueprint §16 Journey 1 runs live, start to finish, exactly as scripted: create "Code Reviewer" persona (`read_only`, Claude), bind via real repo picker, send "review the changes in `auth.ts`," get a real streamed response that makes no edit attempts.
- [ ] Closing and reopening the app preserves the Contact and its message history, and sending a new message resumes the correct backend session.
- [ ] A deliberately triggered error (e.g. temporarily revoke the API key) renders as a visible error bubble, not a hang or crash.
- [ ] A `UsageEvent` row is created per turn with correct token/cost figures.
- [ ] Attempting to run two messages concurrently against Contacts on the same repo is prevented (second one queues or is rejected with a clear message, not a race).
