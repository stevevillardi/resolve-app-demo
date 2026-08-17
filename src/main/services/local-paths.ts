import { existsSync, realpathSync } from 'fs'
import { resolve, sep } from 'path'
import { initDb } from '../db'
import { contacts, groups } from '../db/schema'
import { worktreeRoot } from './worktrees'

/**
 * Which local paths the renderer may ask the OS to open (Phase 19, review A2).
 *
 * The same rule shell.openExternal set for URLs, applied to disk: the roots
 * are only what the app itself already knows — every bound repo, every
 * contact's worktree, and the app's own worktree directory — so this can never
 * become a general "open whatever the renderer says" primitive. Paths are
 * realpath'd before the prefix check, because a symlink inside a root pointing
 * out of it would otherwise ride through on string comparison alone.
 */

export function knownRoots(): string[] {
  const contactRows = initDb()
    .select({ repoPath: contacts.repoPath, worktreePath: contacts.worktreePath })
    .from(contacts)
    .all()
  const groupRows = initDb().select({ repoPath: groups.repoPath }).from(groups).all()

  const roots = new Set<string>()
  for (const row of contactRows) {
    roots.add(row.repoPath)
    if (row.worktreePath) roots.add(row.worktreePath)
  }
  for (const row of groupRows) roots.add(row.repoPath)
  roots.add(worktreeRoot())
  return [...roots]
}

/** True when `path` exists and sits at or under one of the app's known roots. */
export function isKnownLocalPath(path: string, roots: string[] = knownRoots()): boolean {
  if (!existsSync(path)) return false

  let real: string
  try {
    real = realpathSync(path)
  } catch {
    return false
  }

  return roots.some((root) => {
    if (!existsSync(root)) return false
    let realRoot: string
    try {
      realRoot = realpathSync(resolve(root))
    } catch {
      return false
    }
    return real === realRoot || real.startsWith(realRoot + sep)
  })
}
