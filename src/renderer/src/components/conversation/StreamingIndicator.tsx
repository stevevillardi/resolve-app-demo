import { cn } from '@/lib/utils'
import type { PersonaBackend } from '@/types'

interface StreamingIndicatorProps {
  backend: PersonaBackend
  activity?: string
  className?: string
}

/**
 * Claude's SDK doesn't emit events *during* tool execution — only around it —
 * so a long Bash call looks like silence. Codex's runStreamed() yields
 * CommandExecutionStatus mid-call. Blueprint §3 is explicit that these should
 * look different rather than faking progress Claude doesn't have.
 *
 * So the difference is honest rather than decorative: Claude gets an
 * indeterminate pulse and the word "Working" (no claim about what); Codex gets
 * a determinate-looking marker and the actual command it is running.
 */
export function StreamingIndicator({
  backend,
  activity,
  className
}: StreamingIndicatorProps): React.JSX.Element {
  if (backend === 'codex') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('flex items-center gap-2 text-xs', className)}
      >
        <span className="bg-current/70 size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none" />
        <span className="min-w-0 truncate font-mono text-meta opacity-80">
          {activity ?? 'working…'}
        </span>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-2 text-xs', className)}
    >
      <span className="flex gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="bg-current/60 size-1.5 animate-pulse rounded-full [animation-duration:1.2s] motion-reduce:animate-none"
            style={{ animationDelay: `${index * 200}ms` }}
          />
        ))}
      </span>
      <span className="opacity-80">Working…</span>
    </div>
  )
}
