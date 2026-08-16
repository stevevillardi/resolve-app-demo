# Phase 12 — Worktree Isolation

**Status:** Not started
**Blueprint refs:** §6 (shared context), §15D (concurrency), §13 (v1 scope cuts)
**Depends on:** Phase 6 (the write lock and its `workingPathFor` seam), Phase 7 (durable summaries, which carry branch awareness)
**Runs:** between Phases 8 and 9 in execution order, despite the number — numbered 12 so nothing else had to be renumbered.

## Why this exists

Phase 6 narrowed blueprint §15D from "one run per repo" to a **write lock**:
`read_only` personas take a shared hold and are never refused, so a reviewer can
read a repo while a refactor runs. That freed the read-heavy majority, and it is
why Journey 2 works without anything here.

Two *writing* personas on one repo still queue. That is a real limit rather than
a theoretical one:

- Phase 8's routines fire unattended. A scheduled writer colliding with the repo
  the user is working in is the first contention nobody is watching for.
- "Personas working in parallel" is a large part of what this product claims. A
  demo where the second writer waits undercuts it.

The fix is one `git worktree` per writing Contact: its own checkout, its own
branch, one shared object store.

## Scope

### 1. Git plumbing

Extend `src/main/services/git.ts` (built in Phase 6 for cloning) with
`worktreeAdd`, `worktreeRemove`, `worktreeList`, `worktreePrune`. Its existing
rule carries over: **git's stderr is never passed through**, because a remote
URL can carry a live token.

### 2. Schema — migration `0005`, additive

| Table | Column | Meaning |
|---|---|---|
| `contacts` | `worktree_path TEXT NULL` | where this Contact actually works; null = the repo itself |
| `contacts` | `branch TEXT NULL` | the branch its worktree is on |
| `contacts` | `isolation TEXT NULL` | `shared` / `worktree` / `exclusive`; null reads as `shared` |

`repo_path` keeps meaning **the canonical repo**, so blueprint §4's "one Group
per repo" and the `groups_repo_path_unique` index are untouched — the Group
still keys on the repo, the session just runs somewhere else.

### 3. The seams Phase 6 already left

- `workingPathFor(contact)` in `src/main/services/run-lock.ts` returns
  `contact.repoPath` today. It starts returning `worktree_path ?? repo_path`.
  That single change is what stops two writers contending, because they are no
  longer working in the same directory. Its unit test pins the current answer,
  so this is a deliberate edit to a failing test.
- `SessionSpec.repoPath` becomes the worktree path, so `isInsideRepo()` fences
  the right directory with **no change to `sandbox.ts`**.

### 4. Chosen per Contact, at bind time

`NewContactFlow` gains an isolation step. Per Contact rather than per persona
because the same persona may want isolation on one repo and not another.

- **`shared`** — runs in the main tree. Default for `read_only`. Never locks.
- **`worktree`** — own checkout and branch. Concurrent with everything.
- **`exclusive`** — main tree, takes the write lock. The escape hatch for a
  persona that needs uncommitted work, `node_modules`, or a directory that isn't
  a git repo at all.

Create the worktree lazily, on the first *writing* turn — not at bind time, so a
Contact that only ever reads costs nothing. Branch name `persona/<slug>-<short-id>`.

## The hard part: blueprint §6 stops being true

§6 says *"Filesystem state is free — every session reads the live repo on disk,
so code changes are automatically visible across Contacts."* Put a writer on its
own branch and that is false: Code Reviewer in the main tree cannot see Refactor
Buddy's work. That is Journey 2 step 3 exactly.

The answer is three layers, and only the last involves a human.

**1. Awareness — automatic.** A worktree session that commits records its branch,
head sha, and touched files in its Phase 7 end-of-session summary. Phase 7
already injects durable `GroupMessage`s into every session start on that repo, so
the *next* session begins knowing there is unmerged work on
`persona/refactor-buddy` touching `src/auth.ts`. This rides an existing seam and
costs nothing new — which is why `07-group-coordination.md` was told to leave
room for branch metadata in that structured output.

**2. Reading — automatic, and no merge required.** This is the layer that saves
§6. Worktrees share **one object store**, so a sibling's branch is fully readable
from inside your own worktree:

```
git diff main...persona/refactor-buddy
git show persona/refactor-buddy:src/auth.ts
```

Nothing is merged and nobody's tree is touched. §6's "filesystem state is free"
degrades only to "**the object store** is free", which is nearly as good: a
reviewer can review a refactor that exists nowhere on their own disk.

Each session's context gets a short "open sibling branches" block so the model
knows this is available. **Verify `isReadOnlyCommand()` in
`src/main/adapters/sandbox.ts` classifies `git show` / `git diff` / `git log` as
reads** — the post-Phase-5 review hardened that allowlist and put mutating git
subcommands on the deny side, so this needs checking rather than assuming, or a
`read_only` persona cannot use any of it.

**3. Integrating — human, one click.** A persona that needs a sibling's changes
*in its own tree* cannot self-serve, and should not.

- It raises a request, carried as an optional `needs: { branch, reason }` on
  Phase 7's structured summary. Cheaper than exposing an MCP tool for it, though
  `@modelcontextprotocol/sdk` is already a dependency if a richer channel is
  wanted later.
- The Group thread renders it as an actionable row, and a standing **Branches
  panel** lists every open persona branch so the human can act without waiting to
  be asked.
- Row actions: **View diff**, **Merge into `<target working path>`**, **Open PR**
  (Phase 9), **Discard**. Run `git merge --no-commit --no-ff` as a dry run first,
  so the merge button is honest about conflicts *before* it is clicked.
- Merges target a **specific working path**: merging for Code Reviewer touches
  Code Reviewer's tree, not the user's. Nothing merges without a click.

A blocked persona's turn ends normally rather than hanging; after the human
merges, the user re-sends. Auto-resume-on-merge is a natural extension, not v1.

## Costs to state plainly

Not objections — they are real and the doc should say so rather than let someone
discover them:

- **A worktree starts from a commit.** Uncommitted work in the user's main tree
  is invisible inside it. This is why `read_only` personas stay in the main tree
  by default, and why `exclusive` exists.
- **No `node_modules`, no build artifacts.** A fresh worktree can't run a test
  suite until something installs. Fine for reviewers, painful for a "run the
  tests" persona — another `exclusive` case.
- **Non-git directories can't be isolated.** The Phase 6 repo picker allows
  binding a plain folder; those fall back to `exclusive`.
- **Lifecycle is real work.** Create lazily, `git worktree remove` on Contact
  delete, `git worktree prune` on startup, and handle a worktree the user deleted
  by hand.

## Explicitly out of scope

- Automatic merging of any kind. Layer 3 is human by design.
- Cross-repo worktrees, or more than one worktree per Contact.
- Rebasing or conflict *resolution* UI — the dry run reports conflicts, and
  resolving them is the user's job in their own tools.

## Acceptance checks

- [ ] Two `workspace_write` Contacts on the same repo, both `worktree`, run at
      the same time and both complete — neither refused, neither's edits visible
      in the other's tree.
- [ ] `workingPathFor()` returns the worktree path, and the run lock stops
      treating those two as contending.
- [ ] A `read_only` Contact in the main tree can read an unmerged sibling branch
      via `git show`/`git diff` without anything being merged, and without its
      sandbox refusing the command.
- [ ] A writer's end-of-session summary names its branch, and the next session
      on that repo starts already aware of it.
- [ ] The Branches panel lists open persona branches; Merge reports conflicts
      before the click, and merging targets the chosen working path only.
- [ ] Deleting a Contact removes its worktree; a relaunch prunes any orphan.
- [ ] A Contact bound to a plain (non-git) directory still works, as `exclusive`.
