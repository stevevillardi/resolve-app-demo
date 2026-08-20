# Switchboard — Architecture

A desktop app where each contact is a persistent AI persona you message like a
person. It does not run models of its own: it is an orchestration and interface
layer over the Claude Agent SDK and the Codex SDK, managing persona definitions,
routing messages to the right session, keeping conversation and project history,
tracking spend, waking personas on a schedule, and rendering all of it as a chat
client.

This document is the design record. It says what is true of the code and, where
the reason is not obvious from reading it, why. Anything asserted here as
measured was measured — the app is built against two vendor SDKs whose behaviour
routinely differs from their documentation, and the difference is usually the
interesting part.

---

## 1. The shape of it

Three nouns, composed:

```
Skill ──┐
        ├──► PersonaTemplate ──► Contact ──► Session
Model ──┘         (what it is)   (+ a repo)   (a real agent run)
                                     │
                          Routine ───┤        Group  (one per repository)
                        (a schedule) │      ▲
                                     └──────┘  summaries · @mentions · routine runs
```

- A **Skill** is reusable instruction text. In this app a Skill is *injected
  prose* — never something the model executes. (Claude Code and Codex also have
  a thing called a skill, which *is* executable and is discovered from disk.
  Two words that mean two things; the interface keeps them apart, and so should
  you.)
- A **PersonaTemplate** is a backend, a model, a system prompt, a set of Skills,
  and two independent permissions: what it may touch on disk, and what it may do
  on GitHub.
- A **Contact** is a persona bound to one repository. Messaging it runs a real
  agent session against a real working tree.
- A **Group** is one shared thread per repository, where every Contact working
  in that repo posts what it decided. It has no session of its own — it is a
  view and a router.

Single user, local, no server. Everything lives in one SQLite profile under
Electron's `userData`.

---

## 2. Process boundary

The renderer never touches the filesystem, SQLite, the SDKs, or the scheduler.
It calls typed procedures over IPC and renders what comes back.

**There is no tRPC.** `electron-trpc` was rejected on a maintenance check —
stale, with open issues against exactly this toolchain (tRPC v11,
`moduleResolution: Bundler`). The bridge is hand-rolled: `src/shared/ipc-contract.ts`
maps every procedure name to a Zod input and output schema and is the single
source of truth, dispatched by name over one `ipc-invoke` channel.

**Streaming is a separate push channel keyed on a `runId`, not a session id.**
A session id does not exist until mid-stream, so main mints a `runId`
synchronously when a message is sent. One channel carries every run, filtered by
`runId` in preload. `done` is emitted only after persistence completes — a
renderer that reacts to `done` by invalidating its query must not be able to
refetch before the assistant row exists.

**Nothing under `src/main/adapters/` may import `electron` or the database.**
Everything machine-specific — the Codex binary path, environment, resolved
Skills, group context, the usage baseline — arrives through `AdapterConfig` and
`SessionSpec`, built in exactly one place, `src/main/services/adapter-host.ts`.
That constraint is what lets `npm run probe:adapters`, `probe:structured` and
`probe:mcp` drive the real SDKs outside Electron.

**The domain model is shared, not renderer-local.** `src/shared/domain.ts` holds
the Zod schemas that the Drizzle tables, the IPC contract and the renderer all
read. `src/shared/` has exactly one runtime dependency, zod — which is why cron
validation is an IPC procedure rather than a shared module. Putting `node-cron`
in shared would ship a scheduler into the renderer bundle.

**The renderer is lint-barred from importing `src/main`.** Rules both sides need
live in `src/shared/locking.ts` as one implementation. This is not tidiness: the
composer once predicted main's lock answer with a second reading and got it
wrong three ways.

**Push channels emit from insert chokepoints, never from callers** —
`messages-changed` from the insert functions, `usage-changed` from
`recordUsage`, `runs-changed` from the run registry. A background turn with no
component subscribed still refreshes previews, badges and totals.

---

## 3. Backend adapters

One interface, one implementation per backend:

```ts
createSession(spec: SessionSpec) → AgentSession
run(session, prompt) → AsyncIterable<AgentEvent>
resume(sessionId) → AgentSession
summarize(...)                      // structured output, see §6
```

`createSession` takes a spec object rather than `(persona, repoPath)`, because
Skill content, group context, writable paths and repo skills all have to arrive
from outside the adapter.

`AgentCapabilities` **reports divergence rather than hiding it**:
`sandboxEnforcement: 'os' | 'policy'`, `supportsStructuredOutput`,
`streamsTextDeltas`, `streamsToolProgress`, and which route repo skills take.
The same persona setting means materially different things on the two backends,
and the type says so instead of pretending otherwise.

### Normalization traps, all found live

- **Claude emits assistant text twice** — `text_delta` for a block, then the same
  block whole as `text_message`, overlapping rather than sequential. A consumer
  that appends both renders every reply twice. Codex only ever emits
  `text_message`. What gets persisted is neither: `done.finalText`.
- **An unmodelled SDK message type must be ignored, never thrown.** Claude's
  `SDKMessage` union has 35+ variants and grows. A thrown failure must still
  produce `error` then `done` — and failures do not always arrive as events, since
  an expired Codex login rejects `runStreamed()` outright.
- **`@openai/codex-sdk` is ESM-only and main is CommonJS.** `codex.ts` uses
  `await import()`, which electron-vite preserves verbatim. Do not tidy it into a
  static import.
- Both SDKs ship a vendored native binary that cannot execute from inside an asar
  archive, so both are `asarUnpack`ed and resolved out of it at runtime.

### Usage accounting

This is the part where the documentation is most misleading.

- **Claude: read `modelUsage` off the final result. Never sum, never dedupe.**
  A captured multi-tool turn had 15 assistant messages across 7 distinct ids;
  deduping and summing those 7 gives **13 output tokens against an actual 1045**,
  because the per-message `usage` is a running snapshot rather than an increment.
- **Claude's usage under resume is per-turn; Codex's is cumulative.** Three turns
  on one resumed Claude session cost `$0.2273`, `$0.2268`, `$0.0116` — a
  cumulative figure cannot go down. The same shape on Codex: output `5 → 10 → 15`,
  input `12122 → 25610 → 39114`. Every Codex usage row after the first
  over-reported by a margin that grew with the conversation. Fixed by
  `usage_events.session_id` plus `baselineFor()`, which sums the deltas already
  recorded for that session — every stored row *is* a delta, so their sum is
  exactly the backend's next cumulative reading, with no separate cursor to keep
  in step.
- **The first turn of every Claude session was attributed to the wrong model.**
  The SDK makes an internal Haiku call at session start and it out-talks the main
  loop: Haiku 521 in / 11 out / `$0.000576` against Sonnet's 2 in / 5 out /
  27,911 cache-write / `$0.167547`. Attribution picks by cost, with output tokens
  as the tiebreak — cost is the honest tiebreak for a figure that is itself a
  cost.
- **Codex's `cached_input_tokens` is a subset of `input_tokens`**, not additive.
  Settled by the CLI's own `input + output = total_tokens` arithmetic.
- **An unpriced model reports `costUsd: null`, never `0`.** A null cached figure
  means "no discount", billed at the input rate — never free.
- **Long context is priced per request, not per conversation.** The long rates
  select on one turn's own input tokens; missing that under-reported a long turn
  by 47%. They are not a uniform multiplier — input and cached double while
  output rises by half.

**Codex is always given an explicit model.** Its event stream never names one and
`~/.codex/config.toml` can pick a different one per machine, so an implicit model
means pricing against a guess. Model availability is account-dependent: a
ChatGPT-account user gets a 400 on some ids. Neither SDK exposes "what can this
account reach", so the model menus and the price table are hardcoded with a
verification date (§14).

Two more measured facts about Codex: `codex login status` **does not detect
expired credentials** — it exits 0 against a consumed refresh token while every
turn 401s — and Codex **will not start outside a git working tree**, where Claude
reads and edits a plain folder happily. The second is caught at bind time rather
than at first send.

### Sandboxing

Enforcement is **OS-level on both backends**. This app's shell rules are a second
deny layer, not the policy.

Claude uses `Options.sandbox` with `failIfUnavailable: true` — no writable path
at `read_only`, the repo only at `workspace_write`. Codex uses its own presets.
Two things about that are worth knowing before changing any of it:

- **`canUseTool` is not a complete mediator.** The SDK's classifier decides first
  and only consults us about tool uses it would otherwise prompt for. `echo hello`
  and `pwd && ls` never reach our evaluator. At `read_only`, `disallowedTools`
  strips the write tools outright rather than relying on the callback.
- **The escape hatch was the real hole.** `sandbox.allowUnsandboxedCommands`
  defaults to **true**. A `workspace_write` persona asked to write outside its
  repo was denied, reissued the identical command with
  `dangerouslyDisableSandbox`, and the SDK honoured it — the file landed in
  `/tmp`. It is now false, and the shell guard denies any Bash carrying that flag
  below `full_access`, so the refusal still holds where there is no OS sandbox to
  configure.

**The same persona setting means two boundaries.** Codex's `workspace-write`
permits `/tmp` as well as the workspace; Claude's permits only the repo. Windows
has no sandbox implementation and reports `sandboxEnforcement: 'policy'` honestly
rather than claiming a guarantee it cannot make.

A hand-rolled shell parser is the wrong instrument, and this codebase proved it:
`find . -delete`, `find . -exec rm {} +`, `sed -ni`, `sed --in-place`,
`git branch -D` and `git -c diff.external=…` all walked through the first
allowlist. Every one was found by *executing* the guard over adversarial input,
not by reading it.

---

## 4. Data model

Ten tables. The parts that are not obvious:

**Isolation is per Contact, chosen at bind time, and mutable afterwards.** Per
Contact rather than per persona, because the same persona may want its own
checkout on one repo and not another. `shared` works in the main tree,
`worktree` in a checkout and branch of its own, `exclusive` in the main tree
while holding the write lock. `repo_path` always means the canonical repository.

**`branch` outlives `worktree_path`.** De-isolating removes the directory and
keeps the branch, because the Branches panel attributes a branch to a Contact by
that column — nulling it would orphan committed work.

**`repo_path` is immutable.** Re-pointing a Contact at another repository moves
its messages and tool calls in one transaction rather than deleting them. Spend
stays with the old Contact, and routines travel **disabled**: a 3am job written
for one repository firing against another is exactly the surprise this app exists
not to produce.

**Delete semantics: block a persona, detach a Skill.** Deleting a persona with
bound Contacts is refused by name. Deleting a Skill succeeds and strips its id
from every persona in one transaction — a Skill is injected text, so losing one
degrades instructions rather than breaking the persona.

**`messages` has no status or error column, deliberately.** Those describe a turn
in flight; a message loaded from disk is by definition finished. A failed turn is
*computed* by the renderer — the last row is the user's, no run is in the store,
none is in main's active set — never stored. Persisting it would require a policy
for a deliberate Stop, which would durably label the user's own interruptions as
failures.

**A message is stamped with the session that answered it at turn end**, not at
insert. On a first turn the session id does not exist yet, and on the
dead-key self-heal path an insert-time stamp would draw a session boundary
between a question and its own answer. Null means "not recorded" and the
renderer reads it as inheriting.

**Spend outlives what spent it.** `usage_events.contact_id` is
`ON DELETE SET NULL`, with the persona id and repo path denormalised onto each
row as **plain text, not foreign keys** — the point is precisely to outlive the
rows they came from. Each event records the model that actually ran, not the
persona's current setting: prices differ by an order of magnitude between models,
so reading spend off a current setting reprices history on every switch.

**Seeding is guarded by a marker, not by emptiness.** Seed-when-empty silently
resurrects content the user deleted. Contacts and Groups are never seeded — they
bind to a real repository path that nothing can know in advance.

**A Group is a view, not a record.** It can be renamed (a null name derives from
the repo path) and hidden, but never deleted: removing the row only means it is
recreated on the next turn with its read boundary reset, lighting up every old
message as unread.

---

## 5. Context injection

`composeInstructions` builds the system prompt from the persona's prose, the
resolved Skill content, the group context, a working-directory block, and any
repository instructions the user has opted in to.

`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` splits the prompt into a cacheable prefix and a
dynamic tail. Only Claude honours the split; Codex has no cache-breakpoint
mechanism and simply joins, so its prompt ordering is a convention pinned by test
rather than by the SDK.

**A session running outside its repository gets a "Where you are working"
block** naming its directory, its repo and its branch, and saying not to write
into `.git` or into the repository itself. This exists because a model asked to
create a file with a bare relative name resolved it against the *git admin
directory* — right basename, wrong parent. It was found only live, and no unit
test could have caught it: every one mocks the adapter, and a mocked adapter
never resolves a path.

**Each session is told about open sibling branches** by main, rather than
discovering them. `git branch` and `git worktree` are deliberately off the
read-only allowlist — `worktree` cannot be permitted for listing alone, because
add, remove and prune share the token.

**Repo skills are native on Codex and injected on Claude.** The Claude SDK's
`skills` option is a *filter over what was discovered, not a discovery
mechanism*, and making them discoverable requires `settingSources: ['project']` —
one switch for six things, including `.claude/settings.json`'s Bash permission
grants. So Claude keeps `settingSources: []` and receives an app-composed
catalogue instead; Codex uses its own machinery.

---

## 6. Shared context and compaction

Filesystem state is free — every session reads the live repository, so code
changes are visible across Contacts without anything being said. **Intent is not
free.** It lives in a private conversation, and the Group layer is what carries
it across Contact boundaries.

At the end of every turn a summariser classifies what happened into
`decision`, `tradeoff` or `routine`. The first two are durable and injected
indefinitely; routine ones age out. **The category descriptions in
`src/shared/summary.ts` are load-bearing prose, not documentation** — they are
the only instruction the model gets about where the line falls, and durability is
derived from the answer. They judge what the turn *left behind*: if the
repository changed, it is not routine. An earlier wording asked in effect how
much the agent had deliberated, and a real edit to an auth file came back
`routine`, which would have dropped it out of every colleague's context.

**Compaction is a separate adapter capability, not a flag on `run()`,** because
the SDKs are shaped differently. Claude's structured output is *session-level*,
so it cannot be switched on for a live conversation's final turn; Codex's is
*per-turn*. Codex also runs its schema through OpenAI's **strict** mode, where
`required` must list every key — an optional field is a hard 400. Optionality is
therefore expressed as a nullable type, which Claude accepts too, so one schema
serves both.

**The summariser is a throwaway session on a cheap model.** It takes no lock and
emits no events. It runs after *every* turn, so pinning it to the persona's model
would roughly double an Opus-class persona's cost for what is classification.
Every failure is swallowed and logged: the turn was already committed, so a
missing Group entry is the correct degradation.

**Context is fetched as two queries, not one** — 50 durable entries plus 5 recent
routine ones — precisely so routine chatter cannot bury the decision log.

**Durable-entry retention is deferred, and that is the decision.** No retention
pain has been observed, and a cap invented without a measured workload is
governance theatre: the wrong number, enforced confidently. The trigger to watch
is a group whose durable entries alone approach the injection cap.

### The context meter

Window sizes are a **dated table, not a measurement**
(`src/shared/context-windows.ts`). Seven Claude ids hold 1M tokens; only Haiku
4.5, Sonnet 4.5 and older are on the 200k tier. All eight were once recorded at
200k, so the meter divided by a fifth of the real window and reported a
half-full prompt as full — inviting the user to throw away the model's memory to
fix a problem they did not have.

Four of the wrong rows were marked `published`. **The transferable lesson is
about `source`, not the numbers:** it records how a figure was *obtained* and
says nothing about whether it is still true. `CONTEXT_WINDOWS_LAST_VERIFIED` is
the field that carries currency, and it is the one to read first.

A model with no row shows **no percentage at all** — a tested path, not a
comment. Lookup is by exact id, then by the id with a trailing date suffix
stripped; there is no prefix or fuzzy match, because a near miss resolving to a
different model's window is the exact failure the table exists to avoid.

The numerator is the last request's prompt, never the session's billed input. One
number named `promptTokens` was, on Codex, the sum of the session's deltas — the
*bill*, 3× high by turn three and unbounded. Both figures are shown, because the
gap between them is the forever-thread problem stated as a number.

---

## 7. Routines

`node-cron` behind an injectable engine port, in the main process, calling the
same code path a typed message does.

**Missed fires are recorded, never caught up.** node-cron arms one timer to the
next match and runs a slot only if it is barely late; it persists nothing and
offers no exactly-once guarantee. A 09:00 routine on a sleeping machine is
skipped outright. Misses are counted and stamped, and surface in three places —
**Run now is the catch-up.** Any recorded attempt clears the count while the
stamp survives.

**Overlap is guarded by our own in-flight set, not node-cron's**, which cannot
see the manual Run now path — the collision most likely to happen while somebody
is watching.

**A turn's completion is a promise, never a callback.** The finish routine does
its work inside a `finally`, where a consumer that threw would replace the
in-flight error path and corrupt every turn's teardown. The invariant — it is on
every path out of a run, settles exactly once, and never rejects — is tested on
the clean, throwing and aborted paths, plus "the lock is already released when it
resolves".

**A routine's bookkeeping is recorded before any network call, never after.** A
hung request must not leave a fire that plainly happened looking like it never
did. The last-run stamp is written on every *attempt*, including a lock refusal.

**Run history is omitted from both write shapes**, so an editor left open across
a fire cannot save its stale copy over what the fire recorded.

**Tray times are absolute, never a countdown.** A menu is a static snapshot, so
"in 12 minutes" begins lying the moment it is drawn — which is also what removes
any need to refresh it.

**Budgets are soft, and alert once per month per scope.** Nothing is ever
stopped, and the copy says so. The accepted corollary: a month of entirely
unpriced turns has a floor of $0 and never alerts.

**A 10-minute watchdog measures silence, not duration** — a thorough turn
legitimately runs half an hour emitting tool events. The timeout flag is
load-bearing, because both adapters answer an abort with a SIGTERM-shaped error
that would otherwise overwrite the real reason the turn stopped.

**Crash reconciliation is one synchronous statement at boot**: every tool call
still marked running is swept to failed before IPC is wired, since the run
registry is empty by construction at process start.

---

## 8. Groups, mentions, and the concurrency lock

**An @mention is a message, not a new kind of turn.** It shares the same
function as a normal send — same lock, same session resume, same run id, same
message rows — and adds only the Group's own record. Because the run store is
keyed by Contact, the 1:1 thread and the Group thread render one piece of state
rather than two copies that can disagree.

**A refused mention or send writes nothing in either table.** A persisted
question that nothing will answer reads as a lost message rather than as a
refusal.

**The lock is a write lock on a working path, not a busy flag on a repository.**
A `read_only` session takes a **shared** hold and is **refused by nobody**;
anything that can write takes an **exclusive** hold; only writer-versus-writer
serialises. Shared holders are still recorded, because the fleet indicator has to
be able to name everyone running.

This function was got wrong in both directions before it was right — first a
reader was refused by a writer, then a writer by any holder — and each time the
tests agreed with the code. It is the standing argument for writing tests from
the claim rather than from the implementation.

The lock mode reads both the sandbox level and the isolation setting. Only
`exclusive` isolation overrides the sandbox level, that being the mode whose
entire purpose is to demand the main tree, so it locks even for a reader.

**Retry reuses the persisted user row** rather than re-sending, because a
re-send would duplicate the question into history, previews, unread counts and
the summariser's input.

---

## 9. GitHub

Octokit behind a port. Auth is OAuth device flow, with the token sealed by the
OS keychain.

**PR state is not a table.** GitHub already knows whether a branch has an open
pull request, so it is a cached read rather than a row that goes stale the moment
somebody merges in a browser. A second Open PR attempt comments on the existing
PR instead of opening a duplicate.

**Scope is enforced in the service, not in the button.** Hiding `OpenPRButton`
was once the entire enforcement, while the procedure behind it stayed callable by
anything that could reach the bridge.

**Scope was enforced against MCP tool names and not against the shell.** The
acceptance check "a read-only persona cannot comment" failed on both backends:
the MCP layer refused correctly, the model said so in its reply, and then ran
`gh issue comment` from Bash and the comment appeared on the issue. A developer
machine has `gh`, `git` and `curl` with their own credentials. The axis now
applies to Bash as well.

Two limits are stated rather than papered over. At `full_access` nothing in this
app is consulted at all, so the app **refuses that combination**: full disk
access forces full GitHub scope, and the persona form makes the refused pairing
unrepresentable rather than validating it after the fact. And the shell guard is
a **deny list over command text, not a boundary** — it raises walking around the
axis from "type the obvious command" to "deliberately work around a stated
restriction". The only real fix is scrubbing ambient credentials out of the
subprocess, which is not done.

**The GitHub token reaches only a session that actually holds the GitHub tool
server**, and defaults closed. It used to sit in every persona's environment
behind a comment claiming a persona is never given a shell that could echo it —
measured false at `workspace_write`.

**Cloning never leaves a token on disk.** git writes the URL it is handed
verbatim into the repository config, so the remote is scrubbed as part of the
clone. Recorded as *not* fixed: the token is still visible in the process
argument list while git runs. Relatedly, git's stderr is never passed through,
because a remote URL can carry a live token.

**The app never authors a commit on a turn or a routine path.** A human click
may commit a branch's uncommitted work, with the persona as author and the user
as committer, and is refused while a run holds that worktree.

**The repo picker pages, it does not search.** GitHub's search endpoint has no
concept of "repositories I can reach", and its index lags a freshly created
repository by minutes — exactly when someone is binding one.

**Connectivity state is what GitHub last said, not whether a token file
exists**, so a revoked token cannot keep a green dot. And a decrypt failure keeps
the credential and reports a locked state worded to blame the binary rather than
the credential: macOS binds the keychain seal to the app's code signature, so
every rebuilt development binary was silently erasing the token.

---

## 10. Interface

A three-pane shell: an icon nav rail, a resizable list panel, and a content pane,
with Chats, Personas, Skills, Routines, Usage and Home each master–detail.
**Supporting screens are workspace views, not overlays.** Only the new-contact
flow and the GitHub connect dialog stay modal — short, decision-shaped flows you
finish and dismiss.

**Panes measure themselves with container queries, not the window.** Viewport
breakpoints could never fire correctly here, because the thing that actually
varies is the resizable pane.

**The pane touching the nav rail keeps its first 90px clear.** The collapsed rail
is 64px and the macOS traffic-light cluster spans the window's first 71px, so a
full-height rail border draws a line through the green button. One exported
`PANE_STRIP` carries all three load-bearing properties — a continuous surface
colour, the window-wide hairline, and the draggable region a pane that omits it
loses. It was hand-rolled in four places, which is why the first fix leaked onto
the empty-profile screen that every fresh install sees first.

**Errors render as a distinct bubble in the same thread as everything else** —
never silently, never console-only. A *refused* send is different: it renders as
an inline notice under the composer, because no turn ran.

**The composer does not clear itself.** Whether a send was accepted is the
owner's knowledge, and clearing synchronously was what made a lock refusal
destroy the message it was refusing. Drafts live in memory and deliberately not
in localStorage — a resurrected week-old draft surprises more than it helps.

**An unknown cost renders as an em dash in the app and an empty cell in an
export, never a zero.** In a spreadsheet there is nothing left to explain it and
someone will sum the column.

Icons in `build/` and `resources/` are **generated** from the SVG beside them
(`npm run icons`) — hand-editing a PNG means the next person to run that script
silently reverts you. The app icon is inset to 824/1024 of its canvas because the
Dock scales every icon to the same box, so a full-bleed squircle reads about 24%
oversized. The tray marks are drawn separately: the icon collapses into one black
blob at 16px, and a macOS template image keeps only alpha — which is why a
running turn is signalled by shape rather than by a green dot.

---

## 11. Stack

| Layer | Choice |
| --- | --- |
| Shell | Electron + electron-vite, packaged by electron-builder |
| Renderer | React, Tailwind v4 (CSS-first), shadcn on Base UI, oklch palette |
| Bridge | Hand-rolled typed IPC, Zod-validated (§2) |
| Data | TanStack Query for reads across the boundary; Zustand for ephemeral UI state |
| Storage | SQLite via better-sqlite3 + Drizzle, checked-in migrations |
| Scheduler | node-cron, main process only |
| Backends | `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk` — main process only |
| GitHub | Octokit, device flow, token in the OS keychain |
| Diff viewer | Monaco |
| Charts | recharts |
| Tests | Vitest (two projects) + Playwright for Electron E2E |

`postinstall` runs `electron-builder install-app-deps`, rebuilding better-sqlite3
against Electron's ABI — which is why `node_modules` is never shared between
worktrees, and why tooling that must run under plain Node uses `node:sqlite`
instead.

**macOS code signing with a real Developer ID is functionally required, not
cosmetic.** An ad-hoc signature makes the designated requirement a content hash,
so every rebuild is a new app to the keychain holding the encryption key — which
is what destroyed stored credentials. The certificate is selected by hash rather
than by name, because a developer keychain routinely holds two valid certificates
with identical names.

---

## 12. Storage

Ten tables — `app_state`, `skills`, `persona_templates`, `contacts`, `groups`,
`group_messages`, `messages`, `tool_calls`, `routines`, `usage_events` — plus an
FTS5 virtual table and triggers for message search.

**Migrations are the source of truth for tests.** Database-backed services run
against a real in-memory SQLite with the actual migration folder applied, never
hand-written DDL: a copy of the schema drifts the moment either changes, and the
drift looks like a passing test.

Four things about SQLite that this schema had to learn the hard way:

- **`PRAGMA foreign_keys = ON` is mandatory and easy to miss.** better-sqlite3
  leaves it off, which would make every foreign key decorative — including the
  restriction the persona-delete rule depends on.
- **drizzle-kit emits an added foreign key with no referential action.** Its own
  snapshot records the action correctly; only the SQL emitter drops it, and
  SQLite then defaults to NO ACTION. One `ON DELETE SET NULL` is hand-written and
  pinned by three tests — without it, deleting any contact that had ever run a
  turn fails outright, taking the reset-everything path with it.
- **SQLite cannot alter a foreign key, so any change is a table rebuild** — and
  drizzle wraps migrations in one transaction, inside which SQLite *ignores* the
  foreign-key pragma. The generated pragmas are no-ops and the rebuild runs with
  enforcement live. A generated rebuild also selects new columns from the old
  table; a hand-edited join is what turns a broken copy into a backfill.
- **A rebuild would drop the FTS triggers and renumber the rowids** the
  external-content index is keyed by. Search would stop agreeing with the
  database and nothing would error. This is why one column stays NOT NULL and why
  re-pointing a Contact moves rows instead.

Additive nullable columns need no backfill; pre-existing rows read back absent
rather than guessed. The upgrade test builds the "old" database from a *prefix*
of the migration folder rather than a checked-in binary fixture, so it cannot go
stale — and it is the only test that proves what a migration *copies* rather than
merely that it applies.

---

## 13. What this app deliberately does not do

This section is the governance story, and it is the most important thing in this
document.

**A persona is sealed against the repository it works in.** Claude gets
`settingSources: []` and `strictMcpConfig: true`. Codex gets
`project_doc_max_bytes: 0`, `features.hooks = false`, and every discovered skill
disabled **by name**. A repository's `CLAUDE.md`, `AGENTS.md`, skills, hooks,
subagents and `.mcp.json` reach a session **only when a human has opted that
Contact in**.

That seal was, for a long time, a property of one adapter. `settingSources: []`
sealed Claude early, and every document afterwards called *the app* sealed —
while Codex read the bound repository's `AGENTS.md` and obeyed it, discovered and
offered its skills, and ran a hooks engine. Measured, not reasoned: a scratch
repository whose `AGENTS.md` said to begin every reply with a nonsense token
produced exactly that. Both probes are checked in as live tests.

The rest of the deliberate no:

- **No per-action approval prompts.** The sandbox level, set once at persona
  creation, *is* the approval. Pausing a chat mid-response for a permission
  dialog defeats the point of setting a level.
- **No automatic merging of any kind.** The merge layer is a human click with a
  conflict dry run, and merges target a specific working path rather than
  defaulting into the user's tree. The dry run is `git merge-tree --write-tree`,
  which happens entirely in the object store — not `git merge --no-commit`, which
  is a dry run that isn't: it leaves the target conflicted on failure, which is a
  poor thing to do to a directory somebody is working in.
- **No hard budget enforcement.** Soft alerts only; nothing is paused or stopped.
- **No arbitrary tool server by URL.** The registry is curated. An
  add-a-server field is a trust surface with no gate behind it.
- **No `@path` import resolution in repository instructions, and frontmatter that
  claims tools is ignored.** A document in the repository does not get to widen
  the sandbox or the scope.
- **No semantic or vector search** over history — recency-based recall plus
  keyword search.
- **One repository per Contact; single-target mentions; no cross-repo fan-out.**
- **Cursor is not implemented**, though the adapter interface would take it.

Two more, narrower but load-bearing:

- **The `.git` write grant excludes hooks and config.** A writable hooks
  directory is a sandbox *escape*: a hook written during a turn runs unsandboxed
  on the user's next git command.
- **Deleting a Contact is refused by default when its checkout holds uncommitted
  work.** Committed work is safe either way; uncommitted work exists nowhere
  else.

If you find yourself removing one of these to make something work, that is a
governance decision, and it belongs in this document rather than in a diff.

---

## 14. Facts that carry a date

Every figure below is transcribed from a vendor, not measured by this app, and
each carries a marker saying when it was last checked. **`source` tells you how a
number was obtained and nothing about whether it is still true** — read the date
first.

| Fact | Where | Marker |
| --- | --- | --- |
| Per-model prices | `src/main/adapters/pricing.ts` | `LAST_VERIFIED` |
| Model menus per backend | `src/main/adapters/models.ts` | `MODELS_LAST_VERIFIED` |
| Context windows | `src/shared/context-windows.ts` | `CONTEXT_WINDOWS_LAST_VERIFIED` |
| GitHub tool inventory | `src/main/adapters/github-mcp-tools.ts` | `npm run probe:mcp` |

Measured behaviour worth keeping alongside them:

- **`permission_policy` does not survive `bypassPermissions`.** A tool set to
  always-deny, left out of `disallowedTools`, ran and returned results under
  bypass. It is not a viable third gate, which is why `disallowedTools` staying
  primary is load-bearing.
- **Codex's config block is validated by the CLI binary, not the SDK.** The
  options type is an open index signature, so a misspelled key is silently
  ignored and the failure looks like a server that is configured and isn't there.
- **Neither backend's built-in skills can be suppressed at all.** They are
  disclosed in the interface rather than pretended away.
- **On Codex there is no global switch and no wildcard for repo skills.** Seven
  plausible config keys were each probed and each left the repository's skill
  fully visible. Only disabling by name works.
- **git worktree lifecycle, verified against real git:** two worktrees cannot
  share a branch; pruning a hand-deleted worktree keeps the branch; removing a
  dirty tree is refused without force and the branch survives; a *failed* add
  still creates its branch and must be cleaned up; and the administrative
  directory name is deduplicated from the path basename, so it must be **read
  from git, never derived**.
- **`codex debug prompt-input` renders the exact model-visible prompt locally and
  for free.** Asking a model what it can see costs money and is less precise.

---

## 15. How this codebase is worked on

- **A phase is not done until its testable logic has tests.** `npm test` gates
  `npm run build`, so packaging cannot ship a red suite. One consequence worth
  knowing: a deliberate mutation to check that a test has teeth fails the gate,
  the bundle is never rewritten, and Playwright then drives the *previous* build.
  Rebuild directly when doing that.
- **Write tests from the claim, not from the code.** A green suite proves the
  tests agree with the implementation and nothing more. One case named "rejects
  `sed -i`" passed while `sed -ni` walked straight through the guard it was
  testing. For anything making a security or correctness claim, prefer executing
  the function over reading it.
- **A comment is not evidence.** Three separate holes in one phase were comments
  asserting guards nobody had written. All three passed their existing tests.
- **A screen on fixtures is not evidence about the system.** Six places claimed a
  backend reported no cost long after the price table made that false — the mock
  fixtures had manufactured the evidence.
- **Anything touching a vendor SDK is split into a pure normalization layer and a
  thin call**, and the pure layer is tested against event shapes captured from
  real runs. Fabricated fixtures test our reading of the documentation rather
  than the SDK.
- **Live checks are checked in and gated behind an environment variable**, so
  they can be re-run on demand rather than being a thing someone once did:
  `LIVE_CODEX_CONTEXT`, `LIVE_GITHUB`, `LIVE_MCP`, `LIVE_JOURNEY2`,
  `LIVE_JOURNEY3`, `LIVE_WORKTREES`.
- **Renderer logic that is not in `src/renderer/src/lib/` cannot be tested.** The
  renderer test project matches `*.test.ts` and never `.tsx`, so a `.test.tsx`
  file is silently ignored rather than failing loudly.
- **The E2E suite observes main through SQLite, not through a test hook.** A
  backdoor into production code to make a test convenient was rejected.
- **The encryption boundary is one module**, the sole permitted caller of the
  keychain API, enforced by a lint rule, and writing to files rather than to the
  database so that "no credential is in the database" holds by construction. That
  directory is fenced out of every persona's sandbox: *not reachable* is a
  stronger guarantee than *encrypted at rest*.
- **When a fact gains a new source of truth, every reader has to move together.**
  Attribution stamped on a usage event fixed one breakdown while the dashboard's
  scope filter still worked the old way — two totals on one screen disagreeing
  about the same money, the more prominent one wrong.
- **Agents work in git worktrees, not the primary checkout.** The failure modes
  are structural: a checkout yanks the tree out from under a second writer, a
  broad `git add -A` sweeps up their uncommitted work, and two builds race over
  one output directory.

---

## 16. The three journeys

Kept because each exercises a different part of the architecture, and together
they are the shortest honest demonstration of what the app is for. A
step-by-step script with real timings lives in `docs/demo-runbook.md`.

1. **Configure a persona and get scoped work done.** Persona, Skills, a repo
   binding, a message, a reply that respects a read-only sandbox. The
   foundational loop — if this does not work, nothing else matters.
2. **Two personas coordinate on one repository.** A writer refactors and states
   why; its summary lands in the repo's Group as durable; a reviewer opened
   afterwards references the refactor without being told. Then an @mention from
   the Group routes to a third persona's real session. This is the differentiated
   moment: coordinated, not three parallel chat windows.
3. **A routine does bounded autonomous work and reports its cost.** It wakes,
   reads, changes something, opens a pull request rather than pushing, posts to
   the Group, and the spend appears against the persona. Autonomous but bounded,
   and visible rather than silent.
