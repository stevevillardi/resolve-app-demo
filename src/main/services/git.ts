import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * The little bit of git this app runs itself.
 *
 * Deliberately narrow. Blueprint §9 draws the line at not "trusting the agent
 * to shell out raw git commands unsupervised" — that is about *remote* actions,
 * which go through Octokit in Phase 9. This is the local side: cloning a repo
 * so a Contact has somewhere to work, and asking whether a directory is a repo
 * at all. The worktree phase adds `worktree add/remove/prune` here.
 *
 * Shelling out rather than taking a dependency: git is already a hard
 * requirement for everything this app does, a library would be a second
 * implementation to keep in step with it, and `spawn` is a pattern the codebase
 * already uses (codex-auth.ts drives the Codex binary the same way).
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
