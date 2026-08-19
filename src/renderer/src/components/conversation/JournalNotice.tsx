import { Milestone, Pin, Scale, ScrollText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTime } from '@/lib/format'
import type { SystemSummaryCategory } from '@/types'

interface JournalNoticeProps {
  content: string
  category?: SystemSummaryCategory
  durable?: boolean
  authorName?: string
  timestamp?: number
}

/**
 * Icon plus label per category, so the record types read at a glance the way
 * the log rows already do (RoutineRunNotice's clock, BranchRequestNotice's
 * PR arrow): a milestone marks a decision the fleet will keep, scales weigh
 * a tradeoff, a scroll is the routine session record.
 */
const CATEGORY: Record<SystemSummaryCategory, { label: string; icon: LucideIcon }> = {
  decision: { label: 'Decision', icon: Milestone },
  tradeoff: { label: 'Tradeoff', icon: Scale },
  routine: { label: 'Routine summary', icon: ScrollText }
}

/**
 * A structured end-of-session record, not a chat turn — nobody typed this and
 * nobody was watching when it was written (blueprint §10).
 *
 * So it is shaped like a record: centred, full width, a hairline rule carrying
 * a small-caps label, body text below. No fill, no border box, no accent
 * colour. An earlier revision gave this a tinted card with a coloured left
 * rail, which made it read as just another message wearing a different paint —
 * the shape is what has to differ, because shape survives greyscale.
 */
export function JournalNotice({
  content,
  category = 'decision',
  durable,
  authorName,
  timestamp
}: JournalNoticeProps): React.JSX.Element {
  return (
    <div className="my-1 flex flex-col items-center gap-1.5 py-1">
      <div className="flex w-full items-center gap-2.5">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-meta font-medium tracking-wide uppercase">
          {(() => {
            const Icon = CATEGORY[category].icon
            return <Icon aria-hidden className="size-3" />
          })()}
          {CATEGORY[category].label}
          {durable && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="text-foreground/70 inline-flex cursor-default">
                    <Pin className="size-3" />
                    <span className="sr-only">Kept indefinitely</span>
                  </span>
                }
              />
              <TooltipContent>
                Durable — re-injected into every future session on this repo.
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        <span className="bg-border h-px flex-1" />
      </div>
      <p className="text-foreground/85 max-w-[46rem] px-6 text-center text-row leading-relaxed text-pretty">
        {content}
      </p>
      {(authorName || timestamp !== undefined) && (
        <p className="text-muted-foreground text-meta">
          {authorName}
          {authorName && timestamp !== undefined && ' · '}
          {timestamp !== undefined && (
            <span className="font-mono tabular-nums">{formatTime(timestamp)}</span>
          )}
        </p>
      )}
    </div>
  )
}
