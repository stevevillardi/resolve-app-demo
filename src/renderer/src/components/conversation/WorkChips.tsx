import { FileDiff as FileDiffIcon, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TurnWork } from '../../../../shared/domain'

/** How many paths ride on the row before the rest fold into a count. */
const CHIP_LIMIT = 4

/**
 * What a turn did to the tree, under its bubble.
 *
 * One button, not a chip per file: the answer to "what changed" is the diff,
 * and per-file entry points would suggest per-file destinations this dialog
 * does not have. Renders only for a turn that changed something — the record
 * itself is absent otherwise, so a reader can trust silence.
 */
export function WorkChips({
  work,
  onOpen,
  className
}: {
  work: TurnWork
  onOpen: () => void
  className?: string
}): React.JSX.Element {
  const paths = [...work.committed, ...work.dirty]
  const shown = paths.slice(0, CHIP_LIMIT)
  const more = paths.length - shown.length

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/25',
        'flex max-w-full items-center gap-1.5 self-start rounded-md border px-2 py-1 text-left',
        'focus-visible:ring-ring transition-colors focus-visible:ring-1 focus-visible:outline-none',
        className
      )}
      aria-label={`Show what this turn changed (${paths.length} ${paths.length === 1 ? 'file' : 'files'})`}
    >
      <FileDiffIcon className="size-3 shrink-0" aria-hidden />
      <span className="text-meta font-medium">
        {paths.length === 1 ? '1 file' : `${paths.length} files`}
      </span>
      {work.branch && work.committed.length > 0 && (
        <span className="text-meta flex min-w-0 items-center gap-1">
          <GitBranch className="size-3 shrink-0" aria-hidden />
          <span className="truncate font-mono">{work.branch}</span>
        </span>
      )}
      <span className="min-w-0 truncate font-mono text-meta opacity-80">
        {shown.map((path) => path.split('/').at(-1)).join(' · ')}
        {more > 0 && ` · +${more}`}
      </span>
      {work.dirty.length > 0 && (
        <span
          className="text-meta shrink-0"
          title="Some of this work is not committed yet — the diff reads it from the tree as it is now."
        >
          uncommitted
        </span>
      )}
    </button>
  )
}
