import { app } from 'electron'
import { rmSync } from 'fs'
import { join } from 'path'
import { closeDb, DB_FILE_NAME } from '../db'
import { deleteContact, listContacts } from './contacts'
import { deleteBranch } from './git'
import { assertNoActiveRun } from './run-lock'

/**
 * Wipes the app back to a fresh install — the Settings dev reset.
 *
 * Ordering is correctness, not caution: contacts go first, through the same
 * deleteContact path a user's delete takes, because worktreeRemove is what
 * leaves each real repository's `.git/worktrees` registry clean — deleting the
 * database first would strand those registrations and git would refuse to
 * ever recreate a worktree on the same branch. Only then is the profile
 * dropped: the database (with its WAL siblings — deleting the main file alone
 * leaves the WAL to be replayed into a resurrected zombie), the secrets, and
 * any worktree residue.
 *
 * What it deliberately never touches: `~/.claude` and `~/.codex` (the user's
 * real backend logins — the app reads them, it does not own them) and the
 * clones under workspace_root (the user's actual checkouts). The `persona/*`
 * branches ARE deleted — pre-release, a reset means zero trace, and the app
 * created them.
 *
 * The relaunch half lives in the IPC procedure, not here: this function is
 * the testable part, and tests have no app to relaunch.
 *
 * Refused outright while anything is running — checked here rather than left to
 * the per-contact guard in deleteContact, so a reset either happens or does not.
 * Failing partway through would have already removed some worktrees and deleted
 * some branches, which is a worse state than either end of the operation.
 */
export async function clearAppData(): Promise<void> {
  assertNoActiveRun(null, 'resetting the app')

  for (const contact of listContacts()) {
    const { repoPath, branch } = contact
    await deleteContact(contact.id, true)
    if (branch) {
      // Force-delete: the branch is unmerged by definition of "reset". A
      // branch that never materialized (no turn ever ran) throws; that is the
      // clean state we wanted, not a failure.
      await deleteBranch(repoPath, branch, true).catch(() => {})
    }
  }

  closeDb()
  const userData = app.getPath('userData')
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(join(userData, `${DB_FILE_NAME}${suffix}`), { force: true })
  }
  rmSync(join(userData, 'secrets'), { recursive: true, force: true })
  rmSync(join(userData, 'worktrees'), { recursive: true, force: true })
}
