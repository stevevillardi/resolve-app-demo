import { existsSync } from 'fs'
import { getContact } from './contacts'
import { listTrackedFiles } from './git'
import { workingPathFor } from './run-lock'

/**
 * The file list behind the composer's @file autocomplete (review §B3).
 *
 * Listed from the contact's *working* path so an isolated persona completes
 * against its own worktree — the tree its turns actually read. But that path
 * is allowed not to exist yet: ensureWorktree() defers creation to the first
 * turn, so a fresh isolated contact falls back to the repo it will be
 * branched from, which is the best approximation and infinitely better than
 * an empty picker. Any git failure degrades to [] — a non-repo directory is
 * a legal binding, and the picker simply has nothing to offer there.
 */

/**
 * Cap on the returned list, not the fetch: ls-files is fast even on huge
 * repos, and truncating after the fact keeps `truncated` honest.
 */
export const FILE_LIST_MAX = 5000

export interface ContactFiles {
  files: string[]
  truncated: boolean
}

export async function contactFiles(contactId: string): Promise<ContactFiles> {
  const contact = getContact(contactId)
  if (!contact) return { files: [], truncated: false }

  const workingPath = workingPathFor(contact)
  const listFrom = existsSync(workingPath) ? workingPath : contact.repoPath

  try {
    const files = await listTrackedFiles(listFrom)
    return { files: files.slice(0, FILE_LIST_MAX), truncated: files.length > FILE_LIST_MAX }
  } catch {
    return { files: [], truncated: false }
  }
}
