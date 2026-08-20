import { useState } from 'react'
import { Check, ChevronRight, Circle, X } from 'lucide-react'
import { toolCallLabel } from '@/lib/stream'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/lib/stream'

/**
 * What the agent actually did this turn, as work rather than as a summary.
 *
 * A side effect you have to infer from a reply is the thing this app refuses
 * to ship, and an MCP call is the sharpest version of that: a persona reading
 * GitHub issues or
 * commenting on one leaves no trace in the text beyond whatever it chooses to
 * mention. This is the trace.
 *
 * **Shown on both backends, unlike StreamingIndicator, and the difference is
 * not an inconsistency.** That component draws an indeterminate pulse for
 * Claude because the SDK emits nothing *during* a tool call, so a determinate
 * progress line would be fiction. Discrete `tool_start` / `tool_end` events are
 * a different thing and both backends emit them — verified live in
 * `npm run probe:mcp`, where Claude reported ToolSearch and then
 * mcp__github__search_issues, each with a completion. So "what is happening
 * right now" stays backend-specific and "what has happened" does not.
 *
 * A row with more to say — a full command line, the bounded output excerpt its
 * tool_end carried — expands on click. The chevron only
 * renders when expanding would reveal something, so a bare row still reads as
 * the whole truth. Persisted history carries the same excerpts, so the morning
 * after a routine reads like the turn did live.
 */
export function ToolCallTimeline({
  calls,
  className
}: {
  calls: ToolCall[]
  className?: string
}): React.JSX.Element | null {
  if (calls.length === 0) return null

  return (
    <ol className={cn('flex flex-col gap-1', className)} aria-label="Tool calls">
      {calls.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
    </ol>
  )
}

/** Roughly what the truncated line can show; longer earns the chevron. */
const DETAIL_INLINE_MAX = 80

function ToolCallRow({ call }: { call: ToolCall }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const expandable = Boolean(call.output) || call.detail.length > DETAIL_INLINE_MAX

  const row = (
    <>
      <StatusMark status={call.status} />
      <span className="font-mono opacity-90">{toolCallLabel(call.name)}</span>
      {call.detail && (
        <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">
          {call.detail}
        </span>
      )}
      {expandable && (
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground size-2.5 shrink-0 self-center transition-transform',
            open && 'rotate-90'
          )}
        />
      )}
    </>
  )

  return (
    <li className="text-meta flex flex-col gap-1">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="hover:text-foreground focus-visible:ring-ring flex w-full items-baseline gap-2 rounded-sm text-left focus-visible:ring-1 focus-visible:outline-none"
        >
          {row}
        </button>
      ) : (
        <span className="flex items-baseline gap-2">{row}</span>
      )}

      {open && (
        <div className="border-border ml-4 flex flex-col gap-1 border-l pl-2.5">
          {call.detail.length > DETAIL_INLINE_MAX && (
            <pre className="text-muted-foreground text-meta max-h-24 overflow-auto font-mono whitespace-pre-wrap">
              {call.detail}
            </pre>
          )}
          {call.output && (
            <pre className="text-foreground/80 text-meta max-h-48 overflow-auto font-mono whitespace-pre-wrap">
              {call.output}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

function StatusMark({ status }: { status: ToolCall['status'] }): React.JSX.Element {
  if (status === 'running') {
    return (
      <Circle
        aria-label="running"
        className="size-2.5 shrink-0 animate-pulse self-center motion-reduce:animate-none"
      />
    )
  }
  if (status === 'failed') {
    // Failures are not hidden. A tool that refused is often the most
    // informative thing that happened in a turn — a denied write is the
    // sandbox working, and the user should be able to see it did.
    return <X aria-label="failed" className="text-destructive size-2.5 shrink-0 self-center" />
  }
  return <Check aria-label="completed" className="size-2.5 shrink-0 self-center opacity-60" />
}
