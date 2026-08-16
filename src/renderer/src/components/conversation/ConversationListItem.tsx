import { formatListTimestamp, repoName } from '@/lib/format'
import { formatCost } from '@/lib/usage'
import { cn } from '@/lib/utils'
import type { UsageSummary } from '@/types'

interface ConversationListItemProps {
  name: string
  preview: string
  repoPath: string
  timestamp?: number
  active: boolean
  usage?: UsageSummary
  /** Avatar for a contact; a stacked cluster of member avatars for a group. */
  leading: React.ReactNode
  onSelect: () => void
}

export function ConversationListItem({
  name,
  preview,
  repoPath,
  timestamp,
  active,
  usage,
  leading,
  onSelect
}: ConversationListItemProps): React.JSX.Element {
  // A group row is already titled with its repo, so repeating it below would
  // be noise; a contact row needs it, since one persona can be bound to many.
  const shortRepo = repoName(repoPath)
  const showRepo = shortRepo !== name

  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'truncate text-[13px] font-medium',
              active ? 'text-foreground' : 'text-foreground'
            )}
          >
            {name}
          </span>
          {timestamp !== undefined && (
            <span className="text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums">
              {formatListTimestamp(timestamp)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground min-w-0 truncate text-xs">
            {showRepo && <span className="font-mono text-[11px]">{shortRepo}</span>}
            {showRepo && preview && <span> · </span>}
            {preview}
          </span>
          {/* Spend sits in the sidebar per blueprint §10 — the point is that
              cost is never something you have to go looking for. */}
          {usage && (
            <span className="text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums">
              {formatCost(usage.totalCostUsd)}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
