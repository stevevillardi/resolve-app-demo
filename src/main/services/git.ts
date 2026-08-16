import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * The little bit of git this app runs itself.
 *
 * Deliberately narrow. Blueprint §9 draws the line at not "trusting the agent
 * to shell out raw git commands unsupervised" — that is about *remote* actions,
 * which go through Octokit in Phase 9. This is the local side: cloning a repo so
 * a Contact has somewhere to work, asking whether a directory is a repo at all,
 * and since Phase 12 the worktree and merge plumbing.
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
  const result = await git(['status', '--porcelain'], workingPath)
  if (result.code !== 0) throw localGitError(`Could not read the status of ${workingPath}`, result)
  return result.stdout.trim().length > 0
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
