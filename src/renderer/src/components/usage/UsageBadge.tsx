import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCostSummary, formatTokens } from '@/lib/usage'
import { cn } from '@/lib/utils'
import type { UsageSummary } from '@/types'

interface UsageBadgeProps {
  summary: UsageSummary
  variant?: 'compact' | 'default'
  className?: string
}

export function UsageBadge({
  summary,
  variant = 'default',
  className
}: UsageBadgeProps): React.JSX.Element {
  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens
  const { unpricedEvents } = summary

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'text-muted-foreground shrink-0 rounded-md font-mono text-[11px] tabular-nums',
          variant === 'default' && 'bg-muted px-1.5 py-0.5',
          className
        )}
      >
        {formatCostSummary(summary)}
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5 text-xs">
          <span>
            <span className="font-mono tabular-nums">{formatTokens(summary.totalInputTokens)}</span>{' '}
            input
          </span>
          <span>
            <span className="font-mono tabular-nums">
              {formatTokens(summary.totalOutputTokens)}
            </span>{' '}
            output
          </span>
          {summary.totalCachedInputTokens !== undefined && (
            <span>
              <span className="font-mono tabular-nums">
                {formatTokens(summary.totalCachedInputTokens)}
              </span>{' '}
              cached
            </span>
          )}
          <span className="border-background/20 mt-0.5 border-t pt-0.5">
            <span className="font-mono tabular-nums">{formatTokens(totalTokens)}</span> total ·{' '}
            <span className="font-mono tabular-nums">{formatCostSummary(summary)}</span>
          </span>
          {/* What the `+` on the figure above means. Both backends report a
              cost now — Claude's from its SDK, Codex's computed from our price
              table — so an unknown is a model we have no price for, not a
              backend that cannot say. The tokens are still exact. */}
          {unpricedEvents > 0 && (
            <span className="mt-0.5 max-w-48 opacity-70">
              {unpricedEvents === 1 ? '1 turn ran' : `${unpricedEvents} turns ran`} on a model with
              no published price, so {unpricedEvents === 1 ? 'its' : 'their'} cost is missing from
              this total.
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
