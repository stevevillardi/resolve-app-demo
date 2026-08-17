import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * The little bit of git this app runs itself.
 *
 * Deliberately narrow. Blueprint §9 draws the line at not "trusting the agent
 * to shell out raw git commands unsupervised" — that is about *remote* actions,
 * which go through Octokit. This is the local side: cloning a repo so a Contact
 * has somewhere to work, asking whether a directory is a repo at all, the
 * worktree and merge plumbing from Phase 12, and — since Phase 9 — the one
 * remote operation no REST API can perform, which is uploading the commits a
 * pull request is going to be *about*.
 *
 * Shelling out rather than taking a dependency: git is already a hard
 * requirement for everything this app does, a library would be a second
 * implementation to keep in step with it, and `spawn` is a pattern the codebase
 * already uses (codex-auth.ts drives the Codex binary the same way).
 *
 * **On stderr.** The rule that git's stderr is never passed through exists for
 * one specific reason: a remote URL can carry a live token, and git echoes the
 * URL back in most failures (see describeGitError). That reason does not apply
 * to a local-only command — there is no URL in `git worktree add` — so those do
 * surface stderr, via localGitError. The distinction is worth keeping precise
 * rather than generalising the rule to "never", because the failures here are
 * ones the user has to read to act on: "already checked out", "contains modified
 * or untracked files", "is not a working tree".
 */

interface GitResult {
  code: number
  stdout: string
  stderr: string
}

function git(args: string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      ...(cwd ? { cwd } : {}),
      // Nothing here is interactive, and a git that decides to prompt for
      // credentials would hang the main process with no UI to answer it.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += String(chunk)))
    child.stderr.on('data', (chunk) => (stderr += String(chunk)))

    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/**
 * Whether this directory is inside a git working tree.
 *
 * Binding a plain directory is allowed — an agent can still read and edit it —
 * but it is worth knowing, because a non-repo cannot be isolated into a
 * worktree later and has no branch to open a PR from.
 */
export async function isGitRepo(path: string): Promise<boolean> {
  if (!existsSync(path)) return false
  const result = await git(['rev-parse', '--is-inside-work-tree'], path)
  return result.code === 0 && result.stdout.trim() === 'true'
}

/**
 * Clones into `<parent>/<name>`, returning the path it landed at.
 *
 * The token goes in the URL because that is the one form that needs no
 * credential helper and cannot pop an OS prompt behind the app's window. It is
 * the reason `describeGitError` exists: the assembled URL must never reach a
 * log, an error message, or the renderer, and the only way to guarantee that is
 * to never pass git's raw stderr along.
 *
 * **And it must not outlive the command.** git writes the URL it was handed
 * into the new repo's `.git/config` verbatim, credential and all, so a clone
 * done this way leaves a live GitHub token in a plaintext file inside a
 * directory personas then work in — readable by any of them, since the sandbox
 * fences writes to `.git` but not reads. The remote is rewritten to the clean
 * URL immediately; `git-remote.test.ts` covers the local case and the
 * `LIVE_GITHUB` check asserts a real https clone leaves nothing behind.
 */
export async function cloneRepo(
  cloneUrl: string,
  parentDirectory: string,
  name: string,
  token?: string | null
): Promise<string> {
  const destination = join(parentDirectory, name)
  if (existsSync(destination)) {
    throw new Error(`${destination} already exists. Pick it as a local folder instead.`)
  }

  const authenticated = token ? withToken(cloneUrl, token) : cloneUrl
  const result = await git(['clone', authenticated, destination])

  if (result.code !== 0) throw new Error(describeGitError(result.stderr, cloneUrl))

  if (authenticated !== cloneUrl) {
    const scrubbed = await git(['remote', 'set-url', 'origin', cloneUrl], destination)
    // Failing here would leave the token on disk, which is worse than failing
    // the bind: the caller can retry a clone, but nobody would ever be told
    // that a credential is sitting in a file.
    if (scrubbed.code !== 0) {
      throw new Error(
        `Cloned ${cloneUrl}, but could not remove the credential from its git config. ` +
          `Delete ${destination} and try again.`
      )
    }
  }

  return destination
}

/**
 * Injects the token as the userinfo of an https URL. Non-https is left alone.
 *
 * Exported for tests: this and describeGitError are the two places a credential
 * could escape, so they are worth asserting on directly rather than through a
 * real clone.
 */
export function withToken(cloneUrl: string, token: string): string {
  try {
    const url = new URL(cloneUrl)
    if (url.protocol !== 'https:') return cloneUrl
    url.username = 'x-access-token'
    url.password = token
    return url.toString()
  } catch {
    return cloneUrl
  }
}

/**
 * git's stderr, with anything that could carry the token stripped out.
 *
 * git echoes the remote URL back in most failures, and that URL has a live
 * credential embedded in it. Rather than try to redact, the few recognisable
 * cases get written out by hand and everything else becomes a generic message —
 * losing some detail is the right trade against printing a token.
 */
export function describeGitError(stderr: string, safeUrl: string): string {
  if (/Authentication failed|could not read Username|403/i.test(stderr)) {
    return `GitHub refused the clone of ${safeUrl}. The stored token may not cover this repository.`
  }
  if (/not found|Repository not found|404/i.test(stderr)) {
    return `${safeUrl} was not found. It may be private, renamed, or deleted.`
  }
  if (/could not resolve host|network|timed out/i.test(stderr)) {
    return 'Could not reach GitHub. Check the network connection and try again.'
  }
  return `Cloning ${safeUrl} failed.`
}

// --- Remote (Phase 9) --------------------------------------------------------

/**
 * The URL of `origin`, or null when there isn't one.
 *
 * **Never leaves the main process.** A repo the user picked off disk may have
 * been cloned by any tool, including one that left a credential in the remote —
 * the very thing `cloneRepo` now scrubs. Callers want the owner and repo out of
 * it, which is what `githubSlug` is for.
 */
export async function originUrl(repoPath: string): Promise<string | null> {
  const result = await git(['remote', 'get-url', 'origin'], repoPath)
  return result.code === 0 ? result.stdout.trim() || null : null
}

/**
 * The `owner/repo` a remote URL points at, or null if it isn't GitHub.
 *
 * Both forms are real: an app clone is `https://github.com/o/r.git`, and a repo
 * the user picked off disk is as likely to be `git@github.com:o/r.git`. Any
 * other host returns null, which is what hides the PR action rather than
 * failing it — binding a GitLab checkout is allowed, it just has no PR path.
 *
 * Pure and exported for the same reason `withToken` is: userinfo is stripped
 * here, so this is one of the places a credential could escape.
 */
export function githubSlug(remoteUrl: string): { owner: string; repo: string } | null {
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(remoteUrl.trim())
  const path = scp ? (scp[1] === 'github.com' ? scp[2] : null) : httpsPath(remoteUrl)
  if (!path) return null

  const [owner, repo] = path
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
  return owner && repo ? { owner, repo } : null
}

function httpsPath(remoteUrl: string): string | null {
  try {
    const url = new URL(remoteUrl.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.hostname === 'github.com' ? url.pathname : null
  } catch {
    return null
  }
}

/**
 * Uploads a branch to a remote, and nothing else.
 *
 * Three deliberate choices, each of them the difference between a plumbing
 * command and a policy:
 *
 * - **The URL is passed, never configured.** `git push <url>` leaves no trace in
 *   `.git/config` and sets no upstream, so the token exists only for the length
 *   of this one process. It is the same reason `cloneRepo` scrubs its remote.
 * - **A fully-qualified refspec**, so the branch name is never resolved against
 *   whatever `push.default` the user has set.
 * - **No force, ever.** A branch that has diverged from what was pushed is a
 *   thing a human needs to look at; overwriting it silently would discard
 *   somebody's review round.
 */
export async function pushBranch(
  workingPath: string,
  branch: string,
  remoteUrl: string,
  token?: string | null
): Promise<void> {
  const authenticated = token ? withToken(remoteUrl, token) : remoteUrl
  const result = await git(
    ['push', authenticated, `refs/heads/${branch}:refs/heads/${branch}`],
    workingPath
  )

  if (result.code !== 0) throw new Error(describePushError(result.stderr, branch))
}

/**
 * A push failure, without git's stderr.
 *
 * The same rule as `describeGitError` and, like it, written out by hand rather
 * than redacted — git echoes the remote back on nearly every push failure, and
 * that URL is carrying a live token. Separate from `describeGitError` because
 * its messages are all clone-worded, and a user reading "cloning failed" after
 * clicking Open PR would go looking in the wrong place.
 */
export function describePushError(stderr: string, branch: string): string {
  if (/non-fast-forward|fetch first|rejected/i.test(stderr)) {
    return `${branch} has diverged from the copy already on GitHub. Nothing was pushed — reconcile the branch first.`
  }
  if (/Authentication failed|could not read Username|403|denied/i.test(stderr)) {
    return `GitHub refused the push of ${branch}. The stored token may not allow writing to this repository.`
  }
  if (/not found|404/i.test(stderr)) {
    return `The repository this branch belongs to was not found on GitHub. It may be private, renamed, or deleted.`
  }
  if (/could not resolve host|network|timed out/i.test(stderr)) {
    return 'Could not reach GitHub. Check the network connection and try again.'
  }
  return `Pushing ${branch} failed.`
}

// --- Worktrees (Phase 12) ----------------------------------------------------

/**
 * The message for a local command, which may safely quote git.
 *
 * git's own wording is better than anything paraphrased here — it names the
 * other worktree holding a branch, or the files blocking a removal — and none of
 * these commands has a URL in it to leak.
 */
function localGitError(action: string, result: GitResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim()
  return new Error(detail ? `${action}: ${detail}` : action)
}

export interface WorktreeEntry {
  path: string
  branch: string | null
  head: string | null
  /** git's word for a worktree whose directory is gone. `prune` reclaims it. */
  prunable: boolean
}

/**
 * Every worktree git knows about, including the main tree as the first entry.
 *
 * Parsed from `--porcelain` rather than the human format because the human one
 * aligns columns and truncates, and because `prunable` only appears here.
 */
export async function worktreeList(repoPath: string): Promise<WorktreeEntry[]> {
  const result = await git(['worktree', 'list', '--porcelain'], repoPath)
  if (result.code !== 0) throw localGitError('Could not list worktrees', result)

  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null

  for (const line of result.stdout.split('\n')) {
    const [key, ...rest] = line.trim().split(' ')
    const value = rest.join(' ')

    if (key === 'worktree') {
      current = { path: value, branch: null, head: null, prunable: false }
      entries.push(current)
    } else if (!current) {
      continue
    } else if (key === 'HEAD') {
      current.head = value
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '')
    } else if (key === 'prunable') {
      current.prunable = true
    }
  }

  return entries
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const result = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoPath)
  return result.code === 0
}

/**
 * Materialises a worktree at `worktreePath`, on `branch`.
 *
 * Reuses the branch if it already exists rather than failing, because that is
 * the normal state after a user deletes a worktree directory by hand: `prune`
 * reclaims the registration but the branch — and so the work on it — survives.
 * Recreating with `-b` there would refuse, and refusing would strand the work.
 *
 * Cleans up after a failure. A failed `git worktree add -b` still leaves the
 * branch behind, which would then make the *next* attempt take the reuse path
 * against a branch pointing at nothing meaningful.
 */
export async function worktreeAdd(
  repoPath: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  await worktreePrune(repoPath)

  const reuse = await branchExists(repoPath, branch)
  const args = reuse
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', worktreePath, '-b', branch]

  const result = await git(args, repoPath)
  if (result.code === 0) return

  if (!reuse) await git(['branch', '-D', branch], repoPath)
  throw localGitError(`Could not create a worktree at ${worktreePath}`, result)
}

/**
 * Removes a worktree. `force` is required to discard uncommitted work.
 *
 * The branch deliberately survives: removing a Contact should not silently
 * destroy commits nobody has merged. Orphaned branches show up in the Branches
 * panel, which is where a human can decide.
 */
export async function worktreeRemove(
  repoPath: string,
  worktreePath: string,
  force = false
): Promise<void> {
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]
  const result = await git(args, repoPath)
  if (result.code === 0) return

  // Already gone by other means — the desired end state, not a failure.
  if (/is not a working tree|No such file or directory/i.test(result.stderr)) {
    await worktreePrune(repoPath)
    return
  }

  throw localGitError(`Could not remove the worktree at ${worktreePath}`, result)
}

/** Reclaims registrations whose directories the user deleted by hand. */
export async function worktreePrune(repoPath: string): Promise<void> {
  await git(['worktree', 'prune'], repoPath)
}

/**
 * The directories a session working in `worktreePath` must be able to write to.
 *
 * A linked worktree's `.git` is a *file* pointing back into the main repo, so
 * every git write — the index, a new object, a ref update — lands outside the
 * worktree directory. A sandbox fenced to the working directory therefore fails
 * at `git add`, which was verified rather than assumed (see the Phase 12 plan).
 *
 * The set is deliberately the narrowest that permits a commit. It excludes
 * `.git/hooks` and `.git/config`, and that exclusion is the point: a writable
 * hooks directory is a sandbox escape, because a hook written during a turn runs
 * unsandboxed on the user's next git command.
 *
 * The per-worktree directory is read from git rather than derived, because git
 * dedupes the name from the path's basename — two worktrees called `work` become
 * `work` and `work1`.
 */
export async function gitWritePathsFor(worktreePath: string): Promise<string[]> {
  const [own, common] = await Promise.all([
    git(['rev-parse', '--absolute-git-dir'], worktreePath),
    git(['rev-parse', '--path-format=absolute', '--git-common-dir'], worktreePath)
  ])

  if (own.code !== 0) throw localGitError(`${worktreePath} is not a git working tree`, own)
  if (common.code !== 0) throw localGitError(`${worktreePath} has no shared git directory`, common)

  const ownDir = own.stdout.trim()
  const commonDir = common.stdout.trim()

  // A Contact in the main tree has no separate git dir; repoPath already covers
  // it and there is nothing extra to grant.
  if (ownDir === commonDir) return []

  return [ownDir, join(commonDir, 'objects'), join(commonDir, 'refs'), join(commonDir, 'logs')]
}

export interface BranchRef {
  branch: string
  headSha: string
  /** Epoch ms of the tip commit, for ordering the panel by recency. */
  committedAt: number
}

/**
 * Every branch under a prefix, with its tip.
 *
 * `for-each-ref` rather than `branch --list` because its output is a format
 * string rather than a human table — no column alignment, no `*` on the current
 * branch, and no truncation to fit a terminal.
 */
export async function listBranches(repoPath: string, prefix: string): Promise<BranchRef[]> {
  const result = await git(
    [
      'for-each-ref',
      '--format=%(refname:short)%09%(objectname)%09%(committerdate:unix)',
      `refs/heads/${prefix}`
    ],
    repoPath
  )
  if (result.code !== 0) throw localGitError('Could not list branches', result)

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [branch, headSha, committed] = line.split('\t')
      return { branch, headSha, committedAt: Number(committed) * 1000 }
    })
}

export async function headSha(workingPath: string): Promise<string | null> {
  const result = await git(['rev-parse', 'HEAD'], workingPath)
  return result.code === 0 ? result.stdout.trim() : null
}

/** Whether there is anything uncommitted, tracked or not. */
export async function isDirty(workingPath: string): Promise<boolean> {
  return (await dirtyFiles(workingPath)).length > 0
}

/**
 * Everything uncommitted, tracked or not.
 *
 * The paths matter and not just the count: a persona that ended a turn without
 * committing has to be told *what* it left behind, or the user has to go and
 * look before they can decide whether to commit it or throw it away.
 */
export async function dirtyFiles(workingPath: string): Promise<string[]> {
  const result = await git(['status', '--porcelain'], workingPath)
  if (result.code !== 0) throw localGitError(`Could not read the status of ${workingPath}`, result)

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
}

/** The checked-out branch, or null when HEAD is detached or the repo is empty. */
export async function currentBranch(workingPath: string): Promise<string | null> {
  const result = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], workingPath)
  return result.code === 0 ? result.stdout.trim() || null : null
}

/**
 * Every file in the working tree as git sees it: tracked, plus untracked
 * that isn't ignored. Feeds the composer's @file autocomplete, which is why
 * ignored files are excluded — offering node_modules paths would bury the
 * ones anyone actually types.
 */
export async function listTrackedFiles(workingPath: string): Promise<string[]> {
  const result = await git(['ls-files', '--cached', '--others', '--exclude-standard'], workingPath)
  if (result.code !== 0) throw localGitError(`Could not list the files of ${workingPath}`, result)

  return result.stdout.split('\n').filter(Boolean)
}

/**
 * Subject lines of the commits `branch` has and `base` does not.
 *
 * Null — distinct from an empty array — when the range cannot be resolved,
 * which happens when the repo has no local ref for the remote's default branch.
 * The difference matters: empty means "nothing to open a PR about" and is worth
 * refusing on, while null means "this check cannot be run here" and must not be
 * mistaken for it.
 */
export async function commitSubjects(
  repoPath: string,
  base: string,
  branch: string
): Promise<string[] | null> {
  const result = await git(['log', '--format=%s', `${base}..${branch}`], repoPath)
  if (result.code !== 0) return null
  return result.stdout.split('\n').filter(Boolean)
}

/**
 * Files `branch` changed relative to where it diverged from `base`.
 *
 * Three dots, not two: the question is "what did this branch do", not "how does
 * it differ from base right now", and those stop being the same answer as soon
 * as base moves on.
 */
export async function changedFiles(
  repoPath: string,
  base: string,
  branch: string
): Promise<string[]> {
  const result = await git(['diff', '--name-only', `${base}...${branch}`], repoPath)
  if (result.code !== 0) return []
  return result.stdout.split('\n').filter(Boolean)
}

export interface MergePreview {
  clean: boolean
  conflicts: string[]
}

/**
 * Whether `source` merges into `target` cleanly — without touching anything.
 *
 * `merge-tree --write-tree` performs the merge entirely in the object store: no
 * working tree is modified, no HEAD moves, nothing needs aborting. The obvious
 * alternative, `merge --no-commit --no-ff`, is a dry run that *isn't* — it leaves
 * the target tree conflicted on failure, which is a poor thing to do to a
 * directory somebody is working in.
 *
 * Answers "do these two commits merge cleanly". It says nothing about
 * uncommitted work in the target tree, which is why merging checks isDirty
 * separately.
 */
export async function mergePreview(
  repoPath: string,
  target: string,
  source: string
): Promise<MergePreview> {
  const result = await git(['merge-tree', '--write-tree', '--name-only', target, source], repoPath)

  if (result.code === 0) return { clean: true, conflicts: [] }
  if (result.code !== 1) throw localGitError('Could not compare the branches', result)

  // Output is the merged tree's oid, then the conflicted paths, then a blank
  // line and git's informational messages.
  const [, ...rest] = result.stdout.split('\n')
  const conflicts: string[] = []
  for (const line of rest) {
    if (line.trim() === '') break
    conflicts.push(line.trim())
  }

  return { clean: false, conflicts }
}

/**
 * Merges `branch` into whatever is checked out at `workingPath`.
 *
 * `--no-ff` so the merge is a visible event in the history rather than a silent
 * fast-forward: the point of this button is that a human chose to take somebody
 * else's work.
 */
export async function mergeBranch(workingPath: string, branch: string): Promise<void> {
  const result = await git(['merge', '--no-ff', '--no-edit', branch], workingPath)
  if (result.code === 0) return

  // Leave nothing half-applied. The preview is meant to have caught this, but a
  // tree can change between previewing and clicking.
  await git(['merge', '--abort'], workingPath)
  throw localGitError(`Could not merge ${branch}`, result)
}

/** Used when a Contact is deleted and its branch turns out to hold nothing. */
export async function deleteBranch(repoPath: string, branch: string, force = false): Promise<void> {
  const result = await git(['branch', force ? '-D' : '-d', branch], repoPath)
  if (result.code !== 0) throw localGitError(`Could not delete ${branch}`, result)
}

// --- Diffs & landing (Phase 19) ----------------------------------------------

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface ChangedEntry {
  path: string
  /** Only for renames: where the content used to live. */
  oldPath?: string
  status: ChangeStatus
}

/** Where `branch` diverged from `ref` — the base a three-dot diff is against. */
export async function mergeBase(cwd: string, a: string, b: string): Promise<string | null> {
  const result = await git(['merge-base', a, b], cwd)
  return result.code === 0 ? result.stdout.trim() || null : null
}

/**
 * What changed between two revisions, with renames detected.
 *
 * `-M` matters for review: without it a rename reads as a delete plus an add,
 * which is the most alarming possible rendering of the least alarming change.
 * Copies (`C`) are folded into `added` and type changes (`T`) into `modified` —
 * both are rare, and a reviewer cares what the file *is*, not git's taxonomy.
 */
export async function diffNameStatus(
  cwd: string,
  from: string,
  to: string
): Promise<ChangedEntry[]> {
  const result = await git(['diff', '--name-status', '-M', from, to], cwd)
  if (result.code !== 0) throw localGitError('Could not diff the revisions', result)

  const entries: ChangedEntry[] = []
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue
    const [code, ...paths] = line.split('\t')
    const kind = code[0]
    if (kind === 'R' && paths.length === 2) {
      entries.push({ path: paths[1], oldPath: paths[0], status: 'renamed' })
    } else if (kind === 'C' && paths.length === 2) {
      entries.push({ path: paths[1], status: 'added' })
    } else if (kind === 'A') {
      entries.push({ path: paths[0], status: 'added' })
    } else if (kind === 'D') {
      entries.push({ path: paths[0], status: 'deleted' })
    } else {
      // M, T, and anything git invents later: it exists on both sides.
      entries.push({ path: paths[0], status: 'modified' })
    }
  }
  return entries
}

/**
 * The paths whose change between two revisions is binary — `--numstat` prints
 * `-` for both counts. Rename lines arrive as `src/{old => new}` (or a bare
 * `old => new`) and are resolved to the new path, matching diffNameStatus.
 */
export async function binaryPaths(cwd: string, from: string, to: string): Promise<Set<string>> {
  const result = await git(['diff', '--numstat', '-M', from, to], cwd)
  if (result.code !== 0) return new Set()

  const paths = new Set<string>()
  for (const line of result.stdout.split('\n')) {
    const [added, deleted, ...rest] = line.split('\t')
    if (added !== '-' || deleted !== '-' || rest.length === 0) continue
    const raw = rest.join('\t')
    const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw)
    if (braced) paths.add(`${braced[1]}${braced[3]}${braced[4]}`)
    else if (raw.includes(' => ')) paths.add(raw.split(' => ')[1])
    else paths.add(raw)
  }
  return paths
}

export interface FileAtRev {
  /** Null when the path does not exist at that revision, or was too large. */
  text: string | null
  /** True when the file exists but was over the cap — text is withheld, not empty. */
  truncated: boolean
}

/**
 * A file's content at a revision, refused (not clipped) over `maxBytes`.
 *
 * Size is asked first via `cat-file -s` so a huge blob is never buffered at
 * all. Withholding rather than clipping because a clipped diff pane silently
 * reviews half a file — "too large to render here" is honest, half is not.
 */
export async function fileAtRev(
  cwd: string,
  rev: string,
  path: string,
  maxBytes: number
): Promise<FileAtRev> {
  const size = await git(['cat-file', '-s', `${rev}:${path}`], cwd)
  if (size.code !== 0) return { text: null, truncated: false }
  if (Number(size.stdout.trim()) > maxBytes) return { text: null, truncated: true }

  const result = await git(['show', `${rev}:${path}`], cwd)
  if (result.code !== 0) return { text: null, truncated: false }
  return { text: result.stdout, truncated: false }
}

/** Whether `ref` is already contained in `of` — "merged", as git defines it. */
export async function isAncestor(cwd: string, ref: string, of: string): Promise<boolean> {
  const result = await git(['merge-base', '--is-ancestor', ref, of], cwd)
  return result.code === 0
}

/**
 * Files that changed between two specific commits — a two-dot question, unlike
 * changedFiles' three-dot one. This is per-turn arithmetic: head-before to
 * head-after of one turn, where a moving base has no meaning.
 */
export async function diffNameOnlyBetween(
  cwd: string,
  from: string,
  to: string
): Promise<string[]> {
  const result = await git(['diff', '--name-only', from, to], cwd)
  if (result.code !== 0) return []
  return result.stdout.split('\n').filter(Boolean)
}

/**
 * Stages everything and commits it, returning the new head.
 *
 * The one place the app authors a commit, and it is reached only from a click
 * (see docs/plan/19-review-landing.md) — Phase 9's refusal to commit
 * *unattended* work still stands on every turn and routine path. `--author`
 * attributes the work to the persona while the user, whose click this was,
 * stays the committer git's own config names.
 */
export async function commitAll(
  cwd: string,
  message: string,
  author: { name: string; email: string }
): Promise<string> {
  const add = await git(['add', '-A'], cwd)
  if (add.code !== 0) throw localGitError('Could not stage the changes', add)

  const commit = await git(
    ['commit', '-m', message, `--author=${author.name} <${author.email}>`],
    cwd
  )
  if (commit.code !== 0) throw localGitError('Could not commit the changes', commit)

  const head = await headSha(cwd)
  if (!head) throw new Error(`Committed, but could not read the new head of ${cwd}.`)
  return head
}
