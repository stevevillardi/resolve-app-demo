import { Clock } from 'lucide-react'

interface RoutineRunNoticeProps {
  content: string
  authorName?: string
}

// Different container shape (no bubble, no tail, a small clock glyph) so it
// reads as distinct from a live agent_reply at a glance — "ran while you
// were away," not a conversation turn (blueprint §8/§10).
export function RoutineRunNotice({
  content,
  authorName
}: RoutineRunNoticeProps): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border-l-[3px] border border-dashed p-3 text-sm"
      style={{
        backgroundColor: 'var(--notice-routine-bg)',
        color: 'var(--notice-routine-fg)',
        borderColor: 'var(--notice-routine-border)',
        borderLeftColor: 'var(--notice-routine-rail)',
        borderLeftStyle: 'solid'
      }}
    >
      <Clock className="mt-0.5 size-4 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-semibold tracking-wide uppercase opacity-80">
          Routine run{authorName ? ` · ${authorName}` : ''}
        </p>
        <p className="leading-relaxed">{content}</p>
      </div>
    </div>
  )
}
