import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCost, formatTokens } from '@/lib/usage'
import { cn } from '@/lib/utils'
import type { UsageEvent } from '@/types'

/**
 * What one turn cost, under the reply it bought (review §G6).
 *
 * The third question in the set the other two usage surfaces answer:
 * `UsageBadge` says what a conversation has cost in total, `ContextMeter` says
 * how much room is left, and this says what *that* answer cost. The data has
 * been there since Phase 5 — a `usage_events` row per turn — but nothing linked
 * a row to a message, so it could only ever be summed.
 *
 * Deliberately the quietest thing in the thread. It renders under every
 * assistant bubble, so anything with a border, a background or a colour would
 * turn a long conversation into a ledger. `text-micro` and muted, in the same
 * register as the outbound timestamp it sits opposite.
 *
 * `formatCost`, never `formatCostSummary`: the `+` suffix means "some turns in
 * this total are unpriced", which is meaningless for a single event. An
 * unpriced turn shows `—`, and the tooltip says why — the tokens are still
 * exact, so the line is worth rendering even when the money is unknown.
 */
export function TurnCost({
  event,
  className
}: {
  event: UsageEvent
  className?: string
}): React.JSX.Element {
  const total = event.inputTokens + event.outputTokens

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'text-muted-foreground self-start font-mono text-micro tabular-nums',
          'hover:text-foreground transition-colors',
          className
        )}
      >
        {formatCost(event.costUsd)} · {formatTokens(total)}
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5 text-xs">
          <span>
            <span className="font-mono tabular-nums">{formatTokens(event.inputTokens)}</span> input
          </span>
          <span>
            <span className="font-mono tabular-nums">{formatTokens(event.outputTokens)}</span>{' '}
            output
          </span>
          {event.cachedInputTokens !== undefined && (
            <span>
              <span className="font-mono tabular-nums">
                {formatTokens(event.cachedInputTokens)}
              </span>{' '}
              cached
            </span>
          )}
          {event.model && <span className="mt-0.5 font-mono opacity-70">{event.model}</span>}
          {/*
            Which kind of number the money is. `sdk` came from the backend and
            `computed` from this app's own price table (adapters/pricing.ts);
            the usage dashboard has always kept those apart and a per-turn
            figure is exactly where the difference is most visible.
          */}
          {event.costUsd === null ? (
            <span className="mt-0.5 max-w-48 opacity-70">
              This model has no published price, so the cost is unknown rather than zero. The token
              counts are exact.
            </span>
          ) : (
            event.costSource && (
              <span className="mt-0.5 max-w-48 opacity-70">
                {event.costSource === 'sdk'
                  ? 'Reported by the backend.'
                  : 'Estimated from this app’s price table.'}
              </span>
            )
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
