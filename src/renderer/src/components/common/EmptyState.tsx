import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  loading?: boolean
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  loading = false,
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className
      )}
    >
      {loading ? (
        <Loader2 className="text-muted-foreground mb-1 size-6 animate-spin" />
      ) : Icon ? (
        <Icon className="text-muted-foreground mb-1 size-6" />
      ) : null}
      <p className="text-foreground text-sm font-medium">{title}</p>
      {description && <p className="text-muted-foreground max-w-xs text-sm">{description}</p>}
    </div>
  )
}
