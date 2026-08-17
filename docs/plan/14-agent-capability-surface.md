# Phase 14 — Agent capability surface

**Status:** Done
**Blueprint refs:** §3 (adapters), §4 (the governance axes), §5 (context injection), §9, §16 Journey 3
**Depends on:** Phase 5 (both adapters), Phase 9 (the GitHub token and its scope model)
**Numbered 14 only so nothing else had to be renumbered.** Built after 9, 10, 13 and 16.

## Why this exists

Phase 9 could not honestly finish blueprint §16 Journey 3. Its first step is a
routine that _"checks for newly reported issues"_, and nothing in this app gave a
persona any way to see a GitHub issue. The obvious patch — one Octokit call
pasting open issues into the prompt — would have been a special case built for
one demo sentence, and it would have hidden the real question:

> **How does a persona see anything that is not a file on disk?**

The answer is now: through servers the app knows how to authenticate, narrowed by
the persona's `githubScope`, plus whatever the _Contact_ has been opted in to
trusting from its own repository. Nothing reaches a session that a human did not
grant it.

## What was actually built

The phase ran in two halves, in that order, because planning found the app was
not in the state its own documents described.

### Half one — make the seal real

- **`ac595b7`** — the Codex seal. Three channels were open, not two: `AGENTS.md`
  (`project_doc_max_bytes = 0`), `.codex/skills` (disabled per name; no global
  switch and no wildcard exists), and `.codex/hooks.json` (`features.hooks =
false`). `settingSources: []` had sealed _Claude_ since Phase 5, and every
  document afterwards described the **app** as sealed. It was a property of one
  adapter.
- **`d2c118d`** — `denyReadPaths` gets its first producer. Declared in Phase 5,
  plumbed into the Claude OS sandbox, supplied by nobody, so `userData/secrets`
  was readable by every persona.

### Half two — open it deliberately

| Commit    | What                                                                |
| --------- | ------------------------------------------------------------------- |
| `8ca3dec` | Migration 0009, `repoTrustSchema`, `personaTemplates.mcpServerIds`  |
| `a6a3687` | `capabilitiesFor()` — the resolution layer, read by no adapter yet  |
| `3c4a00b` | Both adapters consume it; the prompt gains a cacheable-prefix split |
| `3c63e96` | `probe:mcp`, and the "granted but unreachable" gap closed           |
| `c12f0cf` | `repoTrust` gets a writer, and a list to choose from                |
| `fe153d2` | The UI: MCP checklist, trust switches, third `ScopeChip` axis       |
| `feb9b22` | A `tool_end` guard that had only ever existed in a comment          |
| `9b5b0fe` | The tool-call timeline                                              |
| `ec5c0b2` | The `/` picker                                                      |
| `e3b84cd` | **The shell route around `githubScope`** — see below                |

## Decisions

| Question                       | Decision                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| `githubScope` → MCP tools      | Mirror the scope, two layers: endpoint + name blacklist            |
| `open_pr` write boundary       | Propose freely; never merge, never bypass git (6 of 17 denied)     |
| Repo `CLAUDE.md` / `AGENTS.md` | App reads and injects it, per Contact opt-in, framed as convention |
| Repo skills                    | All roots offered; each delivered _discovered_ or _described_      |
| Codex tool gating              | `disabled_tools`, the same table Claude's `disallowedTools` reads  |
| Cacheable prefix               | `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` adopted; Codex joins and drops it |
| Hooks and subagents            | Sealed off, not honoured                                           |
| Tool-call visibility           | Live during the turn, not persisted                                |
| Third governance axis          | The per-persona server allowlist _is_ the axis in v1               |

## Measured, not assumed

Everything below was run rather than reasoned about. `npm run probe:mcp`
reproduces the first four.

- **The GitHub MCP inventory.** `/mcp/readonly` serves **27** tools, `/mcp/`
  serves **44**, so the write set is exactly the **17** in the difference. That
  is what makes the deny table derivable instead of hand-maintained. Re-checked
  at the end of the phase: no drift.
- **Codex accepts the `mcp_servers` block.** Its schema is the CLI binary's, not
  the SDK's — `CodexOptions.config` is an open index signature, so a misspelled
  key is _silently ignored_ and the failure is a server that looks configured and
  is not there. A real turn called `github__search_issues`.
- **`permission_policy` does not survive `bypassPermissions`.** The Claude SDK
  types a per-server `always_deny`; set on `search_issues`, left out of
  `disallowedTools`, run under bypass — **the tool ran and returned results**. So
  it is not a viable third gate, and `disallowedTools` staying primary is
  load-bearing rather than cautious.
- **Claude defers MCP tools behind tool search.** It called `ToolSearch` before
  `mcp__github__search_issues`, so 27 tool definitions do not sit in the prompt.
- **Both backends' built-ins cannot be suppressed** — 16 skills plus 48 slash
  commands on Claude, 5 on Codex. Disclosed in the UI instead of pretended away.

## The finding that changed the phase

The live check for _"a `read_only` persona cannot comment"_ **failed, on both
backends.** The MCP layer refused correctly — the read-only endpoint serves no
write tool, and the model said so in its reply — and the model then ran
`gh issue comment` from the shell. The comment appeared on the issue.

Both governance layers had worked exactly as designed and the outcome was still
wrong, because `githubScope` had only ever been applied to MCP **tool names**. A
developer machine has `gh` on the PATH with its own credentials, `git` with push
access, and `curl`. Phase 9's own note had said a tool reaching GitHub by another
route "walks straight around" the gate; nobody had asked whether the shell was
such a route.

`evaluateGithubShellUse` now applies the axis to Bash as well, and the same live
check passes — the two `read_only` comments and their absence on the re-run are
the before and after. Two limits are stated in the code rather than papered over:

1. At **`sandbox: full_access`** none of it is consulted — Claude sets
   `bypassPermissions`, Codex `danger-full-access`. That combination is
   ungoverned by construction, and `ScopeChip` now says so instead of promising
   "cannot push or comment".
2. It is a **deny list over a heuristic**. `SHELL_CONTROL` blocks chaining and
   substitution, but a model determined to write a script and run it can still
   get out. It raises the cost from "type the obvious command" to "deliberately
   work around a stated restriction" — a difference in kind, not a boundary.

The same run found a hole this phase had itself introduced: `backendEnv()` put
the GitHub token into _every_ persona's subprocess environment, and
`echo $PERSONA_ROUTER_GITHUB_MCP_TOKEN` is allowed at `workspace_write`. The
comment justifying it claimed "a persona is never given a shell that could echo
it". It is now injected only for a session that holds the server.

**The pattern worth carrying forward:** three separate holes in this phase were
comments asserting guards nobody had written — `denyReadPaths`,
`SUMMARY_DISALLOWED_TOOLS`, and `tool_end`'s `toolCallId` check. A comment is not
evidence, and a test written from the code rather than from the claim agrees with
the code either way.

## Two words that mean two things

A **Skill** in this app (blueprint §4) is injected prose composed into the system
prompt. A **Claude Code / Codex skill** is an executable capability discovered
from disk. The context panel is the one screen where both appear at once, and it
labels them apart deliberately.

## Explicitly out of scope

- Writing MCP servers. This phase _hosts_ them.
- A general "add any server by URL" UI. A curated set the app knows how to narrow
  is the v1 shape; an arbitrary endpoint is reach with no gate behind it.
- Anything that would let a repo turn its own capabilities on without a human.
- `CLAUDE.md` `@path` imports; `SKILL.md` `allowed-tools` frontmatter.
- Persisting tool calls.

Everything deferred, and why, is in
[15-deferred-capability-work.md](15-deferred-capability-work.md).

## Acceptance checks

- [x] A persona with an MCP server enabled can answer a question about the repo's
      open GitHub issues, live, on **both** backends.
- [x] A `read_only` persona with the same server cannot comment, open, or close
      anything through it — verified by attempting it, not by reading the config.
      **The original wording said "through it", and the first run passed that
      reading while the comment still appeared.** The check now asserts GitHub's
      own state after the attempt, which is what caught the shell route.
- [x] Repo-local `CLAUDE.md` / `AGENTS.md` is ignored until a Contact opts in,
      and demonstrably reaches the model once it does —
      `e2e/capabilities.spec.ts` for the wiring, `codex-repo-context.live.test.ts`
      for the model.
- [x] Repo hooks never run unless explicitly enabled — `features.hooks = false`,
      and each grant in the UI states what it means.
- [x] An MCP tool call is visible in the thread as work, not inferred from the
      reply. Live only; the 3am consequence is recorded in Phase 15.
- [x] Journey 3's opening step is real: a persona reads this repo's issues. The
      rest of that journey was already verified in Phase 9.

## Live checks

| Gate                   | What it proves                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_MCP=1`           | issues read on both backends; `read_only` cannot comment by _any_ route; `open_pr` can comment and not merge; the read-only endpoint serves no writes |
| `LIVE_CODEX_CONTEXT=1` | a repository cannot instruct a Codex persona                                                                                                          |

```bash
LIVE_MCP=1 GITHUB_TOKEN=$(gh auth token) npx vitest run --project main \
  src/main/adapters/mcp.live.test.ts
```

Needs a throwaway repo in `PERSONA_ROUTER_LIVE_REPO`. Costs a few cents a run.
