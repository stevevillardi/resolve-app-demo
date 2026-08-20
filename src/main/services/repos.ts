import { dialog } from 'electron'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import { getAppState, setAppState } from './app-state'
import { cloneRepo, isGitRepo } from './git'
import { getGitHubToken, missingTokenError } from './github-auth'
import { gitHubClient } from './github-client'

/**
 * Binding a Contact to somewhere on disk.
 *
 * Two ways in, deliberately. The GitHub one — list the user's repos, offer to
 * clone what isn't here yet — is the path that makes the app feel like it knows
 * about your work. But a flow that can only bind repos that exist on GitHub
 * *and* clone successfully has two ways to fail before anything interesting
 * happens, so picking a folder that is already on disk is a first-class
 * alternative rather than a fallback.
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
  const chosen = await chooseDirectory('Choose where Switchboard should put repositories it clones')
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
 * The ordering and the one-page cap live in `github-client.ts` with the request;
 * what belongs here is the only part that is about *binding* — which of them is
 * already on disk under the workspace root.
 */
export async function listRepos(): Promise<RepoOption[]> {
  const token = getGitHubToken()
  if (!token) throw missingTokenError('list your repositories')

  const repos = await gitHubClient(token).listRepos()
  const root = getWorkspaceRoot()

  return repos.map((repo) => ({
    id: repo.id,
    fullName: repo.fullName,
    cloneUrl: repo.cloneUrl,
    private: repo.private,
    localPath: root ? existingCheckout(root, repo.name) : null,
    updatedAt: repo.pushedAt
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
