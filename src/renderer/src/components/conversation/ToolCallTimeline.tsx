import { Check, Circle, X } from 'lucide-react'
import { toolCallLabel } from '@/lib/stream'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/lib/stream'

/**
 * What the agent actually did this turn, as work rather than as a summary.
 *
 * Blueprint §9 objects to side effects you have to infer from a reply, and an
 * MCP call is the sharpest version of that: a persona reading GitHub issues or
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
 * Live only. These are dropped when the turn's persisted rows are refetched,
 * with the consequence recorded in docs/plan/15-deferred-capability-work.md: a
 * routine that fires overnight leaves a record of what it concluded and none of
 * what it called.
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
        <li key={call.id} className="flex items-baseline gap-2 text-meta">
          <StatusMark status={call.status} />
          <span className="font-mono opacity-90">{toolCallLabel(call.name)}</span>
          {call.detail && (
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">
              {call.detail}
            </span>
          )}
        </li>
      ))}
    </ol>
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
