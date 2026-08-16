import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCost, formatTokens } from '@/lib/usage'
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
  const costUnknown = summary.totalCostUsd === null

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'text-muted-foreground shrink-0 rounded-md font-mono text-[11px] tabular-nums',
          variant === 'default' && 'bg-muted px-1.5 py-0.5',
          className
        )}
      >
        {formatCost(summary.totalCostUsd)}
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
            <span className="font-mono tabular-nums">{formatCost(summary.totalCostUsd)}</span>
          </span>
          {/* Codex reports tokens but no dollar figure (blueprint §3) — say so
              rather than showing $0.00 and implying the work was free. */}
          {costUnknown && (
            <span className="mt-0.5 max-w-48 opacity-70">
              This backend reports tokens but not a cost.
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
