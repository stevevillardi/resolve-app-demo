# Phase 15 — Deferred capability work

**Status:** Not started
**Blueprint refs:** §3 (adapters), §4 (governance axes), §5 (context injection)
**Depends on:** Phase 14

## Why this exists

Phase 14 opened the seal deliberately: MCP servers, the repository's own
instructions, and its skills now reach a persona when — and only when — a human
has said they may. Building it turned up things that are real, are not done, and
would otherwise survive only in a chat transcript.

This document is where they live so the next person to touch the capability
surface does not have to rediscover them. Nothing here is a bug in what shipped;
each item is an unmade decision, a stated limit, or a boundary drawn on purpose.

**The two items that were here and are now closed** — `scripts/probe-mcp.ts` and
the unreachable `capabilities.unavailable` — were both done in Phase 14. The
probe settled all three of the SDK questions this file used to list, including
one whose answer changed a design: `permission_policy` does _not_ survive
`bypassPermissions`, so it is not a viable third gate.

---

## 1. Tool calls are not persisted

The timeline in the thread is live only. It is dropped when the turn's rows are
refetched, so reloading the window loses it.

The case against leaving it there is real and specific: this app's most
autonomous mode is a routine firing at 3am, and that is exactly the run nobody
watches. The morning after, there is a record of what the persona _concluded_
and none of what it _called_ — which for an MCP-enabled persona means no record
of what it read or wrote on GitHub.

The case for is that persisting means a migration, a retention policy, and
putting tool arguments — issue titles, file paths, repo detail — into SQLite
permanently. Phase 14's own acceptance check asks that a call be "visible in the
thread as work", which the live timeline satisfies for a watched turn, and the
durable record of a routine already exists as its Group summary.

**Decide before routines are demoed as unattended.** A middle option nobody has
costed: persist only `name` and `status` per call, not arguments.

## 2. What `sandbox: full_access` cannot be made to mean

`githubScope` is now enforced against MCP tool names _and_ against the shell
(`evaluateGithubShellUse`). Neither applies at `sandbox: full_access`, because
that level sets `permissionMode: 'bypassPermissions'` on Claude and
`danger-full-access` on Codex, and neither backend asks this app anything after
that.

So `sandbox: full_access` + `githubScope: read_only` is **not** read-only on
GitHub, and cannot be made so from inside this process. `ScopeChip` says as much
now, which is honest but not a fix.

The real options, none taken:

- **Refuse the combination.** Make `full_access` force `githubScope:
full_access`, so the UI stops offering a guarantee it cannot keep. Cheap, and
  arguably what the axes already imply.
- **Drop the ambient credentials.** The shell reaches GitHub through the
  _developer's_ `gh` and `git` credentials, not the app's. A session could run
  with `GH_TOKEN`/`GIT_*` scrubbed and `HOME` redirected, which is what the E2E
  fixtures already do for exactly this reason.
- **Accept and document.** Where it stands today.

The second is the only one that actually closes it, and it is a behaviour change
for every persona, not just this combination.

## 3. The shell guard is a heuristic

`evaluateGithubShellUse` is a deny list matched against command text.
`SHELL_CONTROL` already rejects chaining, redirection and substitution, which
removes the easy escapes — but a model that writes a script to a file and
executes it walks straight through, and so does anything that reaches the API
through a language runtime rather than a CLI.

It raises walking around the axis from "type the obvious command" to
"deliberately work around a stated restriction". That is worth having and it is
not a boundary; the boundary is the credential scrubbing above.

## 4. Denylist over allowlist, and when to revisit

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

## 5. Drawn on purpose, not deferred

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

## 6. Smaller loose ends

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
