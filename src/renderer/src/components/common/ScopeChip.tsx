import { Eye, FilePen, GitPullRequest, ShieldAlert, Unlock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { GithubScope, SandboxLevel } from '@/types'

/**
 * The app's signature element.
 *
 * A persona is defined as much by what it *cannot* do as by its prompt — the
 * filesystem sandbox and the GitHub scope are independent permission axes
 * (blueprint §9), and the governance story is the whole point of §16's third
 * journey. Surfacing them as a compact, always-visible capsule is what makes
 * this read as a console for scoped workers rather than a chat window.
 *
 * Three severity levels, ordered by blast radius, shared across both axes.
 * Always icon + label, never colour alone.
 */

type Severity = 'safe' | 'elevated' | 'full'

interface Descriptor {
  label: string
  icon: LucideIcon
  severity: Severity
  hint: string
}

const SANDBOX: Record<SandboxLevel, Descriptor> = {
  read_only: {
    label: 'read_only',
    icon: Eye,
    severity: 'safe',
    hint: 'Can read the repo. Cannot write any file.'
  },
  workspace_write: {
    label: 'workspace_write',
    icon: FilePen,
    severity: 'elevated',
    hint: 'Can edit files inside the bound repo. Cannot reach the rest of the filesystem.'
  },
  full_access: {
    label: 'full_access',
    icon: Unlock,
    severity: 'full',
    hint: 'Unrestricted filesystem access outside the bound repo.'
  }
}

const GITHUB: Record<GithubScope, Descriptor> = {
  read_only: {
    label: 'read_only',
    icon: Eye,
    severity: 'safe',
    hint: 'Can read issues and code on GitHub. Cannot push or comment.'
  },
  open_pr: {
    label: 'open_pr',
    icon: GitPullRequest,
    severity: 'elevated',
    hint: 'Can push a branch and open a pull request. Cannot merge.'
  },
  full_access: {
    label: 'full_access',
    icon: ShieldAlert,
    severity: 'full',
    hint: 'Can push, open pull requests, and merge.'
  }
}

const SEVERITY_CLASS: Record<Severity, string> = {
  safe: 'bg-scope-safe-bg text-scope-safe',
  elevated: 'bg-scope-elevated-bg text-scope-elevated',
  full: 'bg-scope-full-bg text-scope-full'
}

interface ScopeChipProps {
  /** Which permission axis this chip describes. */
  axis: 'sandbox' | 'github'
  value: SandboxLevel | GithubScope
  /** Drops the label, leaving the icon — for dense list rows. */
  compact?: boolean
  className?: string
}

export function ScopeChip({
  axis,
  value,
  compact = false,
  className
}: ScopeChipProps): React.JSX.Element {
  const table = axis === 'sandbox' ? SANDBOX : GITHUB
  const descriptor = table[value as keyof typeof table] ?? SANDBOX.read_only
  const Icon = descriptor.icon
  const axisLabel = axis === 'sandbox' ? 'Sandbox' : 'GitHub'
  // Both axes share the `read_only` and `full_access` values, so without a
  // prefix two chips side by side are byte-identical and tell you nothing.
  const axisPrefix = axis === 'sandbox' ? 'fs' : 'gh'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'inline-flex shrink-0 cursor-default items-center gap-1 rounded-full font-mono text-[11px] leading-none',
              compact ? 'size-5 justify-center' : 'py-1 pr-2 pl-1.5',
              SEVERITY_CLASS[descriptor.severity],
              className
            )}
          >
            <Icon className="size-3" aria-hidden />
            {compact ? (
              <span className="sr-only">{`${axisLabel}: ${descriptor.label}`}</span>
            ) : (
              <>
                <span className="opacity-55">{axisPrefix}</span>
                {descriptor.label}
              </>
            )}
          </span>
        }
      />
      <TooltipContent>
        <span className="font-medium">{axisLabel}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="font-mono">{descriptor.label}</span>
        <span className="mt-0.5 block max-w-52">{descriptor.hint}</span>
      </TooltipContent>
    </Tooltip>
  )
}
