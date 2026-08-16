import { cn } from '@/lib/utils'
import type { PersonaBackend } from '@/types'

interface StreamingIndicatorProps {
  backend: PersonaBackend
  activity?: string
  className?: string
}

// Claude's SDK doesn't stream events during tool execution itself — only
// around it, so its indicator stays quiet/ambiguous ("thinking") rather than
// claiming to show progress it doesn't have. Codex's runStreamed() yields
// CommandExecutionStatus events mid-tool-call, so its indicator can show a
// live "running: <tool>" label. See blueprint §3.
export function StreamingIndicator({
  backend,
  activity,
  className
}: StreamingIndicatorProps): React.JSX.Element {
  if (backend === 'codex') {
    return (
      <div className={cn('flex items-center gap-2 text-xs', className)}>
        <span
          className="size-2 shrink-0 animate-pulse rounded-full"
          style={{ backgroundColor: 'var(--status-streaming-accent-codex)' }}
        />
        <span className="text-muted-foreground">
          {activity ? `Running: ${activity}` : 'Working…'}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-2 text-xs', className)}>
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full [animation-duration:1s]"
            style={{
              backgroundColor: 'var(--status-streaming-accent-claude)',
              animationDelay: `${i * 150}ms`
            }}
          />
        ))}
      </span>
      <span className="text-muted-foreground">Thinking…</span>
    </div>
  )
}
