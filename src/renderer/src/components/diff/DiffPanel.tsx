import { useState } from 'react'
import { FileDiff as FileDiffIcon } from 'lucide-react'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ListRow } from '@/components/common/ListRow'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { DiffPane } from '@/components/diff/DiffPane'
import { firstRenderable, statusLabel } from '@/lib/diff-view'
import { cn } from '@/lib/utils'
import type { FileDiff } from '../../../../shared/ipc-contract'

const STATUS_TONE: Record<FileDiff['status'], string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  deleted: 'text-destructive',
  modified: 'text-amber-600 dark:text-amber-400',
  renamed: 'text-sky-600 dark:text-sky-400'
}

const VIEW_OPTIONS = [
  { value: 'split', label: 'Split' },
  { value: 'inline', label: 'Inline' }
] as const

/**
 * A file rail and one rendered pair (Phase 19, review A1/A6).
 *
 * Selection is keyed by path and re-derived when the file set changes, so a
 * refetch after a commit or merge lands on a file that still exists rather
 * than a stale index.
 */
export function DiffPanel({
  files,
  filesOmitted,
  isLoading = false,
  error = null,
  emptyText = 'Nothing changed.',
  className
}: {
  files: FileDiff[]
  filesOmitted: number
  isLoading?: boolean
  error?: string | null
  emptyText?: string
  className?: string
}): React.JSX.Element {
  const [chosenPath, setChosenPath] = useState<string | null>(null)
  const [view, setView] = useState<'split' | 'inline'>('split')

  // Derived, not synced by an effect: when the set changes under a stale
  // choice (a commit or merge refetched it), the selection falls back to the
  // first renderable file on this very render.
  const selectedPath = files.some((file) => file.path === chosenPath)
    ? chosenPath
    : firstRenderable(files)
  const selected = files.find((file) => file.path === selectedPath) ?? null

  if (error) {
    return (
      <div className={cn('border-border bg-background rounded-lg border', className)}>
        <EmptyPane icon={FileDiffIcon} title="Couldn't read the diff" description={error} />
      </div>
    )
  }
  if (isLoading && files.length === 0) {
    return (
      <div className={cn('border-border bg-background rounded-lg border', className)}>
        <EmptyPane icon={FileDiffIcon} title="Reading the diff…" description="Asking git." />
      </div>
    )
  }
  if (files.length === 0) {
    return (
      <div className={cn('border-border bg-background rounded-lg border', className)}>
        <EmptyPane icon={FileDiffIcon} title="No changes" description={emptyText} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'border-border bg-background flex min-h-0 flex-col overflow-hidden rounded-lg border',
        className
      )}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-meta">
          {files.length === 1 ? '1 file' : `${files.length} files`}
          {filesOmitted > 0 && ` · ${filesOmitted} more not shown`}
        </span>
        <div className="flex-1" />
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          aria-label="Diff layout"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Changed files"
          className="border-border w-56 shrink-0 overflow-y-auto border-r p-1.5"
        >
          <ul className="flex flex-col gap-0.5">
            {files.map((file) => (
              <li key={file.path}>
                <ListRow
                  active={selectedPath === file.path}
                  onSelect={() => setChosenPath(file.path)}
                  align="center"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span
                      aria-label={file.status}
                      className={cn('font-mono text-meta font-semibold', STATUS_TONE[file.status])}
                    >
                      {statusLabel(file.status)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
                      {file.path}
                    </span>
                    {file.live && (
                      <span
                        className="text-muted-foreground text-meta shrink-0"
                        title="Read from the working tree just now — it may have changed since this turn."
                      >
                        live
                      </span>
                    )}
                  </span>
                </ListRow>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-h-0 min-w-0 flex-1">
          {selected ? (
            // No key on purpose: DiffPane swaps models on file change, so the
            // editor widget — the expensive part — survives switching files.
            <DiffPane file={selected} sideBySide={view === 'split'} />
          ) : (
            <EmptyPane icon={FileDiffIcon} title="Pick a file" description="" />
          )}
        </div>
      </div>
    </div>
  )
}
