import { Clock } from 'lucide-react'
import { formatTime } from '@/lib/format'

interface RoutineRunNoticeProps {
  content: string
  authorName?: string
  timestamp?: number
}

/**
 * A log entry, not a conversation turn — this ran on a schedule while nobody
 * was watching (blueprint §8/§10).
 *
 * Shaped accordingly: a fixed monospace timestamp gutter, a glyph, and a
 * hairline rule down the left the way a terminal log or a CI run reads. It is
 * left-aligned like an inbound message but has no bubble, so it can't be
 * mistaken for one even in greyscale.
 */
export function RoutineRunNotice({
  content,
  authorName,
  timestamp
}: RoutineRunNoticeProps): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-0.5 pl-0.5">
      <span className="text-muted-foreground flex w-11 shrink-0 justify-end pt-0.5 font-mono text-[10px] tabular-nums">
        {timestamp !== undefined ? formatTime(timestamp) : ''}
      </span>
      <span className="border-border flex min-w-0 flex-1 items-start gap-2 border-l pl-3">
        <Clock className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">
            Routine run{authorName ? ` · ${authorName}` : ''}
          </span>
          <span className="text-foreground/85 mt-0.5 block text-[13px] leading-relaxed">
            {content}
          </span>
        </span>
      </span>
    </div>
  )
}
