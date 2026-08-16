import { CheckCircle2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AuthStepCardProps {
  /** A lucide icon, or any component taking `className` — e.g. the inlined GitHub mark. */
  icon: LucideIcon | React.ComponentType<{ className?: string }>
  title: string
  description: string
  connected: boolean
  /** Replaces the description when connected — e.g. "Signed in as octocat". */
  connectedLabel?: string
  children?: React.ReactNode
}

/**
 * One backend's row in onboarding and in the connections view. Connected is a
 * quiet, finished state — no green banner, just a check and the account label —
 * because on first run "not connected yet" is normal, not an error to clear.
 */
export function AuthStepCard({
  icon: Icon,
  title,
  description,
  connected,
  connectedLabel,
  children
}: AuthStepCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-border flex flex-col gap-3 rounded-xl border p-4 transition-colors',
        connected && 'bg-muted/30'
      )}
    >
      <div className="flex items-start gap-3">
        <span className="text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center">
          <Icon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-medium">{title}</p>
            {connected && <CheckCircle2 className="text-scope-elevated size-4 shrink-0" />}
          </div>
          <p className="text-muted-foreground text-sm text-pretty">
            {connected ? (connectedLabel ?? 'Connected') : description}
          </p>
        </div>
      </div>
      {children && <div className="pl-11">{children}</div>}
    </div>
  )
}
