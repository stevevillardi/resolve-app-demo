# Persona Router — Implementation Blueprint

**Format:** Electron desktop app, iMessage-style UI
**Backends in scope (v1):** Claude Agent SDK, Codex SDK
**Purpose of this doc:** single source of truth for implementation. Written for whoever (or whatever agent) builds this next — it assumes no prior context beyond what's written here.

---

## 1. What this is

A desktop app where each "contact" is a persistent AI persona — a system prompt, a set of reusable skills, and a scope (repo + permissions) — that you message like a person. The app does not run its own models. It's an orchestration/UX layer on top of the Claude Agent SDK and Codex SDK: it manages persona definitions, routes messages to the right backend session, persists conversation and project history, tracks token spend, can wake personas on a schedule, and renders everything in an iMessage-style interface.

---

## 2. Architecture

```
┌───────────────────────────────────────────────────────────┐
│ Electron app                                                │
│                                                               │
│  Renderer (React)              Main process (Node)           │
│  ┌──────────────┐   typed IPC  ┌───────────────────────┐    │
│  │ iMessage UI   │◄────────────►│ Router / adapters      │    │
│  │ (contacts,    │              │  • ClaudeAdapter        │    │
│  │  groups,      │              │  • CodexAdapter         │    │
│  │  threads)     │              │  • GitHubService         │    │
│  └──────────────┘               │  • Scheduler (routines)  │    │
│                                  │  • SQLite (better-sqlite3)│  │
│                                  └──────────┬────────────┘    │
└─────────────────────────────────────────────┼─────────────────┘
                                               ▼
                          Claude Agent SDK / Codex SDK
                                               ▼
                          Local repos / filesystem (cwd per session)
                                               ▼
                                    GitHub API (auth, PRs, repo list)
```

**Why Electron:** needs OS-level process management (spawning/managing SDK sessions, filesystem access across arbitrary local repos, background residency, running a scheduler even when no window is focused).

**Process boundary rule:** the renderer never touches the filesystem, SQLite, the SDKs, or the scheduler directly. All of that lives in the main process. The renderer only calls typed procedures over IPC and renders what comes back.

---

## 3. Backend adapters

Both Claude and Codex expose the same primitive: create a session/thread → run a prompt → stream structured events → resume by ID. One adapter interface, one implementation per backend.

```ts
interface AgentAdapter {
  createSession(persona: PersonaTemplate, repoPath: string): Session
  run(session: Session, prompt: string): AsyncIterable<AgentEvent>
  resume(sessionId: string): Session
}
```

### Claude adapter

- Runs via Claude Agent SDK.
- System prompt + resolved skill content passed directly as the session's system prompt.
- Sandbox → SDK permission mode.
- **Known gap:** the SDK does not stream events during tool execution itself (e.g. a running Bash command) — only around it. Long-running tool calls appear to "think" silently until they resolve. Give this a different loading state than Codex's rather than faking progress.
- **Usage/cost:** the `ResultMessage` (TS: `SDKResultMessage`) returned at the end of a call includes cumulative `usage` (input/output/cache tokens) and `total_cost_usd` directly. This is a **client-side estimate from a bundled price table, not authoritative billing** — fine for in-app display, not for anything financial. When a turn uses multiple tools, per-step assistant messages can share an id; dedupe by id before summing to avoid double-counting.

### Codex adapter

- Runs via `@openai/codex-sdk` (`startThread()` / `run()` / `resumeThread(threadId)`).
- Sandbox → built-in presets: `read_only`, `workspace_write`, `full_access`.
- **Context injection — confirmed, with a caveat:** `developer_instructions` is a real, documented config field (<cite>"Additional developer instructions injected into the session"</cite>) distinct from `AGENTS.md`, settable via the SDK's `config` option without touching the user's repo. **However**, multiple open GitHub issues report it being unreliably applied — not injected in some app contexts, and at least one user couldn't confirm via trace logging that it was picked up in CLI sessions at all. **Treat as unverified until tested against the actual SDK version in use.** Fallback if it proves unreliable: write a scoped, session-specific instructions file and pass it via `model_instructions_file`, or fall back to a temporary `AGENTS.md` override in the repo (less clean, has filesystem side effects, but is the more battle-tested mechanism).
- Use `runStreamed()`, not `run()` — `run()` buffers until the turn completes; `runStreamed()` yields incremental events, including `CommandExecutionStatus` during tool execution (this is the live "running X" visibility Claude's adapter currently lacks).
- **Usage/cost:** the turn result exposes token counts (`input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_output_tokens`, `total_tokens`) but **no dollar figure** — unlike Claude's SDK, there's no bundled price table. We compute `cost_usd` ourselves from a small hardcoded per-model price table (maintain alongside the adapter; prices change, this will need occasional updates). Watch for double-counting: don't naively add `cached_input_tokens` on top of `input_tokens` — confirm whether cached is a subset or additive for the specific field names returned before writing the cost formula.

### AgentEvent normalization

Both backends stream text deltas, tool-call start/result events, support session resumption, schema-constrained structured output, and expose token usage. Normalize into one internal type; UI and cost logic branch only where the backends genuinely diverge (tool-execution visibility, presence/absence of a direct dollar cost).

### Not in scope for v1

Cursor SDK. The adapter interface supports adding it later with no redesign.

---

## 4. Data model

### Skill

```
Skill { id, name, description, content }
```

Reusable, library-level. Referenced by id from persona templates.

### PersonaTemplate

```
PersonaTemplate {
  id, name, avatar/color
  backend: "claude" | "codex"
  systemPrompt: string
  skillIds: string[]
  sandbox: "read_only" | "workspace_write" | "full_access"
  githubScope: "read_only" | "open_pr" | "full_access"   // independent of sandbox
}
```

### Contact

```
Contact {
  id, personaTemplateId, repoPath
  displayName                      // e.g. "Code Reviewer · my-app"
  backendSessionId: string | null  // resume key
}
```

**v1 scope: one persona template bound to one repo per Contact.** To reuse a persona on a second repo, clone it into a second Contact.

### Group

```
Group { id, repoPath }   // one per repo

GroupMessage {
  id, groupId, timestamp
  type: "system_summary" | "user_mention" | "agent_reply" | "routine_run"
  contactId?
  content: string
  category?: "decision" | "tradeoff" | "routine"   // system_summary only
  durable?: boolean                                  // system_summary only
}
```

A Group has **no backend session of its own** — it's a merged view and router. Every Contact's end-of-session summary posts here as `system_summary`; @mentioning a Contact resolves to that Contact's real session via the same `AgentAdapter.run()` used in 1:1 threads; scheduled routine runs (Section 7) post as `routine_run`.

### Routine

```
Routine {
  id, contactId
  schedule: string          // cron expression
  prompt: string             // what to do on wake, e.g. "Check for newly reported issues and address trivial ones"
  enabled: boolean
  lastRunAt: timestamp | null
  lastRunSummary: string | null
}
```

### UsageEvent

```
UsageEvent {
  id, contactId, timestamp
  source: "message" | "routine"
  inputTokens, outputTokens, cachedInputTokens?
  costUsd: number | null   // Claude: from SDK. Codex: computed from price table.
}
```

Logged per turn, not aggregated in place — keeps full history for a spend-over-time view and avoids race conditions on a running total.

### Composition flow

```
Skill library → PersonaTemplate → Contact (bound to repo) → Session (Claude/Codex)
                                        ↓                          ↓
                                   Routine (schedule)          UsageEvent (per turn)
                                        ↓
                                 Group (repoPath) ← auto-summaries + @mentions + routine runs
```

---

## 5. Context injection

- **Claude:** `systemPrompt` + resolved skill content, passed directly as the session's system prompt.
- **Codex:** same content, passed via `config.developer_instructions` (Section 3), with the noted reliability caveat and fallback.
- **Both:** on session start, also inject the last N `durable` GroupMessages for that repo plus the last N `routine` ones (Section 6).

---

## 6. Shared context and compaction

**Filesystem state is free** — every session reads the live repo on disk, so code changes are automatically visible across Contacts.

**Intent and rationale are not free** — they live in a private conversation and need the Group layer to cross Contact boundaries.

### Compaction rule

At session end, request a structured summary instead of free text:

```
{ summary: string, category: "decision" | "tradeoff" | "routine" }
```

- `decision` / `tradeoff` → `durable: true`, kept indefinitely, always injected. This is the running decision log for the project.
- `routine` → `durable: false`, only the most recent N are injected; older ones remain queryable in SQLite but aren't surfaced.

### Known limitations

- No real-time sync between two Contacts running simultaneously on the same repo. Mitigation: one active session per repo at a time, enforced as a soft rule in the router.
- The Group/journal layer is for intent, not conflict resolution — git remains the safety net for code-level conflicts.
- Same concurrency rule applies to routines (Section 7): a scheduled wake should not fire if another session is already active on that repo — queue or skip, don't run in parallel.

---

## 7. Routines (scheduled wake tasks)

**Do not use Codex's or any vendor's native scheduling.** Codex's scheduled tasks are a cloud-only feature of chatgpt.com/codex, not exposed via the CLI or SDK, and even the desktop app's automation feature has an open bug where the scheduled prompt sometimes never gets injected into the run. Build scheduling ourselves, in the Electron main process, calling the same `AgentAdapter.run()` used everywhere else.

**Mechanism:**

- `node-cron` in the main process holds all enabled `Routine`s, scheduled from their cron expression on app startup.
- On fire: check the concurrency rule (Section 6) — skip or queue if the repo already has an active session — then call `AgentAdapter.run(contact.session, routine.prompt)` exactly as a user-sent message would.
- Result is appended to the Contact's normal message history (so opening the contact shows what it did while "asleep") and posted to the repo's Group as a `routine_run` message.
- Log a `UsageEvent` with `source: "routine"` — routines are unsupervised and can otherwise accumulate spend silently, which is precisely why usage tracking (Section 4) matters here more than anywhere else in the app.
- Optional: OS-level notification when a routine completes, especially if it opened a PR or flagged something needing review.

**Safety default:** a routine's persona should default to a constrained `githubScope` (`open_pr`, not `full_access`) — an unattended task should propose changes via PR, not push to a branch unsupervised. This is the same governance axis already defined on `PersonaTemplate` (Section 4), just more load-bearing here than in interactive use.

**Background/tray requirement:** routines are useless if they only fire while the app window happens to be open. On window close, the app must stay resident via a system tray icon (Electron `Tray` API, no extra package) rather than quitting — `node-cron`'s schedules live in the main process, which keeps running as long as the app does. Tray menu: show window, list next-scheduled routines, quit. This is a hard requirement for Section 7 to actually work, not a nice-to-have.

---

## 8. @mention / Group behavior

- Typing `@` in the Group thread opens a `cmdk`-based picker filtered to Contacts bound to that repo.
- Selecting a Contact and sending routes to that Contact's real backend session via the standard adapter `run()` call; the reply streams back as `agent_reply`.
- **v1: single-target mention only** — no broadcast, avoiding the concurrency problem in Section 6.
- 1:1 threads and the Group thread render messages from the same underlying sessions — no duplicated conversation state.

---

## 9. GitHub integration

**Auth:** OAuth Device Flow (`@octokit/auth-oauth-device`) — no local redirect server needed, and matches the pattern Codex's own SDK already uses for its login, so it's consistent with the rest of the stack. Store the token via Electron's `safeStorage` API, not plaintext.

**Two responsibilities:**

1. **Repo discovery/binding** — `NewContactFlow`'s repo picker lists the user's actual GitHub repos via the API instead of a manually-typed path; offers to clone if not present locally.
2. **Remote actions** — pushing branches, opening PRs, commenting — via GitHub REST API calls (Octokit) from the main process, not by trusting the agent to shell out raw git commands unsupervised. Surface as an explicit action (e.g. "Open PR" button), not an automatic side effect — this matters even more for routine-triggered runs (Section 7).

**Governance:** `githubScope` on `PersonaTemplate` is a permission axis independent of the filesystem `sandbox`.

---

## 10. UI/UX — component mapping

| Concept               | Data                                  | Component                                                                                           |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sidebar list          | `Contact[]` + `Group[]`               | `ConversationList`                                                                                  |
| 1:1 thread            | Resume `Contact.backendSessionId`     | `ThreadView`                                                                                        |
| Group thread          | `GroupMessage[]`                      | `GroupThreadView`                                                                                   |
| Sent/received message | —                                     | `MessageBubble` (outbound/inbound)                                                                  |
| Streaming state       | Active `AgentEvent` stream            | `StreamingIndicator`                                                                                |
| System/journal notice | `GroupMessage` type `system_summary`  | `JournalNotice`                                                                                     |
| Routine run notice    | `GroupMessage` type `routine_run`     | `RoutineRunNotice` — visually distinct from a live reply, since no one was watching when it ran     |
| @mention picker       | Contacts scoped to repo               | `MentionPicker` (`cmdk`)                                                                            |
| New persona/contact   | `PersonaTemplate` + repo bind         | `NewContactFlow`                                                                                    |
| Persona detail/edit   | `PersonaTemplate` fields              | `PersonaDetailPanel`                                                                                |
| Skill library         | `Skill[]` CRUD                        | `SkillLibraryView`                                                                                  |
| GitHub connect        | OAuth device flow state               | `GitHubConnectDialog`                                                                               |
| Open PR action        | Post-session action                   | `OpenPRButton`                                                                                      |
| Routine setup         | `Routine` CRUD on a Contact           | `RoutineEditor` — schedule picker + prompt field                                                    |
| Usage/cost display    | `UsageEvent[]` aggregated per Contact | `UsageBadge` (inline, per contact in sidebar) + `UsageDashboard` (spend over time, by persona/repo) |

---

## 11. Tech stack

| Layer                    | Choice                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                    | Electron                                                                                     | Process/session management, background residency for routines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Renderer framework       | React                                                                                        | Standard Electron pairing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Styling / components     | Tailwind + shadcn/ui                                                                         | `Command` (built on `cmdk`) fits the @mention picker directly; `Dialog`/`Sheet`/`Popover` cover persona editor, new-contact flow, skill library, routine editor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Main↔renderer bridge     | Hand-rolled typed IPC layer (`ipcMain.handle`/`ipcRenderer.invoke` + Zod-validated contract) | **Resolved during Phase 1 planning (2026-08-15):** `electron-trpc` was verified stale (last release ~20 months prior) with open, unresolved GitHub issues hitting this exact toolchain (tRPC v11 incompatibility, `moduleResolution: Bundler` incompatibility) — see `docs/plan/00-progress.md` decisions log for citations. Superseded by a hand-rolled `src/shared/ipc-contract.ts` (procedure name → Zod input/output schema) plus a request/response bridge and a streaming bridge for `AgentEvent`s (event-based push over a per-session channel, replacing tRPC subscriptions). End-to-end type safety preserved; revisit `electron-trpc` only if it ships a maintained v11-compatible release. |
| Data fetching/cache      | TanStack Query                                                                               | Every renderer read is an async call across a process boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Local UI/ephemeral state | Zustand                                                                                      | Cross-component state that isn't persisted (e.g. which Contact is currently streaming)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Scheduler                | `node-cron`                                                                                  | Runs in main process; drives Routines (Section 7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Storage                  | SQLite (`better-sqlite3`)                                                                    | Resumable local agent session state; synchronous, no server process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Query/schema layer       | Drizzle ORM (optional)                                                                       | Typed, lightweight — cuttable for time if the schema stays this small; hand-written SQL is a reasonable v1 substitute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Claude backend           | `@anthropic-ai/claude-agent-sdk`                                                             | Main process only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Codex backend            | `@openai/codex-sdk`                                                                          | Main process only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GitHub auth + API        | Octokit (`@octokit/rest`, `@octokit/auth-oauth-device`)                                      | Device flow matches existing SDK auth pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Secret storage           | Electron `safeStorage`                                                                       | OS keychain-backed encryption for GitHub token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Validation               | Zod                                                                                          | Backs the hand-rolled IPC contract's input/output schemas; also used for SDK structured-output schemas (compaction summaries)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Markdown/code rendering  | `react-markdown` + `shiki`                                                                   | Agent responses routinely contain code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## 12. SQLite schema (rough)

- `skills` — id, name, description, content
- `persona_templates` — id, name, backend, system_prompt, skill_ids (json), sandbox, github_scope
- `contacts` — id, persona_template_id, repo_path, display_name, backend_session_id
- `groups` — id, repo_path
- `group_messages` — id, group_id, timestamp, type, contact_id, content, category, durable
- `messages` — id, contact_id, role, content, timestamp
- `routines` — id, contact_id, schedule, prompt, enabled, last_run_at, last_run_summary
- `usage_events` — id, contact_id, timestamp, source, input_tokens, output_tokens, cached_input_tokens, cost_usd

---

## 13. Deliberate v1 scope cuts

- Cursor backend: adapter interface supports it, not implemented.
- Persona-to-repo binding: one-to-one only.
- No real-time sync between concurrent sessions on the same repo; routines respect the same soft lock.
- No semantic/vector search over history — durable/routine recency-based recall only.
- @mention is single-target only, no broadcast.
- GitHub scope enforcement is a permission label on the persona, not hard-enforced beyond what the token itself allows.
- No hard budget cap enforcement on usage — `UsageEvent` logging and display only in v1; pausing a Routine automatically after a spend threshold is a natural next step, not built now.
- Routine scheduling is single-repo, single-prompt per Routine — no cross-repo fan-out.

## 14. Open items to verify in the first build session

1. Confirm `config.developer_instructions` actually reaches the Codex model in practice (Section 3) — multiple open community reports of it being dropped. Have the `model_instructions_file` / `AGENTS.md` fallback ready.
2. Confirm whether Codex's `cached_input_tokens` is additive or a subset of `input_tokens` before writing the cost formula (Section 3) — a third-party integration was found double-counting this.
3. Build/verify the Codex per-model price table for cost computation, since the SDK doesn't return one.
4. Tune durable-entry retention — at what point the decision log itself needs periodic re-summarization (not built in v1).

---

## 15. Cross-cutting decisions (resolved on final review)

Five gaps surfaced doing a full pass over the design that weren't covered by any single section above. Resolved here rather than left implicit.

**A. Claude/Codex authentication (app-level, distinct from GitHub auth in Section 9).** Codex's SDK already handles this: <cite>existing Codex authentication is reused automatically</cite>, with its own device-code browser login if none exists. Mirror this for Claude — on first run, check for existing Claude Code CLI auth on the machine; if absent, prompt for an `ANTHROPIC_API_KEY`. One-time first-run onboarding step, not a per-persona setting.

**B. Tool-action approval model.** Both SDKs support per-action approval callbacks (Claude's `canUseTool`, Codex's `approval_policy`), but pausing a chat mid-response for a permission dialog is a poor interaction and defeats the point of setting a sandbox level. **v1 decision: the sandbox level, set once at persona-creation time, is the approval — no per-action interrupts during a run.** State this plainly if a security-minded stakeholder asks; it's a deliberate v1 simplification, not an oversight.

**C. Failure states.** Errors (rate limit, sandbox denial, network failure) render as a distinct error-type bubble in the same thread/Group message log as everything else — not a silent failure, not a separate console. Keeps live debugging fast if something breaks during the demo, which the exercise explicitly expects might happen.

**D. Concurrency lock implementation.** "One active session per repo at a time" (Sections 6, 7) is enforced via a simple in-memory map in the main process: `repoPath → boolean busy`, checked before starting any run (message, @mention, or routine fire) and released on completion. Sufficient for a single-user local app — no need for anything heavier.

**E. Background/tray behavior.** See Section 7 — required, not optional, since routines can't fire if the app quits on window close.

---

## 16. Critical user journeys (for the demo)

Three journeys, chosen to each exercise a different part of the architecture and map to a different stakeholder's priorities in Part 2, rather than three variations on "send a message."

### Journey 1 — Configure a persona and get real, scoped work done

_Exercises: PersonaTemplate/Skill/Contact model, backend adapter, sandbox enforcement, context injection._

1. Create a persona template ("Code Reviewer") — system prompt, attach 1–2 skills, pick backend (Claude), set sandbox to `read_only`.
2. Bind it to a repo via the GitHub repo picker → creates a Contact.
3. Send it a message ("review the changes in `auth.ts`").
4. Response streams in, respects the read-only sandbox (no edit attempts), reflects the injected skill.

The foundational loop. Simplest to guarantee live; if this doesn't work, nothing else matters.

### Journey 2 — Two personas coordinate on the same repo via the Group

_Exercises: Group/GroupMessage, compaction (decision vs. routine), @mention routing._

1. Run "Refactor Buddy" (`workspace_write`) on a repo — it renames something and states a rationale.
2. Its structured end-of-session summary posts to the repo's Group as `system_summary`, marked `durable`.
3. Open "Code Reviewer," scoped to the same repo — its first response references the refactor without being told manually.
4. From the Group thread, `@mention` a third persona and get a live reply routed to its real session.

The differentiated moment: proves this is coordinated, not three parallel chatbots. Answers the "so is this actually multi-agent, or just separate windows" question directly.

### Journey 3 — A routine wakes up, does bounded autonomous work, and reports cost

_Exercises: Routine/scheduler, tray/background residency, GitHub PR action, UsageEvent tracking, governance (`githubScope`)._

1. Set up a routine on a persona ("check for newly reported issues daily, fix trivial ones") with `githubScope: open_pr`.
2. Trigger it live via a manual "run now" button — same code path as the scheduled fire, used for demo reliability rather than waiting on real cron.
3. It reads the repo/issues, makes a change, opens a PR (not a direct push) — visible via `OpenPRButton`/GitHub.
4. The run posts to the Group as `routine_run`; token/dollar cost appears on the persona's `UsageBadge`.

The governance and cost story: autonomous, but bounded (PR not push) and visible (cost tracked, not silent spend). Note for Part 1 if asked: the manual trigger is a deliberate demo-reliability choice — the underlying code path is identical to a real scheduled fire, not a shortcut around it.
