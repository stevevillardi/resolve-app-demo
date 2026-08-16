# Phase 6 — Core Messaging: implementation handoff

**Status:** Planned, not started
**Companion doc:** [`06-core-messaging.md`](06-core-messaging.md) — the original
scope doc. This file is the *implementation* plan derived from it, written after
a fresh pass over the code. Where the two disagree, this file is newer and says
why.
**Written:** 2026-08-16, immediately after Phase 5 merged (`600357d`).

## How to use this document

You are picking up Phase 6 of the Persona Router build. Read in this order:

1. [`00-progress.md`](00-progress.md) — the decisions log. Long, but it is the
   accumulated "the docs were wrong about this" record and will save you real
   time. Especially the Phase 5 entries on token accounting and the ESM/CJS
   Codex import.
2. [`06-core-messaging.md`](06-core-messaging.md) — scope, plus its "Inherited
   from Phase 4 / Phase 5" sections listing exactly what already exists.
3. This file — the plan.
4. [`../../persona-router-blueprint.md`](../../persona-router-blueprint.md) —
   design source of truth, at repo root. §3, §5, §9, §15C/§15D, §16 Journey 1
   are the relevant sections.

Conventions this repo already follows:

- Branch `phase-6-core-messaging` off `main`, merged when the acceptance checks
  pass — matching `phase-1-bootstrap` … `phase-5-backend-adapters`.
- Conventional Commits (`feat(scope): subject`). **No `Co-Authored-By` trailer.**
- A phase is not `Done` until its testable logic has tests, and the testing scope
  is part of the phase rather than bolted on. See item 10.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run dev`,
  `npm run probe:adapters`, `npm run package`.

---

## Context

Phase 5 landed the backend adapters but wired them to nothing — `grep` confirms
no file under `src/main/` imports `src/main/adapters/`. The app today can create
personas, skills, contacts and groups, and can authenticate against Claude,
Codex and GitHub, but it cannot send a single message. `ThreadView` renders
`src/renderer/src/mocks/messages.ts`, `NewContactFlow`'s Create button calls
`onOpenChange(false)` and nothing else, and the `messages` / `usage_events`
tables have never had a row written to them.

Phase 6 closes that loop: bind a Contact to a real repo, send it a message,
watch a real streamed response, persist the turn and its cost. Blueprint §16
calls Journey 1 "the foundational loop — if this doesn't work, nothing else
matters."

Two things changed during planning and are the reason this plan is longer than
the scope doc:

1. **Blueprint §15D's concurrency lock is over-broad and is being corrected.**
   As specified it keys on `repoPath` and blocks *every* run, which would stop a
   `read_only` reviewer from reading while a writer works — personas that cannot
   mutate the tree do not need a mutex. The lock becomes a **write lock keyed on
   the working path**: readers never acquire it, writers hold it exclusively.
2. **Git worktree isolation is adopted as a future phase**, not built here, so
   that two *writing* personas can eventually run concurrently. Phase 6 leaves
   the seam (`workingPathFor(contact)`); the design is recorded in Part B so
   Phases 7–9 are planned against it.

## Decisions taken during planning

- **Repo binding: GitHub list *and* local folder.** `NewContactFlow` gets both
  paths — the Octokit repo list with a clone offer (blueprint §9.1), and a
  native folder picker. Journey 1 then never depends on a clone succeeding.
- **Clone root: asked for on first clone**, then remembered in the existing
  `app_state` table as `workspace_root`. No settings screen.
- **Stop button is in scope.** `AgentAdapter.run()` already takes an
  `AbortSignal`; wiring it costs little and it is the only way to recover a
  stuck run or a stuck lock during a live demo.
- **Concurrency: write lock on the working path.** Readers unrestricted.
- **Worktrees: own phase, slotted between 8 and 9.** Phase 7 needs nothing from
  them (its Journey 2 pairs one writer with one reader, which the new lock
  already permits); Phase 8's scheduled writers are the first real contention;
  Phase 9's Open PR is much better with a per-persona branch to push.
- **Worktree isolation is chosen per Contact at bind time**, not per persona —
  the same persona may want isolation on one repo and not another. *Not built in
  Phase 6*: a control that does nothing is worse than a control added later, so
  `NewContactFlow` gains the step in the worktree phase.

---

# Part A — Phase 6 implementation

Ordered so the riskiest new mechanism is proven first. Items 1–3 are
prerequisites for anything else working.

## 1. Migration `0004` — ALREADY DONE

**Built during the post-Phase-5 review, not by this phase.** See
`drizzle/0004_add_model_and_usage_attribution.sql` and the review section in
[`05-backend-adapters.md`](05-backend-adapters.md). Nothing to do here except
know it exists; the rest of this item is the record of what landed and where it
differs from what was planned.

| Table | Column | Why |
|---|---|---|
| `persona_templates` | `model TEXT NULL` | item 2; null = the backend's default, so no backfill |
| `usage_events` | `model TEXT NULL` | "attributed to the model that actually ran" had no column |
| `usage_events` | `cost_source TEXT NULL` | `'sdk'` vs `'computed'`; Phase 10 must label estimates honestly |
| `usage_events` | `cache_write_input_tokens INTEGER NULL` | see below |
| `usage_events` | `reasoning_output_tokens INTEGER NULL` | see below |

**Correction to the original plan.** It said the last two were "deliberately not
added — neither appears in blueprint §12 and neither feeds the cost formula."
They went in anyway. The reasoning that overrode it: both adapters have produced
these two fields on every turn since Phase 5, and a column that costs nothing
until written is cheaper than discovering in Phase 10 that a year of turns
recorded neither. The cost-formula argument was also the weaker one — Codex
prompt-cache *writes* are free today, but that is a vendor pricing decision, not
a property of the data.

`usageEventSchema` and `personaTemplateSchema` in `src/shared/domain.ts`,
`toUsageEvent` / `toPersonaTemplate` in `src/main/db/mappers.ts`, and every
persona fixture are updated. `costSourceSchema` **moved to `domain.ts`** —
`agent.ts` re-exports it, so existing imports still resolve, but domain owns it
now that a UsageEvent persists it.

`AgentUsage` and `usageEventSchema` now mirror each other field for field, which
is what makes item 4's "persist `done.usage` as-is" a straight copy rather than
a lossy one.

## 2. Per-persona model selection — schema done, UI remains

The database and domain half landed with migration `0004` above:
`personaTemplate.model` is `z.string().nullable()`, mapped, and covered by tests
asserting that null parses and an *absent* model does not. What follows is the
part still to build.

Do this before item 4 — a session cannot run without a resolved model.

Background (from `00-progress.md`): model availability depends on the **account**,
not just the SDK version. A ChatGPT-account Codex user gets a 400 on
`gpt-5.2-codex` and `gpt-5.3-codex`; `gpt-5.5` works. So `DEFAULT_CODEX_MODEL` is
only correct until it isn't, and cost attribution is a guess whenever it's wrong.

- Hardcoded lists per backend in a new `src/main/adapters/models.ts` with a
  `LAST_VERIFIED` constant, exactly the treatment `src/main/adapters/pricing.ts`
  gets. Neither SDK exposes "models available to this account". Expose it to the
  renderer via a new `models.listForBackend` procedure rather than duplicating
  the list in the renderer.
- `PersonaDetailPanel` gets a model control. **Correction to the scope doc:**
  backend/sandbox/githubScope are `SegmentedControl` radiogroups, not `Select`s,
  and `SegmentedControl` is a fixed-width sliding-thumb control that won't hold
  a model list. Use the Base UI `Select` — the one existing consumer to copy is
  `src/renderer/src/components/routines/RoutineEditor.tsx:79-104` (note its
  unusual API: both an `items` prop *and* children). First option is
  "Default (backend's choice)" mapping to `null`.
- The field joins `PersonaForm`'s per-field `useState` and the `edited` object;
  the `JSON.stringify` dirty check picks it up for free. `PersonaForm` is keyed
  on `persona.id` so switching selection remounts and re-seeds — don't break that.
- Repopulate the list when `backend` changes, and clear `model` to `null` if the
  current value isn't in the new backend's list.
- Adapter side is already done — `SessionSpec.model` is honoured by both
  adapters. This is plumbing a persisted value into a field that exists.
- The failure mode is a 400 on first use. Surface it clearly (it already
  classifies as an `error` event) rather than pretending the list is
  authoritative.

## 3. The streaming IPC push channel — build and test this first

The genuinely new mechanism in this phase. Phase 1's bridge is strictly
request/response: `src/preload/index.ts` exposes only `invoke`, and
`webContents.send` appears nowhere in the repo.

**Key the stream on a `runId`, not a `sessionId`.** `AgentSession.sessionId` is
`null` until the adapter fills it in mid-stream at `session_started`, so the
channel name the scope doc suggests (`agent-event:<sessionId>`) cannot exist at
subscribe time for a Contact's first turn. Main mints a `runId` when the turn
starts and returns it synchronously from `messages.send`.

**One channel, not one per run** — mirroring how `ipc-invoke` is a single channel
dispatching by procedure name. Add to `src/shared/agent.ts`:

```ts
export const agentStreamMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), runId: z.string(), event: agentEventSchema }),
  z.object({ kind: z.literal('runs-changed') })
])
```

- **Main:** new `src/main/services/agent-events.ts` exporting
  `emitAgentEvent(runId, event)` and `emitRunsChanged()`. Resolve the window
  *at send time* via `BrowserWindow.getAllWindows()[0]` with an `isDestroyed()`
  guard — `setupIpc()` runs before `createWindow()` in `src/main/index.ts`, so a
  window cannot be captured at registration time, and `mainWindow` is a
  function-local `const` that is never exported. Keeping the lookup here also
  preserves the rule that `src/main/adapters/**` never imports `electron`.
- **Preload:** add to `src/preload/index.ts` *and* `src/preload/index.d.ts`
  (the runtime file holds the loose signature, the ambient decl is where
  genericity is asserted):
  ```ts
  onAgentEvent: (runId: string, cb: (event: AgentEvent) => void) => () => void
  onRunsChanged: (cb: () => void) => () => void
  ```
  Filter by `runId` inside the listener; never leak the raw `IpcRendererEvent`
  to the callback; return an unsubscribe that calls `removeListener`.
- **Renderer:** thin wrappers in `src/renderer/src/lib/ipc-client.ts` beside
  `callProcedure`, matching its passthrough style.
- **`done` is emitted only after persistence completes**, so a renderer that
  reacts to `done` by invalidating its messages query cannot refetch before the
  assistant row exists.

## 4. Messaging service in main

New `src/main/services/messaging.ts`. Everything below lives here or in the
small services it calls — `src/main/ipc/procedures/**` is excluded from coverage
(see `vitest.config.ts`), so handlers stay one-liners over services.

Supporting pieces to add:

- `src/main/services/skills.ts` → `skillsForPersona(persona): Skill[]`. Does not
  exist; the probe CLI fakes it by loading files from disk. `orderSkills` inside
  `src/main/adapters/context.ts` already re-orders, so only completeness matters.
- `src/main/services/contacts.ts` → `setBackendSessionId(id, sessionId)`. The
  service has no update path at all today.
- New `src/main/services/usage-events.ts` → `createUsageEvent`,
  `listUsageEvents(contactId?)`.
- New `src/main/services/adapter-host.ts` → builds `AdapterConfig` once:
  `{ codexBinaryPath: resolveCodexBinary(), env: { ...process.env, ANTHROPIC_API_KEY, OPENAI_API_KEY } }`.
  `resolveCodexBinary()` lives in `src/main/services/codex-auth.ts` and is
  memoized. Copy the env recipe from `childEnv()` in `codex-auth.ts:89` and heed
  the Phase 3 caveat that the Claude SDK's `options.env` **replaces** the
  subprocess environment rather than merging, so `process.env` must be spread
  explicitly. **Without `codexBinaryPath` a packaged app cannot find the Codex
  binary while dev works either way** — this fails late, which is exactly why it
  belongs in one place.

`sendMessage({ contactId, content })` — synchronous part:

1. Load contact → persona → skills.
2. `acquire()` the lock (item 5). Refusal throws with a message naming the
   holder; **no message row is written**, since no turn happened.
3. Persist the user `messages` row.
4. Mint `runId`, register an `AbortController`, start `runTurn()` **without
   awaiting it**, `emitRunsChanged()`.
5. Return `{ runId, userMessage }`.

`runTurn()` — background:

- `adapterFor(persona.backend, adapterConfig())`.
- `contact.backendSessionId ? adapter.resume(spec, id) : adapter.createSession(spec)`.
- `for await (const event of adapter.run(session, prompt, signal))` →
  `emitAgentEvent(runId, event)` for every event except `done`; accumulate
  `finalText`.
- On the stream ending: persist the assistant `messages` row from
  `done.finalText` (**not** from accumulated deltas — Codex never emits
  `text_delta`, see `CODEX_CAPABILITIES.streamsTextDeltas: false`); persist the
  `usage_events` row from `done.usage` with `source: 'message'`; write
  `session.sessionId` onto the Contact if it changed (the adapters mutate
  `session.sessionId` in place, so read it *after* the run); release the lock;
  *then* `emitAgentEvent(runId, doneEvent)` and `emitRunsChanged()`.
- **Take `AgentUsage.costUsd` as-is.** Do not recompute — `null` means unknown
  and must never be rendered as `0`. Do not re-derive Claude's tokens by summing
  assistant messages; Phase 5 measured that as reading 80× low. `AgentUsage`
  mirrors `usageEventSchema` field-for-field by design.
- Both adapters guarantee a `done` even when a turn throws, so the release path
  has one exit. Still wrap in `try/finally` — an exception escaping the adapter
  wrapper would otherwise leak the lock permanently.

## 5. Concurrency: a write lock on the working path

**This supersedes blueprint §15D**, which specifies a `repoPath → boolean busy`
map checked before *any* run. That would block a `read_only` reviewer while a
writer works, which needlessly serializes personas that cannot collide. The
hazard is two writers mutating one working tree — half-applied edits, one agent
reading a file another is rewriting, `.git/index.lock` contention.

New `src/main/services/run-lock.ts`, pure and fully unit-testable:

```ts
export type LockMode = 'shared' | 'exclusive'
export function workingPathFor(contact: Contact): string       // contact.repoPath today — the worktree seam
export function lockModeFor(persona: PersonaTemplate): LockMode // read_only -> shared, else exclusive
export function acquire(path: string, mode: LockMode, holder: RunHolder): Release | null
export function holderOf(path: string): RunHolder | null
export function activeRuns(): RunHolder[]
```

Semantics: unlimited `shared` holders; one `exclusive` holder, which also
excludes new `shared` holders *starting* (a reader may finish alongside a writer
that started after it — a reader seeing a mid-write snapshot is a stale read, not
corruption). Module-level mutable state matches the existing style in
`github-auth.ts` / `codex-auth.ts`.

Honesty note to put in the code comment, not just here — **and this changed
after the post-Phase-5 review, so ignore any older phrasing of it.** The
premise of the shared/exclusive split is that a `read_only` persona genuinely
cannot write. That is now true at the OS level on **both** backends: Codex via
`--sandbox read-only`, Claude via `Options.sandbox` with an empty
`filesystem.allowWrite` (see `claudeSandboxOptions`). The review found that
before this, Claude's side was `disallowedTools` plus a hand-rolled bash
allowlist with real escapes through it — a Claude reader was policy-safe, not
kernel-safe, and the lock's correctness rested on that weaker guarantee.

The one platform where it still doesn't hold is Windows, which has no sandbox
implementation. Read the backend's `capabilities.sandboxEnforcement` rather than
assuming: `'os'` means the kernel is enforcing it, `'policy'` means only
`evaluateToolUse` is. If it is `'policy'`, a "reader" is a promise rather than a
guarantee, and treating it as `shared` is a judgment call the code should make
visibly rather than silently.

Renderer surface: new `runs.list` procedure returning active runs; the
`runs-changed` push invalidates its query key. `Composer` gains `disabled` and a
busy `hint` — it has neither today. A refused send renders as an inline error
under the composer, **not** an error bubble, since no turn ran.

## 6. Stop button

- `messages.cancel({ runId })` → `controller.abort()`.
- On abort: persist the accumulated text as the assistant message if non-empty,
  otherwise write no row; log the `UsageEvent` if `done` still carried usage (the
  turn was billed regardless); release the lock.
- `ThreadView` shows Stop in place of Send while its contact has an active run.
- **Verification risk to carry:** Phase 5 never exercised the `AbortSignal` on
  either adapter. If a backend ignores it, we still stop forwarding events and
  release the lock, but the subprocess may keep running. Confirm per backend and
  record the result in the phase doc's "Verified live" section.

## 7. `NewContactFlow` goes live

The persona picker is already real (`usePersonas()`). The repo step is the work.

- **GitHub path:** new `github.listRepos` procedure. `github-auth.ts` imports
  Octokit but constructs it once inline for `users.getAuthenticated()` — extract
  a shared authenticated client. Token via the existing `getGitHubToken()`,
  which exists precisely for this ("Phases 6 and 9 read the token through here").
- **Local path:** new `repos.chooseDirectory` using `dialog.showOpenDialog`
  (`openDirectory`). Validate the choice is a directory and note whether it is a
  git repo — binding a non-git directory is allowed, but the worktree phase
  can't isolate it.
- **Clone:** `repos.clone({ fullName, cloneUrl })` shelling out to `git` via
  `spawn` — a new `src/main/services/git.ts`. There is no git plumbing in the
  repo today; `spawn` appears exactly once, in `codex-auth.ts:177`, which is the
  pattern to copy. Authenticate private clones with
  `https://x-access-token:<token>@github.com/<full>.git`, and **never log the
  assembled URL**. If `workspace_root` is unset in `app_state`, prompt for it
  with the directory picker first, then remember it. Add `workspace_root` to the
  `AppStateKey` union in `src/main/services/app-state.ts` (non-secret metadata
  only — the encryption boundary stays `secrets.ts`).
- The existing `RepoListState` (`'loading' | 'empty' | 'error' | { repos }`) was
  written for exactly this swap — its non-`repos` branches are already coded and
  currently unreachable, and its `useState` deliberately omits the setter. Reuse
  rather than rewrite.
- Create button (currently `onClick={() => onOpenChange(false)}`): new
  `useCreateContact()` hook → `contacts.create`. Display name via the existing
  `repoName()` in `src/renderer/src/lib/format.ts`. The Group is auto-created
  inside `createContact`'s transaction already — nothing to add for blueprint
  §4's "one Group per repo", and `groups_repo_path_unique` enforces it at the
  schema level.
- Known v1 limitation to state in the UI: a large clone blocks the dialog on a
  spinner, since `repos.clone` is a plain invoke with no progress stream.

## 8. Real `ThreadView` and `ConversationList`

- `useMessages(contactId)` → `messages.list`; `useSendMessage()` → `messages.send`.
  Follow the existing hook conventions in `src/renderer/src/hooks/`: a
  module-level `as const` query key, explicit return type annotations, and
  mutations returning a hand-shaped `{ verb, isPending, error }` rather than the
  raw `UseMutationResult`.
- **Fold the event stream in a pure function**, e.g. `applyAgentEvent(state, event)`
  in `src/renderer/src/lib/stream.ts`. This is a hard constraint, not a
  preference: the renderer Vitest project matches `src/renderer/**/*.test.ts`
  only — **`.tsx` is not matched** — and there is no `@testing-library/react` in
  devDependencies. A pure fold is the only way this phase's most intricate new
  logic gets tested without adding deps and changing config.
- Hold in-flight run state in a small Zustand store (`useRunStore`, keyed by
  contactId) rather than component state — `ThreadView` unmounts when the user
  switches conversations, and a run must survive that. Keep it out of
  `useUiStore`, which is `persist`ed to localStorage and documented as
  "local-only UI state — never touches IPC".
- Mapping: `text_delta` appends; `text_message` **replaces, never appends**
  (the Codex path);
  `tool_start`/`tool_progress` feed `StreamingIndicator`'s `activity` prop,
  replacing the hardcoded `'rg -l fetchStuff src/'` in `MessageBubble.tsx`;
  `error` → error bubble; `done` → invalidate `messagesKey(contactId)`, the
  usage key, and `contactsKey`.
  The two overlap rather than following on from each other: Claude emits the
  deltas for a block *and then the same block whole*, so a fold that appends
  both renders every reply twice. Pinned by a test in
  `src/main/adapters/claude.test.ts` ("emits the same text twice") and
  documented on the schema in `src/shared/agent.ts`. What gets persisted is
  neither — that is `done.finalText`.
- **Widen `MessageBubbleError['kind']`** in `src/renderer/src/types/message.ts`
  to match `AgentErrorKind` — it is missing `auth` and `unknown`, so
  `ERROR_TITLE[error.kind]` currently yields `undefined` for those. Add both
  titles.

  The comment in `agent.ts` used to claim these "map across with no translation
  table"; the post-Phase-5 review corrected it, because a *superset* is exactly
  what cannot be assigned. `unknown` is what `classifyErrorMessage` returns by
  default, so it is the common case rather than an edge one — an unwidened union
  means the most likely error renders with an empty title. `auth` deserves its
  own copy and a re-login affordance: it is the one error kind with a concrete
  user action behind it. Also change `ERROR_TITLE[error?.kind ?? 'network']` to
  fall back to `unknown` — defaulting a missing error to "Network error" states
  a cause nobody established.
- Do **not** rewrite `StreamingIndicator.tsx`'s Claude-vs-Codex comment. The SDK
  defines `SDKToolProgressMessage` and the adapter maps it, but it has never been
  observed firing — every Phase 5 probe used fast tools. `streamsToolProgress` is
  true on both backends while only Codex has been *seen* to stream progress.
- Keep `messages` renderer-transient fields out of the database. Blueprint §12's
  five columns are deliberate; `status` and `error` describe an in-flight turn,
  and a message loaded from disk is by definition finished. The tempting fix
  here is to persist them — don't.
- `ConversationList`: replace the literal `preview="No messages yet"` /
  `"No activity yet"` and pass `timestamp` and `usage` — `ConversationListItem`
  already accepts all three, so this is props, not rewiring. Use the existing
  `previewLine()` in `format.ts` (written for this, currently unused by any
  component) and `usageForContact()` in `lib/usage.ts`. Add a `messages.previews`
  procedure returning one latest row per contact rather than issuing N queries.

## 9. Failure states and the sandbox demonstration

- Every `AgentErrorKind` renders as an error bubble in the thread (blueprint
  §15C) — not a silent failure, not console-only. Cover at minimum: SDK auth
  failure, network failure mid-stream, sandbox denial.
- Sandbox enforcement is Phase 5 work, corrected by the post-Phase-5 review and
  now OS-enforced on both backends. Scope item 3 is a *demonstration* in the
  running app against Journey 1's scripted scenario, not new enforcement code —
  but see verification items 11–12, which are the live checks the review could
  not run.
- **Guard startup.** `initDb()` and `seedIfNeeded()` run unwrapped inside
  `app.whenReady()` in `src/main/index.ts`. A failing migration therefore throws
  into a promise nobody handles: no window appears and nothing says why. This
  phase is the first to ship a migration to existing installs, so it is the
  first where that failure is plausible. Wrap both, show a `dialog.showErrorBox`
  naming the database path, and quit deliberately rather than hanging.
- **`ipcContract[name]` is a bare index lookup** in
  `src/main/ipc/registerProcedure.ts`, so `__proto__` and `constructor` return
  truthy non-entries from `Object.prototype`. The handler lookup on the next
  line catches it today, which makes this hardening rather than a live bug — use
  `Object.hasOwn(ipcContract, name)` so the guard doesn't depend on a second
  check happening to be there.

## 10. Tests

Per the standing rule that a phase isn't done until its testable logic has tests.
Patterns to copy: `vi.mock(...)` at module top then `const { x } = await import(...)`;
db-backed services against `createTestDb()` with the real migrations.

- `run-lock.ts` — pure; cover shared/shared, shared/exclusive both orders,
  exclusive/exclusive, release, and the refusal message naming the holder.
- `messaging.ts` — `createTestDb()` plus a fake adapter injected with
  `vi.mock('../adapters', () => ({ adapterFor: () => fakeAdapter }))` and a
  stubbed `agent-events` sink. Assert: user row written before the run; assistant
  row from `done.finalText`; usage row mapping including `costUsd: null`
  surviving as null; `backendSessionId` written on turn 1 and `resume` used on
  turn 2; a thrown adapter still persists, emits `done`, and releases the lock;
  abort persists partial text.
- `agent-events.ts` — window resolution and the `isDestroyed()` guard, with
  `vi.mock('electron')` supplying a fake `BrowserWindow`/`webContents`.
- `src/shared/ipc-contract.test.ts` — its `expect.arrayContaining([...])` lists
  every procedure name. **Add the Phase 6 names or the test's intent silently
  rots.**
- `src/renderer/src/lib/stream.test.ts` — the pure fold, against event sequences
  copied from `src/main/adapters/*.test.ts`'s captured real-run fixtures. Phase 5
  established that fabricated fixtures test our reading of the docs rather than
  the SDK; reuse the captured ones.
- E2E: extend `e2e/` to create a Contact via the local-folder path and assert the
  thread renders. Do **not** send a real turn from E2E — it costs money and
  depends on live credentials. Use `waitForBridge` rather than `waitForShell`
  where a test only needs IPC.

## 11. Verification

1. `npm run dev` → Journey 1 exactly as scripted: create "Code Reviewer"
   (`read_only`, Claude), bind via the repo picker, send "review the changes in
   `auth.ts`", watch a real streamed response that attempts no edits.
2. Quit and relaunch → Contact and history intact; the next message resumes the
   same backend session (confirm the same `backendSessionId`).
3. Revoke a credential → visible error bubble, not a hang or crash.
4. Inspect `usage_events` → one row per turn, `model` matching what actually ran.
5. Change a persona's model, restart, send → the new model appears in the next
   `UsageEvent`, not just in the form.
6. **Concurrency:** two Contacts on one repo — a `read_only` and a
   `workspace_write` — run simultaneously and both complete. Two writers: the
   second is refused with a message naming the holder. Stop the first, confirm
   the second then runs.
7. `npm run probe:adapters` is the A/B whenever something breaks — it tells "the
   adapter is wrong" apart from "the wiring is wrong", which is most of the
   debugging cost in this phase.
8. `npm run package` → confirm the packaged app resolves the Codex binary and
   runs a real turn. Phase 5 verified the asar path with a temporary import and
   reverted it, explicitly leaving this for Phase 6 to confirm for real.
9. `npm run lint`, `npm run typecheck`, `npm test`.

### Carried over from the post-Phase-5 review

These are unverified claims the review could not settle offline. Each one is
load-bearing for something this phase builds, so settle them early rather than
discovering them through a wrong number in the dashboard.

10. **Is Claude's `total_cost_usd` / `modelUsage` per-turn or cumulative under
    `resume`?** `claude.ts`'s header asserts per-turn, reasoned from SDK docs
    about *streaming-input* sessions — never checked across an actual resume.
    If it is cumulative, every `UsageEvent` after the first over-reports and
    item 4 must store a delta rather than the raw figure. Two probe turns
    settle it:
    ```
    npm run probe:adapters -- --backend claude --repo <scratch> --prompt "say ok"
    npm run probe:adapters -- --backend claude --repo <scratch> --prompt "say ok again" --resume <id>
    ```
    Compare `done.usage` across the two and record the numbers either way — a
    verified "it is per-turn" is worth as much as finding a bug.
11. **Does the OS sandbox actually engage?** `claudeSandboxOptions` sets
    `Options.sandbox` and unit tests assert the *options*, which is not the same
    as the kernel refusing a write. In a scratch repo with a `read_only`
    persona, attempt `find . -delete` and a `Write`, then assert the file is
    still on disk — not merely that an event said "denied". Do the same at
    `workspace_write` with a target *outside* the repo, which is the case that
    was unenforced before the review.
12. **What happens when the sandbox cannot start?** `failIfUnavailable: true`
    means the turn fails rather than running unconfined. Confirm that failure
    reaches the thread as an error bubble instead of a hang — it is the path
    nobody sees until it matters.
13. **Migration `0004` against a populated database.** The mapper tests cover a
    freshly migrated `:memory:` db. Copy a real `userData` database from before
    `0004`, launch, and confirm existing personas and usage rows survive with
    the new columns reading back absent rather than guessed.

---

# Part B — Documentation updates

Downstream phases must be updated to understand what is coming. This is part of
the phase, not an afterthought.

## `docs/plan/06-core-messaging.md`

Rewrite scope item 5 (concurrency) around the write-lock model; add the stop
button as item 7; record the repo-picker and clone-root decisions; correct the
`Select`-vs-`SegmentedControl` detail; note migration `0004` also touches
`usage_events`. Update the acceptance checks to match — in particular the
concurrency check now reads "two writers on one repo serialize; a reader is
never blocked."

## `docs/plan/00-progress.md`

Tracker row for Phase 6, plus new decision entries:

- **§15D's lock is a write lock, not a repo lock** — with the reasoning, the
  Codex-OS-enforced vs Claude-policy-enforced asymmetry, and the
  `workingPathFor()` seam.
- **Worktree isolation adopted, deferred, and chosen per Contact at bind time.**
- **Model/cost columns on `usage_events`**, and why `cacheWriteInputTokens` /
  `reasoningOutputTokens` were left out.

## `docs/plan/07-group-coordination.md`

Item 5 currently says "extend Phase 6's `repoPath → busy` map." Rewrite for the
new model: an @mention run acquires the same working-path lock in the mode its
persona implies, so an @mentioned reader is never blocked. Add that the Group is
the awareness channel for branch state once worktrees land, and that Journey 2 as
scripted works *without* worktrees under the new lock — one writer plus one
reader run concurrently already.

## `docs/plan/08-routines-scheduler.md`

Scope item 2 says "check the concurrency lock (Phase 6/7's `repoPath → busy`
map) — skip or queue if busy." Update: a routine acquires the same lock in its
persona's mode. A `read_only` routine never skips. A writing routine is the
**first real writer-vs-writer contention in the product**, and is the case
worktree isolation exists to solve — cross-reference it.

## `docs/plan/09-github-remote-actions.md`

Scope item 2 detects local changes "via git status on the bound `repoPath`."
Note that once worktrees land, the branch to push is the Contact's own branch,
which makes Open PR substantially cleaner than pushing from the user's working
tree — and that `src/main/services/git.ts` (created in Phase 6 for cloning) is
where that plumbing belongs.

## New: `docs/plan/12-worktree-isolation.md`

Numbered 12 so nothing renumbers, but **slotted between Phases 8 and 9 in the
tracker's execution order**, with a one-line note explaining the mismatch.

**Goal.** Let two *writing* personas work the same repo concurrently, each in its
own `git worktree` on its own branch.

**Schema.** `contacts.worktree_path` and `contacts.branch`, both nullable.
`repo_path` keeps meaning *the canonical repo*, so blueprint §4's "one Group per
repo" and the `groups_repo_path_unique` index are untouched — the Group still
keys on the repo, the session just runs elsewhere. Session cwd becomes
`worktree_path ?? repo_path`, which is exactly what `workingPathFor()` returns.
`SessionSpec.repoPath` becomes the worktree path, so `isInsideRepo()` fences the
right directory with **no change to `sandbox.ts`**.

**Chosen per Contact at bind time** — `NewContactFlow` gains an isolation step.

**The §6 problem, stated plainly.** Blueprint §6's "filesystem state is free —
code changes are automatically visible across Contacts" stops being true the
moment a writer works on its own branch. This phase's real design work is the
answer, in three layers, only the last of which involves a human:

1. **Ambient awareness — automatic.** A worktree session that commits records its
   branch, head sha, and touched files in its Phase 7 end-of-session summary.
   Phase 7 already injects durable `GroupMessage`s into every session start on
   that repo, so the *next* session begins knowing there is unmerged work on
   `persona/refactor-buddy` touching `src/auth.ts`. This rides an existing seam
   and costs nothing new.
2. **Read without merging — automatic, no mutation.** Worktrees share one object
   store, so a sibling's branch is fully readable from inside your own worktree:
   `git diff main...persona/refactor-buddy`, `git show <branch>:<path>`,
   `git log`. Each session's context gets a short "open sibling branches" block
   saying so. This is what keeps Journey 2 working: a reviewer can review a
   refactor without anything being merged anywhere. §6's "filesystem state is
   free" degrades only to "the *object store* is free." Confirm
   `isReadOnlyCommand()` in `sandbox.ts` classifies `git show` / `git diff` /
   `git log` as reads, or a `read_only` persona cannot use any of this.
3. **Integrate — human, one click.** A persona that needs a sibling's changes *in
   its own tree* cannot self-serve. It raises a request, carried as an optional
   `needs: { branch, reason }` on Phase 7's structured summary — cheaper than
   exposing an MCP tool, though `@modelcontextprotocol/sdk` is already a
   dependency if a richer channel is wanted later. The Group thread renders it as
   an actionable row, and a standing **Branches panel** lists every open persona
   branch so the human can act without waiting to be asked. Row actions: **View
   diff**, **Merge into `<target working path>`**, **Open PR** (Phase 9),
   **Discard**. Run `git merge --no-commit --no-ff` as a dry run first so the
   merge button is honest about conflicts before it is clicked. Merges target a
   *specific* working path — merging for Code Reviewer touches Code Reviewer's
   tree, not the user's. Nothing merges without a click.

A blocked persona's turn ends normally rather than hanging; after the human
merges, the user re-sends. Auto-resume-on-merge is a natural extension, not v1.

**Costs to record honestly in that doc:** a worktree starts from a commit, so
uncommitted work in the main tree is invisible inside it; a fresh worktree has no
`node_modules`, so a persona that runs tests needs an install step; non-git
directories cannot be isolated at all and fall back to an exclusive lock;
lifecycle is real work (create lazily on first writing turn, `git worktree
remove` on Contact delete, `git worktree prune` on startup).

---

## Files touched

**New (main):** `services/messaging.ts`, `services/run-lock.ts`,
`services/agent-events.ts`, `services/usage-events.ts`,
`services/adapter-host.ts`, `services/git.ts`, `adapters/models.ts`,
`ipc/procedures/messages.ts`, `ipc/procedures/repos.ts`.

**New (renderer):** `hooks/useMessages.ts`, `hooks/useRuns.ts`, `lib/stream.ts`,
`store/useRunStore.ts`.

**Modified (contracts/schema):** `src/shared/ipc-contract.ts`,
`src/shared/domain.ts`, `src/shared/agent.ts`, `src/main/db/schema.ts`,
`src/main/db/mappers.ts`, `drizzle/0004_*.sql`.

**Modified (boundary):** `src/preload/index.ts`, `src/preload/index.d.ts`,
`src/renderer/src/lib/ipc-client.ts`, `src/main/ipc/index.ts`.

**Modified (services):** `services/skills.ts`, `services/contacts.ts`,
`services/github-auth.ts`, `services/app-state.ts`.

**Modified (UI):** `conversation/ThreadView.tsx`, `conversation/Composer.tsx`,
`conversation/MessageBubble.tsx`, `conversation/ConversationList.tsx`,
`persona/NewContactFlow.tsx`, `persona/PersonaDetailPanel.tsx`,
`types/message.ts`.

**Deletable mocks:** `mocks/messages.ts`, `mocks/markdownSamples.ts`,
`mocks/repos.ts`, and `mocks/skills.ts` (already dead — imported by nothing).
`mocks/contacts.ts`, `personaTemplates.ts`, `groups.ts`, `routines.ts`,
`usageEvents.ts` must survive for Phases 7/8/10.
