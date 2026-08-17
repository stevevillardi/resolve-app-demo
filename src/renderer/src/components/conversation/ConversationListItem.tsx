import { ListRow } from '@/components/common/ListRow'
import { RunPulse } from '@/components/common/RunIndicator'
import { formatListTimestamp, repoName } from '@/lib/format'
import { formatCostSummary } from '@/lib/usage'
import type { UsageSummary } from '@/types'

interface ConversationListItemProps {
  name: string
  preview: string
  repoPath: string
  timestamp?: number
  active: boolean
  usage?: UsageSummary
  /** A turn is streaming for this row right now. */
  running?: boolean
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
  running = false,
  leading,
  onSelect
}: ConversationListItemProps): React.JSX.Element {
  // A group row is already titled with its repo, so repeating it below would
  // be noise; a contact row needs it, since one persona can be bound to many.
  const shortRepo = repoName(repoPath)
  const showRepo = shortRepo !== name

  return (
    <ListRow active={active} onSelect={onSelect} leading={leading}>
      <span className="block">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-row font-medium">{name}</span>
          {/* A run outlives this view — switching conversations unmounts the
              thread but not the turn — so the row is where you keep track of
              it. It replaces the timestamp rather than crowding in beside it:
              "working now" is the more useful of the two. */}
          {running ? (
            <span className="flex shrink-0 items-center gap-1">
              <RunPulse />
              <span className="text-primary font-mono text-micro">running</span>
            </span>
          ) : (
            timestamp !== undefined && (
              <span className="text-muted-foreground shrink-0 font-mono text-micro tabular-nums">
                {formatListTimestamp(timestamp)}
              </span>
            )
          )}
        </span>
        <span className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground min-w-0 truncate text-xs">
            {showRepo && <span className="font-mono text-meta">{shortRepo}</span>}
            {showRepo && preview && <span> · </span>}
            {preview}
          </span>
          {/* Spend sits in the sidebar per blueprint §10 — the point is that
              cost is never something you have to go looking for. */}
          {usage && (
            <span className="text-muted-foreground shrink-0 font-mono text-micro tabular-nums">
              {formatCostSummary(usage)}
            </span>
          )}
        </span>
      </span>
    </ListRow>
  )
}
