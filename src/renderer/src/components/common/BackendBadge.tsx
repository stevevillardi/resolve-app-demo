import { ClaudeMark, CodexMark } from '@/components/brand/BrandMarks'
import { cn } from '@/lib/utils'
import type { PersonaBackend } from '@/types'

interface BackendBadgeProps {
  backend: PersonaBackend
  className?: string
}

// The real marks now — `Sparkles` and `SquareTerminal` were placeholders for a
// lucide version that had brand icons, and onboarding had drifted to a third
// glyph for the same two things.
//
// Still muted ink rather than brand colour, which is the older decision and the
// one worth keeping: the backend is an implementation fact sitting next to the
// scope chips, and two saturated logos would out-shout the permissions that are
// the actual point of the row.
const BACKEND = {
  claude: { label: 'claude', Icon: ClaudeMark },
  codex: { label: 'codex', Icon: CodexMark }
} as const

export function BackendBadge({ backend, className }: BackendBadgeProps): React.JSX.Element {
  const { label, Icon } = BACKEND[backend]
  return (
    <span
      className={cn(
        'text-muted-foreground border-border inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-meta leading-none',
        className
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}
