import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  loading?: boolean
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
  compact = false,
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full flex-1 flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        className
      )}
    >
      {(loading || Icon) && (
        <span
          className={cn(
            'text-muted-foreground border-border flex items-center justify-center rounded-xl border border-dashed',
            compact ? 'size-9' : 'size-12'
          )}
        >
          {loading ? (
            <Loader2 className={cn('animate-spin', compact ? 'size-4' : 'size-5')} />
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
