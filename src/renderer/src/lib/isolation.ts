import type { Isolation } from '@/types'

/**
 * The three places a Contact's session can run, and what each one costs.
 *
 * Written out rather than derived, because the cost is the thing that decides
 * it and none of those costs are inferable from the name.
 *
 * Its own module rather than living beside the flow that first used it: since
 * Phase 22 this choice is made in two places — at bind time in
 * `NewContactFlow`, and afterwards in `ChangeIsolationDialog` — and two screens
 * describing the same three modes differently is exactly the drift worth making
 * impossible. (eslint's `react-refresh/only-export-components` asks for the
 * same split for its own reasons.)
 */
export interface IsolationOption {
  value: Isolation
  label: string
  description: string
  /** Needs a git repo to be possible at all. */
  needsGit: boolean
}

/** In the order they are worth considering. */
export const ISOLATION_OPTIONS: IsolationOption[] = [
  {
    value: 'worktree',
    label: 'Its own checkout',
    description:
      'Works on its own branch in a separate directory, so it never waits for another persona and never touches your files. It starts from the last commit — your uncommitted work and node_modules are not there.',
    needsGit: true
  },
  {
    value: 'shared',
    label: 'Your checkout',
    description:
      'Works directly in the repo, seeing your uncommitted changes and everything already installed. Writers take turns here: one runs at a time.',
    needsGit: false
  },
  {
    value: 'exclusive',
    label: 'Your checkout, alone',
    description:
      'The same directory, but held for the whole turn so nothing else can read it mid-write. For work that needs the repo to itself.',
    needsGit: false
  }
]
