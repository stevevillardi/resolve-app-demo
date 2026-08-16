import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { UsageSummary } from '@/types'

interface UsageBadgeProps {
  summary: UsageSummary
  variant?: 'compact' | 'default'
  className?: string
}

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '—'
  return costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}

export function UsageBadge({
  summary,
  variant = 'default',
  className
}: UsageBadgeProps): React.JSX.Element {
  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 text-xs tabular-nums',
          variant === 'default' && 'bg-muted',
          className
        )}
      >
        {formatCost(summary.totalCostUsd)}
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5 text-xs">
          <span>{formatTokens(summary.totalInputTokens)} input tokens</span>
          <span>{formatTokens(summary.totalOutputTokens)} output tokens</span>
          {summary.totalCachedInputTokens !== undefined && (
            <span>{formatTokens(summary.totalCachedInputTokens)} cached</span>
          )}
          <span>
            {formatTokens(totalTokens)} total · {formatCost(summary.totalCostUsd)}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
