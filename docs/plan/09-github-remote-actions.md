# Phase 9 — GitHub Remote Actions

**Status:** Done
**Blueprint refs:** §9.2 (remote actions), §15D/§4 (githubScope governance)
**Depends on:** Phase 3 (GitHub auth token already stored), Phase 6 (real sessions producing changes to act on), Phase 12 (a writer already works on its own branch)

## Goal

Real write-side GitHub actions — push, open PR, comment — performed via the GitHub REST API (Octokit) from the main process, never by trusting an agent to shell out raw git commands unsupervised (blueprint §9 is explicit on this boundary). Surfaced as explicit user-triggered actions, not automatic side effects of a session ending.

## Scope

1. **Octokit REST client** (`@octokit/rest`) in the main process, authenticated with the token stored in Phase 3's `safeStorage` service.
   - Phase 6 already built one for the repo picker — see `listRepos()` in
     `src/main/services/repos.ts`, which reads the token through
     `getGitHubToken()`. Extract the client rather than constructing a third.
   - Local git also already exists: `src/main/services/git.ts` (built in Phase 6
     for cloning) is where push plumbing belongs. Note its rule — git's stderr
     is **never** passed through, because the clone URL carries a live token and
     git echoes the remote back on most failures.

2. **`OpenPRButton`**
   - Wire Phase 2's shell to a real action: given a Contact's session has made local changes (detect via git status on the bound `repoPath`, or track explicitly if the adapter reports files changed), push the branch and open a PR via the API.
   - **Much cleaner once `12-worktree-isolation.md` has landed**, and worth
     sequencing after it if the order is still open. A worktree Contact already
     works on its own branch, so "Open PR" pushes *that* branch — rather than
     having to invent one from whatever state the user's own working tree
     happens to be in, which is the awkward case this step otherwise has to
     handle. A Contact bound to a plain directory (not a git repo at all — the
     picker allows it) has no branch and no PR path; hide the action rather than
     failing it.
   - This is explicitly a user-clicked action for interactive sessions (blueprint §9: "surface as an explicit action... not an automatic side effect").
   - For routine-triggered runs (Phase 8), this same code path is what fires automatically at the end of a routine run that made changes — reconcile this with the "explicit action" framing: the distinction is that the *routine itself* is the explicit, user-configured trigger (the user set `githubScope: open_pr` and enabled the routine), not that a human clicks a button per run. Document this distinction clearly since it's a subtle point the blueprint raises but doesn't fully spell out.

3. **`githubScope` enforcement**
   - `read_only` — no write API calls available to that persona's Contact, full stop (buttons disabled/hidden in UI).
   - `open_pr` — can push a branch and open a PR, cannot merge or push directly to a protected branch.
   - `full_access` — can push directly, merge, etc.
   - Per blueprint §13: this is "a permission label on the persona, not hard-enforced beyond what the token itself allows" — so enforcement is at the app's action-gating layer (don't show/allow the button), not a cryptographic guarantee. State this plainly in the UI copy if it comes up (e.g. a tooltip on a disabled action), matching blueprint §15B's precedent of stating v1 simplifications plainly rather than implying stronger guarantees than exist.

4. **Comment action** — post a comment on an existing PR/issue via the API, exposed wherever it's contextually relevant (e.g. Journey 3's "check for newly reported issues" could plausibly want to comment, not just open a PR — decide based on what the routine prompt actually asks for).

## Explicitly out of scope

- Any automatic merge — full_access allows it via API capability, but no UI shortcut is being asked for here beyond what's needed for the demo journeys.
- Branch protection rule management — out of scope entirely, not a v1 concern.

## Acceptance checks

- [x] From a `workspace_write` + `open_pr` Contact with real local changes, clicking `OpenPRButton` produces a real PR on GitHub, verified by checking the repo. — **PRs #1 and #3 on `stevevillardi/persona-router-live`, 2026-08-16**, asserted through the API rather than through this app's own return value.
- [x] A `read_only` persona has no path to any write action anywhere in the UI. — the gate is in `pull-requests.ts`, not the button; `e2e/github.spec.ts` asserts both halves, and says plainly which of the two has teeth without a token.
- [x] A routine configured with `open_pr` that makes changes ends by opening a PR automatically (no push to the default/protected branch). — `journey3.live.test.ts`, two sonnet runs, PRs #3 and #4.
- [x] Attempting a push/PR action with an expired or revoked GitHub token surfaces a clear error, not a silent failure. — verified live with a corrupted token; the message names reconnecting, and the read behind the button degrades to "no PR" rather than erroring at somebody who never clicked anything.

### Running the live checks

Both are opt-in and both point at a throwaway repo — `stevevillardi/persona-router-live`,
created for this and safe to delete. They close their own pull requests and delete
their own branches on the way out, so the repo stays reusable.

```
GITHUB_TOKEN=$(gh auth token) GITHUB_LIVE_REPO=stevevillardi/persona-router-live \
  LIVE_GITHUB=1 npx vitest run --project main src/main/services/github.live.test.ts

GITHUB_TOKEN=$(gh auth token) GITHUB_LIVE_REPO=stevevillardi/persona-router-live \
  LIVE_JOURNEY3=1 npx vitest run --project main src/main/services/journey3.live.test.ts
```

The first spends **nothing** — it commits with git, because what is under test is
the remote half. Only Journey 3 pays for a model, and `JOURNEY3_BACKEND=codex`
runs it on the other one. The token comes from the environment because
`safeStorage` needs an Electron main process these files do not have.

## What was built

| Piece | Where |
|---|---|
| Octokit as a port, with the only place a status code is read | `src/main/services/github-client.ts` (`listRepos` refactored onto it, gaining its first tests) |
| `originUrl`, `githubSlug`, `pushBranch`, `describePushError`, and the clone credential fix | `src/main/services/git.ts` |
| The gate chain, create-or-comment, and the PR body | `src/main/services/pull-requests.ts` |
| `github.pullRequestState` / `github.openPullRequest` | `src/shared/ipc-contract.ts`, `src/main/ipc/procedures/github.ts`, `src/renderer/src/hooks/usePullRequests.ts` |
| The action, in a thread and in the Branches panel | `OpenPRButton.tsx`, `ThreadView.tsx`, `BranchDetail.tsx` (`branchSummarySchema` gained `githubScope`) |
| The unattended pull request | `src/main/services/scheduler.ts` |

**No migration.** GitHub already knows whether a branch has an open pull request,
and `GET /pulls?state=open&head=owner:branch` answers it directly — so PR state is
a read cached by the query client rather than a table that would go stale the
moment somebody merged in a browser.

## Decisions this phase made

- **The gate is in the service, not the button.** `OpenPRButton` has hidden itself
  for `read_only` since Phase 2, and that was the entire enforcement — the
  procedure behind it was callable regardless. Blueprint §13 is right that this is
  "a permission label, not hard-enforced beyond what the token allows"; what the
  app owes is one gate, at the action.
- **The app never authors a commit.** A turn can end with a dirty tree, and the
  tempting fix is to commit on the persona's behalf so an unattended run is not
  wasted. Refused on both paths instead: the first commit this app ever authored
  should not be an unattended one made of work nobody has read. The refusal names
  the files.
- **A second attempt comments rather than opening a duplicate.** A persona
  addressing review feedback pushes to the same branch, and `createPr` would fail
  with GitHub's own 422 at best.
- **A routine's PR is not the exception §9 forbids.** §9 wants remote actions
  explicit rather than automatic. The explicit act is *setting the routine up* —
  an `open_pr` persona, a prompt, a schedule — not a click per fire, because
  nobody is awake at 3am to give one. The bound that matters is preserved: a pull
  request, never a push to the default branch, for `full_access` too.
- **Full access gets no merge button.** The scope is checked and honoured, but no
  UI shortcut for merging was built — out of scope per this doc's own exclusion
  list, and nothing in the demo journeys asks for one.

## Found while building

- **The clone flow was leaving the GitHub token on disk.** `cloneRepo` passed a
  credential-bearing URL to `git clone`, and git writes the URL it is handed
  verbatim into the new repo's `.git/config` — so every app-cloned repo held a
  live token in a plaintext file inside a directory personas then work in.
  `gitWritePathsFor` fences `.git` against *writes*; nothing restricts reads.
  Reproduced before fixing. The remote is now scrubbed to the clean URL as part
  of the clone, `pushBranch` passes its URL rather than configuring one, and
  `github.live.test.ts` asserts a real clone leaves nothing behind. **Not fixed:**
  the token is still visible in the process argument list while git runs. Closing
  that needs a credential helper on stdin, which is not built here.
- **The "Where you are working" block was half a fix.** Journey 3 failed on its
  first live run: asked for `src/<file>.ts`, a directory that existed in neither
  checkout, the persona created it in the **repository** — the other path that
  block names. Phase 12 found the first half of this (a bare filename resolved
  against the git admin directory); this is the second. A missing parent
  directory sends a model looking for the canonical copy of the project, and the
  block was naming one without saying it was out of bounds. See the decision
  entry in `00-progress.md`.
- **A routine's bookkeeping must not wait on GitHub.** The first version recorded
  `lastRunAt` after the pull-request attempt, which put a fire's own record
  behind a network call with no deadline. A scheduler unit test caught it. The
  outcome is now written first and appended to afterwards.

## Deferred out of this phase

Blueprint §16 Journey 3's *"it reads the repo/issues"* step. Nothing gives a
persona any view of GitHub issues, and the reason is structural rather than an
oversight: `claude.ts` passes `settingSources: []` deliberately, and no
`mcpServers` are passed on either backend. Building a one-off issue-fetch for one
journey would have been the wrong shape. Scoped instead as
[`14-agent-capability-surface.md`](14-agent-capability-surface.md), which is where
that step closes. Everything else in Journey 3 is verified live here.
