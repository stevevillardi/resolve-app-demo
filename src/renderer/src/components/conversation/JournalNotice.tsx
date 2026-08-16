import { BookMarked, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SystemSummaryCategory } from '@/types'

interface JournalNoticeProps {
  content: string
  category?: SystemSummaryCategory
  durable?: boolean
  authorName?: string
}

const CATEGORY_LABEL: Record<SystemSummaryCategory, string> = {
  decision: 'Decision',
  tradeoff: 'Tradeoff',
  routine: 'Routine summary'
}

// Renders as a quiet "decision record" card, not a chat bubble — this is an
// automated end-of-session artifact, not a live reply (blueprint §10).
export function JournalNotice({
  content,
  category = 'decision',
  durable,
  authorName
}: JournalNoticeProps): React.JSX.Element {
  return (
    <div
      className={cn('flex gap-2.5 rounded-lg border-l-[3px] border p-3 text-sm')}
      style={{
        backgroundColor: 'var(--notice-journal-bg)',
        color: 'var(--notice-journal-fg)',
        borderColor: 'var(--notice-journal-border)',
        borderLeftColor: 'var(--notice-journal-rail)'
      }}
    >
      <BookMarked className="mt-0.5 size-4 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase opacity-80">
          <span>{CATEGORY_LABEL[category]}</span>
          {authorName && <span className="font-normal normal-case opacity-70">· {authorName}</span>}
          {durable && <Pin className="size-3" aria-label="Kept indefinitely" />}
        </div>
        <p className="leading-relaxed">{content}</p>
      </div>
    </div>
  )
}
