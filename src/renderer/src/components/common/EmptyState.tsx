import type { LucideIcon } from 'lucide-react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  loading?: boolean
  /**
   * The read failed — a third state, distinct from "nothing here yet".
   *
   * Every list hook but `useRepos` defaulted a failed query to `[]`, so a
   * broken IPC call rendered as "No personas yet" and invited the user to
   * create something they may already have. Advice offered in response to a
   * question the app could not answer.
   */
  error?: boolean
  /** Tighter spacing for empty states inside a list panel rather than a pane. */
  compact?: boolean
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  loading = false,
  error = false,
  compact = false,
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      // Lets a caller — and the screenshot sweep — ask "is this pane showing
      // nothing?" without matching on copy. The sweep needs it because an empty
      // state's action button sits inside the list body and is otherwise
      // indistinguishable from a row.
      data-slot="empty-state"
      className={cn(
        'flex h-full flex-1 flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        className
      )}
    >
      {(loading || error || Icon) && (
        <span
          className={cn(
            'flex items-center justify-center rounded-xl border border-dashed',
            // The warning register, not the destructive one: nothing was
            // damaged and nothing needs undoing — a read did not come back.
            error
              ? 'text-scope-elevated border-scope-elevated/40'
              : 'text-muted-foreground border-border',
            compact ? 'size-9' : 'size-12'
          )}
        >
          {loading ? (
            <Loader2 className={cn('animate-spin', compact ? 'size-4' : 'size-5')} />
          ) : error ? (
            <TriangleAlert className={cn(compact ? 'size-4' : 'size-5')} />
          ) : (
            Icon && <Icon className={cn(compact ? 'size-4' : 'size-5')} />
          )}
        </span>
      )}
      <div className="flex flex-col gap-1">
        <p className={cn('font-medium', compact ? 'text-sm' : 'text-title')}>{title}</p>
        {description && (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm text-pretty">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
