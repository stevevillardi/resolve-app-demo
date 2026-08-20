import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCost, formatTokens } from '@/lib/usage'
import { cn } from '@/lib/utils'
import type { UsageEvent } from '@/types'

/**
 * What one turn cost, under the reply it bought.
 *
 * The third question in the set the other two usage surfaces answer:
 * `UsageBadge` says what a conversation has cost in total, `ContextMeter` says
 * how much room is left, and this says what *that* answer cost. The figures are
 * a `usage_events` row per turn; what makes them readable one at a time rather
 * than only summable is the link from a row to the message it paid for.
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
            The em dash on the figure, explained. Whether a cost came from the
            model's own reporting or from this app's price table is a
            distinction the reader cannot act on, so it is recorded per row and
            not shown; an unknown price is the one difference that changes how
            the number should be read.
          */}
          {event.costUsd === null && (
            <span className="mt-0.5 max-w-48 opacity-70">
              This model has no published price. The token counts are exact.
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
