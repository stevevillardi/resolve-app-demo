import { Sparkles, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PersonaBackend } from '@/types'

interface BackendBadgeProps {
  backend: PersonaBackend
  className?: string
}

// The backend is an implementation fact, not a brand — it stays in muted ink
// with a glyph rather than taking a colour of its own, so it never competes
// with the scope chips beside it.
const BACKEND = {
  claude: { label: 'claude', Icon: Sparkles },
  codex: { label: 'codex', Icon: SquareTerminal }
} as const

export function BackendBadge({ backend, className }: BackendBadgeProps): React.JSX.Element {
  const { label, Icon } = BACKEND[backend]
  return (
    <span
      className={cn(
        'text-muted-foreground border-border inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-none',
        className
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}
