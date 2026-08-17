# Phase 15 — Deferred capability work

**Status:** Not started
**Blueprint refs:** §3 (adapters), §4 (governance axes), §5 (context injection)
**Depends on:** Phase 14

## Why this exists

Phase 14 opened the seal deliberately: MCP servers, the repository's own
instructions, and its skills now reach a persona when — and only when — a human
has said they may. Building it turned up a handful of things that are real, are
not done, and would otherwise survive only in a chat transcript.

This document is where they live so that the next person to touch the capability
surface does not have to rediscover them. Nothing here is a bug in what shipped;
each item is either an unmade decision, an unverified assumption, or a boundary
drawn on purpose.

---

## 0. `scripts/probe-mcp.ts` — the instrument the rest of this depends on

Deferred out of Phase 14 after step 4. It was planned as step 5 and is the
prerequisite for items 2 and 3 below, so it is the first thing to build here
rather than one entry among several.

Three jobs, in the order they matter:

1. **Confirm the Codex `mcp_servers` block against a real run.** Today its key
   names come from `codex mcp add --help` and from the binary's own serde field
   list, read with `strings`. `CodexOptions.config` is an open index signature,
   so a wrong key is *silently ignored* — the failure is a server that looks
   configured, is not there, or worse is there without its deny list. Unit tests
   assert the object we build; nothing yet asserts Codex accepts it.
2. **Refresh `src/main/adapters/github-mcp-tools.ts`** from both endpoints and
   report drift. The file is a snapshot taken 2026-08-16 (27 read, 17 write, 44
   total) and its arithmetic is asserted, but that tripwire only fires when this
   is run. Item 3 below is the cost of not running it.
3. **Probe `McpServerToolPolicy.permission_policy` under `bypassPermissions`.**
   If `always_deny` survives, it is a genuine third gate — per-server and
   per-tool, enforced by the CLI rather than by a name blacklist — worth adopting
   *alongside* `disallowedTools`, never instead of it.

It belongs beside `probe:adapters` and `probe:structured` and runs outside
Electron for the same reason they do: nothing under `src/main/adapters/` may
import `electron` or the database, so the probe drives the real SDKs directly.

Until it exists, the honest statement about the Codex MCP path is **written and
unit-tested, unproven end to end**.

## 1. `capabilities.unavailable` has no consumer

`capabilitiesFor()` returns an `unavailable` list — servers a persona was
granted but that could not be offered, each with a reason
(`src/main/services/capabilities.ts:62`). It is populated, tested, and read by
nothing.

The failure mode it exists to prevent is specific and unpleasant. A persona
granted the GitHub server with no account connected gets **no** server and no
explanation. Asked to check for new issues, it looks for a tool, finds none, and
answers that it found nothing — which is indistinguishable from there being no
new issues. Blueprint §16 Journey 3 opens with exactly that step, so the silent
version of this failure is the one most likely to be seen in a demo.

Two options were written up and neither was chosen:

- **Tell the model.** Add `unavailableServers` to `SessionSpec` and render one
  sentence in the dynamic suffix. The persona can then say "GitHub is not
  connected" instead of "no new issues". Costs a new spec field and a prompt
  section on a path that is otherwise sealed.
- **Tell the human only.** Surface it in the Phase 14 header capability popover
  and leave the prompt alone. Keeps the prompt surface minimal; the model still
  cannot distinguish the two cases, so a routine running unattended at 3am still
  reports nothing found.

**Decide before the popover ships**, because the popover is what makes the
second option defensible and its absence is what makes the first urgent.

## 2. Unverified SDK behaviour

Three things are believed rather than known. Each has a cheap instrument.

| Claim | Evidence today | What would settle it |
|---|---|---|
| Codex's `mcp_servers.<id>` takes `url`, `bearer_token_env_var`, `disabled_tools` | `codex mcp add --help`, plus the `RawMcpServerConfig` serde field list read out of the binary with `strings` | `LIVE_MCP=1` — one real turn that calls a GitHub tool |
| `McpServerToolPolicy.permission_policy: 'always_deny'` survives `permissionMode: 'bypassPermissions'` | Nothing. The type exists in `@anthropic-ai/claude-agent-sdk@0.3.233` (`sdk.d.ts:1125`) and was never exercised | `scripts/probe-mcp.ts` — attempt a denied tool at `full_access` |
| `mcp__*` as a wildcard in top-level `disallowedTools` | Documented for *agent definitions* (`sdk.d.ts:48`), not for the top-level option | A probe turn; until then it is not used and the guard is per-name |

The Codex one matters most. `CodexOptions.config` is an open index signature, so
a misspelled key is **silently ignored** rather than a type error — the failure
mode is a server that appears configured and simply is not there, or worse, one
configured without its deny list. This is the single largest gap between what
Phase 14's unit tests assert and what is actually true on a running machine.

If `permission_policy` does survive `bypassPermissions`, it becomes a genuine
third gate — per-server and per-tool, enforced by the CLI rather than by a name
blacklist — and is worth adopting alongside `disallowedTools` rather than
instead of it.

## 3. Denylist over allowlist, and when to revisit

Phase 14 chose `disabled_tools` on Codex to mirror Claude's `disallowedTools`,
so a single table in `sandbox.ts` drives both backends and they cannot disagree
about what a `githubScope` means. Codex also offers `enabled_tools`, which would
fail closed.

The cost of the choice: **a write tool GitHub adds after 2026-08-16 is reachable
on both backends** until someone runs `npm run probe:mcp` and refreshes
`src/main/adapters/github-mcp-tools.ts`. The 27/17/44 arithmetic asserted in
that file's tests is the tripwire, but it only fires when the probe is run.

Revisit if either becomes true:

- GitHub ships write tools often enough that the refresh is not reliably done.
- The two backends stop needing to behave identically — at which point
  `enabled_tools` on Codex costs nothing.

## 4. Drawn on purpose, not deferred

These are decisions, not omissions. Reopening any of them is a governance change
and belongs in `00-progress.md`.

- **No arbitrary MCP server by URL.** The registry is curated and has one entry.
  An add-a-server field is a trust surface with no gate behind it, and this
  phase is entirely about what stands behind the gates.
- **Repo hooks, subagents, `.mcp.json` and `.claude/settings.json` permission
  grants are not honoured.** `features.hooks = false` and `strictMcpConfig: true`
  are what enforce it. A hook is an arbitrary command outside every sandbox this
  app has built.
- **`CLAUDE.md` `@path` imports are not resolved.** The file is read, capped at
  32 KB, and injected as it stands; an `@`-reference to another file is inert
  text. Resolving them would mean following a repo-authored path list.
- **`SKILL.md` `allowed-tools` frontmatter is ignored.** The sandbox and the
  `githubScope` govern what a session may do, and a document in the repository
  does not get to widen either.
- **The backends' own built-in skills cannot be suppressed** — 16 on Claude, 5
  on Codex. Verified impossible on both, so they are disclosed in the UI rather
  than hidden.
- **Tool calls are not persisted.** They stream live and are gone on reload,
  with the honest consequence that a routine firing overnight leaves no trace of
  what it called.

## 5. Smaller loose ends

- `composeInstructionBlocks()` returns a two-way split; only Claude honours it.
  Codex has no cache-breakpoint mechanism in `@openai/codex-sdk@0.147.0`, so its
  prompt ordering is a convention with nothing enforcing it.
- The GitHub token reaches the Claude subprocess environment as well as the
  header, because `backendEnv()` sets the variable for both backends. Harmless —
  it is the same trust boundary `ANTHROPIC_API_KEY` already crosses — but it is
  wider than Claude strictly needs.
- `readRepoInstructions()` reads `CLAUDE.md` **or** `AGENTS.md`, never both, and
  prefers `CLAUDE.md`. A repo whose two files genuinely differ loses one of them
  silently.
