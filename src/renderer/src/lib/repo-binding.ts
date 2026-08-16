import type { PersonaBackend } from '@/types'

/**
 * Whether a chosen folder can actually host this persona.
 *
 * Lives here rather than inside NewContactFlow because the renderer Vitest
 * project does not match `.tsx` — the same reason `mention.ts` and `stream.ts`
 * exist. The component keeps the wiring; the rule keeps the test.
 */

export interface RepoBindingProblem {
  /** Shown under the folder row, and the reason Continue is disabled. */
  message: string
}

/**
 * Codex will not start outside a git working tree. Confirmed live, not
 * inferred from docs — `codex exec` exits 1 with:
 *
 *   Not inside a trusted directory and --skip-git-repo-check was not specified.
 *
 * So for a Codex persona a plain directory is not a reduced feature set, it is
 * a contact that cannot answer a single message. Claude has no such rule: it
 * reads and edits a plain directory happily, and only loses the GitHub actions
 * that need a remote and a branch.
 */
export function repoBindingProblem(
  backend: PersonaBackend | undefined,
  personaName: string | undefined,
  isGitRepo: boolean
): RepoBindingProblem | null {
  if (isGitRepo) return null
  if (backend !== 'codex') return null

  return {
    message: `This folder isn't a git repository. ${personaName ?? 'This persona'} runs on Codex, which refuses to start outside one — pick a repository, or run git init here first.`
  }
}

/** The softer note for a backend that can work in a plain directory. */
export const NON_REPO_NOTE =
  "This folder isn't a git repository, so GitHub actions won't be available for this contact."
