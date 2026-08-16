# Phase 14 — Agent capability surface

**Status:** Not started
**Blueprint refs:** §3 (adapters), §4 (the two governance axes), §5 (context injection), §16 Journey 3
**Depends on:** Phase 5 (both adapters), Phase 9 (the GitHub token and its scope model)
**Numbered 14 only so nothing else had to be renumbered.** Recommended order: **9 → 10 → 14 → 11**, so Journey 3 is whole before Phase 11 runs the journeys end to end.

## Why this exists

Phase 9 could not honestly finish blueprint §16 Journey 3. Its first step is a
routine that *"checks for newly reported issues"*, and nothing in this app gives
a persona any way to see a GitHub issue. The obvious patch — one Octokit call
that pastes open issues into the prompt — would have been a special case built
for one demo sentence, and it would have hidden the real question:

> **How does a persona see anything that is not a file on disk?**

Today the answer is: it doesn't. That is a deliberate design, and it is now the
thing standing between this app and most of what people expect an agent to do.

### What was verified, not assumed (2026-08-16)

- **`src/main/adapters/claude.ts:191` passes `settingSources: []` on purpose** —
  "A persona's instructions are the persona's alone — never whatever CLAUDE.md or
  settings happen to sit in the repo it is working on." In
  `@anthropic-ai/claude-agent-sdk@0.3.233`, *omitting* that option loads **all**
  sources: `~/.claude/settings.json`, the repo's `.claude/settings.json` and
  `.claude/settings.local.json`, `CLAUDE.md`, project skills, subagents, hooks,
  and `.mcp.json`. So the app is sealed by construction, and opening it is a
  deliberate act rather than a default to fall into.
- **No `mcpServers` are passed on either backend.** The SDK's `mcpServers`,
  `agents`, `hooks`, and `skills` options all exist and all go unused.
- **Codex can reach the same place through a different door.**
  `@openai/codex-sdk@0.147.0` exposes `config?: CodexConfigObject` — `--config
  key=value` overrides, so `mcp_servers.*` is configurable — and already emits
  `mcp_tool_call` thread items, which means the events have somewhere to land.
  Two different doors to one capability is exactly the shape Phase 12 hit with
  `allowWrite` versus `--add-dir`; expect the same amount of work.
- **`repo` scope is already on the stored token** (`github_scopes` reads
  `repo read:user`), so a GitHub MCP server needs no re-authorisation.

### One naming trap, worth stating before anyone writes code

The app's own **Skill** (blueprint §4) is *injected text* — it is composed into
the system prompt by `composeInstructions`. A **Claude Code Skill** is an
executable capability the model chooses to invoke. Same word, different things.
Any UI in this phase has to name them apart or the persona editor will imply
something false.

## What this phase has to decide

### 1. MCP servers as a first-class, app-managed capability

The core of the phase. A per-persona (or per-Contact — Phase 12's isolation step
is the precedent for putting it on the Contact) allowlist of servers the app
knows how to launch, rather than whatever a repo's `.mcp.json` happens to
declare.

The GitHub MCP server is the first one, authenticated with the token already in
`safeStorage`, and its tool surface **mapped onto `githubScope`**: a `read_only`
persona must not be able to comment on an issue through a tool when it cannot
through a button. Phase 9 put the app's one gate in `pull-requests.ts`; a tool
that reaches GitHub by another route walks straight around it. That is the
single most important constraint in this phase.

This is also the step that closes Journey 3's first sentence.

### 2. Repo-local instructions — `CLAUDE.md` / `AGENTS.md`

Opt-in per Contact, and the reason has to be written down: those files are
instructions authored by whoever owns the repository, which is a different trust
question from the persona's own system prompt. A persona bound to a repo the
user cloned from a colleague would silently start taking direction from it.

### 3. Repo skills, subagents and hooks — default off

Hooks especially: a repo hook executes an arbitrary command, outside every
sandbox this app has built. `settingSources: ['project']` turns all of these on
together, which is the wrong granularity — the SDK's `strictMcpConfig`,
`allowedTools`/`disallowedTools` and explicit `agents` are the levers for taking
them one at a time.

### 4. A third governance axis

`sandbox` covers the disk and `githubScope` covers GitHub. An MCP server is
**network reach that neither describes** — a persona with `read_only` disk access
and `read_only` GitHub authority could still be handed a server that posts to
Slack. Blueprint §4's two axes stop being sufficient at exactly this point, and
that is a blueprint-level note rather than a phase-level one.

### 5. Making tool calls visible

A tool call is work, and this app's whole argument is that a fleet's work should
be legible. Codex already emits `mcp_tool_call` items and Claude emits tool
events; neither reaches `AgentEvent` today. Without this, an MCP call is a silent
side effect — the thing blueprint §9 objects to in the first place.

## Explicitly out of scope

- Writing MCP servers. This phase *hosts* them.
- A general "add any server by URL" configuration UI. A curated set the app knows
  how to authenticate is the v1 shape; arbitrary servers are a trust surface with
  no gate behind it.
- Anything that would let a repo turn its own capabilities on without a human.

## Acceptance checks

- [ ] A persona with an MCP server enabled can answer a question about the repo's
      open GitHub issues, live, on **both** backends.
- [ ] A `read_only` persona with the same server cannot comment, open, or close
      anything through it — verified by attempting it, not by reading the config.
- [ ] Repo-local `CLAUDE.md` / `AGENTS.md` is ignored until a Contact opts in, and
      demonstrably reaches the model once it does.
- [ ] Repo hooks never run unless explicitly enabled, and the UI says what
      enabling them means.
- [ ] An MCP tool call is visible in the thread as work, not inferred from the
      reply.
- [ ] Blueprint §16 Journey 3 runs whole: the routine reads the issues, fixes one,
      and opens a pull request — the last of which Phase 9 already verified.
