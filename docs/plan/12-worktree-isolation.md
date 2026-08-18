# Phase 12 — Worktree Isolation

**Status:** Done — every acceptance check verified, including live on both backends
**Blueprint refs:** §6 (shared context), §15D (concurrency), §13 (v1 scope cuts)
**Depends on:** Phase 6 (the write lock and its `workingPathFor` seam), Phase 7 (durable summaries, which carry branch awareness)
**Runs:** between Phases 8 and 9 in execution order, despite the number — numbered 12 so nothing else had to be renumbered.

## Why this exists

Phase 6 narrowed blueprint §15D from "one run per repo" to a **write lock**:
`read_only` personas take a shared hold and are never refused (true of the code
only since Phase 7 — see the §15D decision entry in `00-progress.md`), so a reviewer can
read a repo while a refactor runs. That freed the read-heavy majority, and it is
why Journey 2 works without anything here.

Two _writing_ personas on one repo still queue. That is a real limit rather than
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

### 2. Schema — migration `0007`, additive

> Renumbered twice: Phase 7 took `0005` for `group_messages.branch`, the column
> this phase's awareness layer writes into, and the Phase 6/7 close-out took
> `0006` for `usage_events.session_id`. `branch` already exists — what is still
> unclaimed is `needs`, which nothing has modelled yet.

| Table      | Column                    | Meaning                                                     |
| ---------- | ------------------------- | ----------------------------------------------------------- |
| `contacts` | `worktree_path TEXT NULL` | where this Contact actually works; null = the repo itself   |
| `contacts` | `branch TEXT NULL`        | the branch its worktree is on                               |
| `contacts` | `isolation TEXT NULL`     | `shared` / `worktree` / `exclusive`; null reads as `shared` |

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
  the right directory. ~~with **no change to `sandbox.ts`**~~ — **this was wrong,
  and it is the finding the phase turns on.** A linked worktree's `.git` is a
  _file_ pointing at `<repo>/.git/worktrees/<name>`, so the index, every new
  object and every ref update land _outside_ the working directory: a sandbox
  fenced to the cwd fails at `git add`. `SessionSpec` gained `writablePaths`,
  resolved by `gitWritePathsFor()` and applied as Claude's `allowWrite` and
  Codex's `--add-dir`. The grant is the narrowest that permits a commit
  (`worktrees/<name>` + `objects` + `refs` + `logs`) and deliberately excludes
  `.git/hooks` and `.git/config` — a writable hooks directory is a sandbox
  _escape_, because a hook written during a turn runs unsandboxed on the user's
  next git command. `isInsideRepo()` itself is unchanged, as promised.

### 4. Chosen per Contact, at bind time

`NewContactFlow` gains an isolation step. Per Contact rather than per persona
because the same persona may want isolation on one repo and not another.

- **`shared`** — runs in the main tree. Default for `read_only`. Never locks.
- **`worktree`** — own checkout and branch. Concurrent with everything.
- **`exclusive`** — main tree, takes the write lock. The escape hatch for a
  persona that needs uncommitted work, `node_modules`, or a directory that isn't
  a git repo at all.

Create the worktree lazily, on the first _writing_ turn — not at bind time, so a
Contact that only ever reads costs nothing. Branch name `persona/<slug>-<short-id>`.

## The hard part: blueprint §6 stops being true

§6 says _"Filesystem state is free — every session reads the live repo on disk,
so code changes are automatically visible across Contacts."_ Put a writer on its
own branch and that is false: Code Reviewer in the main tree cannot see Refactor
Buddy's work. That is Journey 2 step 3 exactly.

The answer is three layers, and only the last involves a human.

**1. Awareness — automatic.** A worktree session that commits records its branch,
head sha, and touched files in its Phase 7 end-of-session summary. Phase 7
already injects durable `GroupMessage`s into every session start on that repo, so
the _next_ session begins knowing there is unmerged work on
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
_in its own tree_ cannot self-serve, and should not.

- It raises a request, carried as an optional `needs: { branch, reason }` on
  Phase 7's structured summary. Cheaper than exposing an MCP tool for it, though
  `@modelcontextprotocol/sdk` is already a dependency if a richer channel is
  wanted later.
- The Group thread renders it as an actionable row, and a standing **Branches
  panel** lists every open persona branch so the human can act without waiting to
  be asked.
- Row actions: **Merge into `<target working path>`** and **Discard** (Open PR
  waits for Phase 9). The conflict check is `git merge-tree --write-tree`, not
  the `git merge --no-commit --no-ff` this doc originally proposed — that one is
  a dry run that _isn't_, leaving the target tree conflicted on failure, which is
  a poor thing to do to a directory somebody is working in. `merge-tree` merges
  in the object store: exit 1 signals conflicts, `--name-only` names the files,
  and HEAD and the working tree are untouched. It answers "do these two commits
  merge cleanly", so a dirty target is reported separately — conflating the two
  would make the button lie in the one case the user most needs it not to.
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
- Rebasing or conflict _resolution_ UI — the dry run reports conflicts, and
  resolving them is the user's job in their own tools.

## Acceptance checks

- [x] Two `workspace_write` Contacts on the same repo, both `worktree`, get
      separate checkouts and neither's edits appear in the other's tree —
      `e2e/worktrees.spec.ts`, against the real app on a real repo. **The
      "both complete" half is still open**: it needs two paid turns, see below.
- [x] `workingPathFor()` returns the worktree path, and the run lock stops
      treating those two as contending — `run-lock.test.ts`, a deliberate edit
      to the test that pinned the old answer, plus the matrix for decision 5
      below.
- [x] A `read_only` Contact can read an unmerged sibling branch via
      `git show`/`git diff` without anything merged and without the sandbox
      refusing — measured directly under a write fence, and the allowlist
      already permitted all three commands (`sandbox.test.ts`).
- [x] A writer's end-of-session summary names its branch, and the next session
      on that repo starts already aware of it — `compaction.test.ts` for the
      stamping, `context.test.ts` for the injected block. Stamped by git, not
      reported by the model.
- [x] The Branches panel lists open persona branches; Merge reports conflicts
      before the click, and merging targets the chosen working path only —
      `branches.test.ts`, including that the preview leaves HEAD and the working
      tree untouched.
- [x] Deleting a Contact removes its worktree; a relaunch prunes any orphan —
      `worktrees-lifecycle.test.ts` and `e2e/worktrees.spec.ts`. The branch
      survives both, deliberately.
- [x] A Contact bound to a plain (non-git) directory still works, as
      `exclusive` — the bind flow disables the worktree option with the reason
      when the folder is not a repo.

### The paid live checks, run 2026-08-16

All three ran against real backends, on **both** Claude and Codex, in
`src/main/services/worktrees.live.test.ts` (skipped unless `LIVE_WORKTREES=1`,
the same house rule as `journey2.live.test.ts`). Running per backend is the
point rather than thoroughness theatre: the two reach the sandbox by different
routes — `sandbox.filesystem.allowWrite` versus `--add-dir` — so one passing
says nothing about the other.

- [x] **A worktree writer actually commits.** Claude: reply _"Add GREETING
      constant to util.ts"_, branch moved past `main`, `git show <branch>:util.ts`
      contains the constant, and the user's own checkout is untouched and clean.
      Codex: the same, on the same assertions.
- [x] **Two writers run at once and both complete.** Neither refused, each file
      present in its own tree and absent from the other's and from the user's.
- [x] **A `read_only` Contact reads an unmerged sibling branch.** Asked for the
      name of a constant that exists only on the writer's branch, it answered
      `GREETING` — a string that appears nowhere in its own working directory
      and nowhere in the prompt.

Cost: about $0.84 per full Claude run at `claude-sonnet-5`, $0.08 on Codex at
`gpt-5.4-mini`.

Branch awareness was confirmed as a side effect, which is the cheapest kind of
confirmation: the summaries came back stamped `on persona/refactor-buddy-…` with
text of their own accord saying the work _"is not checked out in the main tree"_.

## Verified live (2026-08-16)

Everything below was measured, not reasoned about.

- **git 2.50.1 lifecycle**, all of it surprising in at least one direction: two
  worktrees cannot share a branch (hard `fatal`); `prune` reclaims a
  hand-deleted worktree and **the branch survives**, which is what makes that
  deletion recoverable; `worktree remove` refuses a dirty tree without `--force`
  and the branch survives removal too; a _failed_ `add` still creates its
  branch, which had to be cleaned up or the next attempt would silently reuse a
  branch pointing at nothing meaningful; `add` creates missing intermediate
  directories; and `.git/worktrees/<name>` is deduped from the path's basename
  (`work`, `work1`), so it cannot be derived and has to be read.
- **Branch names need slugging.** `persona/Code Reviewer-x1` and
  `persona/weird..name` are both rejected by `git check-ref-format`, so the
  tests ask git rather than encoding a guess about its rules.
- **The `needs` field passes strict structured output on both backends**, each
  returning `needs: null` and parsing cleanly. Nested objects need their own
  `required` and `additionalProperties: false` or every summary is rejected.
- **Mutation-tested rather than trusted green**, per the repo's rule: collapsing
  the worktree name, forcing the worktree removal, granting the whole `.git`,
  and swapping `merge-tree` back for `merge --no-commit` each fail exactly the
  test written from the corresponding claim.

## The defect the live pass found

Gate 2 failed the first time it ran on `claude-sonnet-5`, and only there: seven
runs on haiku and every Codex run passed. The failure was a permission denial on
one writer, and the message named no path, so the first job was to make the
adapter say _what_ had been refused. With that in place it reproduced
immediately and both writers named the same shape of target:

    Blocked Write: this persona's sandbox does not allow it.
    Refused: …/my-app/.git/worktrees/refactor-buddy-9d98/a.ts

Asked to create `a.ts`, the model resolved the bare relative name against the
repository's **git admin directory** — which is writable, because that is where
git puts the index a commit has to lock — rather than against its own working
tree. The right basename, the wrong parent. Both layers refused it correctly, so
nothing escaped; the turn simply failed to do its work.

Gate 1 never hit this because it _edits an existing file_, which gives the model
an unambiguous path. It takes a **new** file with a bare name to expose it — and
personas create files constantly, so this was a real defect rather than an
artefact of the test prompt.

The fix is to stop leaving it ambiguous: a session running somewhere other than
its repo now gets a short "Where you are working" block naming its working
directory, its repo, its branch, and saying not to write inside `.git`. Two
sonnet runs of gate 2 immediately after, then a third full-file run in the exact
configuration that had failed: no denials in any of them.

Worth stating plainly: **no unit test could have found this.** Every one of them
mocks the adapter, and a mocked adapter never resolves a path.

## Limitations, recorded rather than solved

- **Two repos with the same basename share a worktree directory name.** The
  path is `<userData>/worktrees/<repo-name>/<persona-slug>-<short-id>`, and the
  repo component is the basename. Two Contacts always differ by short id, so
  nothing collides in practice, but the directory is named for readability and
  it is the _branch_ that git actually polices.
- **A packed ref reports no head in the sibling-branch block.** The list is
  resolved synchronously while the session spec is built, so it reads
  `refs/heads/<branch>` off disk rather than running git. Worktree branches are
  freshly written and so loose in practice; a packed one simply loses its short
  sha annotation, and the branch name — the load-bearing part — is unaffected.
- **`branches.list` shells out to git per repo.** Fine for a panel the user
  navigates to; it would not survive being polled.
