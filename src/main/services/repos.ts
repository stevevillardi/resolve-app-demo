import { dialog } from 'electron'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import { Octokit } from '@octokit/rest'
import { getAppState, setAppState } from './app-state'
import { cloneRepo, isGitRepo } from './git'
import { getGitHubToken } from './github-auth'

/**
 * Binding a Contact to somewhere on disk (blueprint §9.1).
 *
 * Two ways in, deliberately. §9.1 describes the GitHub one — list the user's
 * repos, offer to clone what isn't here yet — and that is the path that makes
 * the app feel like it knows about your work. But a demo that can only bind
 * repos that exist on GitHub *and* clone successfully has two ways to fail
 * before anything interesting happens, so picking a folder that is already on
 * disk is a first-class alternative rather than a fallback.
 */

export interface RepoOption {
  id: string
  fullName: string
  cloneUrl: string
  private: boolean
  /** Absolute path when it is already on disk, null when it would be cloned. */
  localPath: string | null
  updatedAt: number | null
}

export interface BoundRepo {
  path: string
  name: string
  isGitRepo: boolean
}

/**
 * Where clones land. Asked for the first time one is needed, then remembered.
 *
 * Stored in app_state rather than a constant because there is no defensible
 * default: `~/Developer`, `~/code` and `~/src` are all somebody's convention,
 * and silently creating the wrong one scatters checkouts around the disk. It is
 * non-secret metadata, so app_state is the right home (secrets.ts stays the
 * encryption boundary).
 */
export function getWorkspaceRoot(): string | null {
  const root = getAppState('workspace_root')
  // A remembered directory can be deleted or live on a volume that is no longer
  // mounted. Treating that as unset re-asks rather than failing the clone.
  return root && existsSync(root) ? root : null
}

export async function chooseWorkspaceRoot(): Promise<string | null> {
  const chosen = await chooseDirectory('Choose where cloned repositories should go')
  if (chosen) setAppState('workspace_root', chosen.path)
  return chosen?.path ?? null
}

export async function chooseDirectory(title?: string): Promise<BoundRepo | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    ...(title ? { title } : {})
  })

  const path = result.filePaths[0]
  if (result.canceled || !path) return null

  return { path, name: basename(path), isGitRepo: await isGitRepo(path) }
}

/**
 * The user's repos, most recently pushed first.
 *
 * Sorted by push rather than by name because the repo you want to bind is
 * almost always one you touched recently. Capped at one page: this is a picker
 * with a filter box, not an inventory, and an account with hundreds of repos
 * would otherwise spend several seconds paginating before showing anything.
 */
export async function listRepos(): Promise<RepoOption[]> {
  const token = getGitHubToken()
  if (!token) throw new Error('Connect GitHub first to list your repositories.')

  const octokit = new Octokit({ auth: token })
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: 'pushed',
    direction: 'desc',
    per_page: 100,
    affiliation: 'owner,collaborator,organization_member'
  })

  const root = getWorkspaceRoot()

  return data.map((repo) => ({
    id: String(repo.id),
    fullName: repo.full_name,
    cloneUrl: repo.clone_url ?? `https://github.com/${repo.full_name}.git`,
    private: repo.private,
    localPath: root ? existingCheckout(root, repo.name) : null,
    updatedAt: repo.pushed_at ? new Date(repo.pushed_at).getTime() : null
  }))
}

/** A clone already sitting under the workspace root, matched by directory name. */
function existingCheckout(root: string, name: string): string | null {
  const candidate = join(root, name)
  return existsSync(candidate) ? candidate : null
}

/**
 * Clones a repo into the workspace root, asking where that is if unknown.
 *
 * Returns null when the user cancels the directory prompt — a cancel is an
 * answer, not a failure, and the flow steps back rather than showing an error.
 */
export async function cloneToWorkspace(
  fullName: string,
  cloneUrl: string
): Promise<BoundRepo | null> {
  const root = getWorkspaceRoot() ?? (await chooseWorkspaceRoot())
  if (!root) return null

  const name = fullName.split('/').pop() ?? fullName
  const path = await cloneRepo(cloneUrl, root, name, getGitHubToken())

  return { path, name, isGitRepo: true }
}
