import { Eye, FilePen, GitPullRequest, Plug, ShieldAlert, Unlock, Unplug } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { McpReach } from '@/lib/capability-view'
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

/**
 * The hints say "unless the sandbox is full_access" because that is true and
 * was measured to be true.
 *
 * A live run found a read_only persona commenting on an issue through the `gh`
 * CLI: the MCP server correctly served it no write tool, and the shell reached
 * the same API anyway. The shell route is now governed too
 * (evaluateGithubShellUse), but only where the app is consulted at all —
 * `sandbox: full_access` sets `bypassPermissions` on Claude and
 * `danger-full-access` on Codex, and neither asks. A chip that kept promising
 * "cannot push or comment" at that combination would be the interface lying
 * about the one thing it exists to report.
 */
const GITHUB: Record<GithubScope, Descriptor> = {
  read_only: {
    label: 'read_only',
    icon: Eye,
    severity: 'safe',
    hint: 'Can read issues and code on GitHub. Cannot push or comment — unless its sandbox is full_access, which lifts every restriction including this one.'
  },
  open_pr: {
    label: 'open_pr',
    icon: GitPullRequest,
    severity: 'elevated',
    hint: 'Can push a branch and open a pull request. Cannot merge — unless its sandbox is full_access.'
  },
  full_access: {
    label: 'full_access',
    icon: ShieldAlert,
    severity: 'full',
    hint: 'Can push, open pull requests, and merge.'
  }
}

/**
 * Reach, which neither other axis describes.
 *
 * `sandbox` covers the disk and `github` covers what may be done on GitHub. A
 * persona holding a server can talk to something off this machine, and in v1
 * the per-persona allowlist over a curated registry *is* that axis — see the
 * comment on personaTemplateSchema.mcpServerIds. Derived from the allowlist
 * rather than stored, so it cannot fall out of step with what was granted.
 */
const MCP: Record<McpReach, Descriptor> = {
  none: {
    label: 'none',
    icon: Unplug,
    severity: 'safe',
    hint: 'No MCP servers. This session can only touch its own files.'
  },
  github: {
    label: 'github',
    icon: Plug,
    severity: 'elevated',
    // Says what it does *not* add, deliberately: holding the server grants
    // nothing the GitHub scope beside it does not already allow.
    hint: 'Can reach GitHub through its MCP server, never beyond its GitHub scope.'
  }
}

const SEVERITY_CLASS: Record<Severity, string> = {
  safe: 'bg-scope-safe-bg text-scope-safe',
  elevated: 'bg-scope-elevated-bg text-scope-elevated',
  full: 'bg-scope-full-bg text-scope-full'
}

type Axis = 'sandbox' | 'github' | 'mcp'

/**
 * One entry per axis rather than a ternary.
 *
 * This was `axis === 'sandbox' ? SANDBOX : GITHUB` with a
 * `?? SANDBOX.read_only` fallback, which meant a third axis would not fail —
 * it would render as a read-only *filesystem* chip, on a screen whose entire
 * job is saying what a persona may do. A lookup makes an unhandled axis a type
 * error instead.
 */
const AXES: Record<Axis, { table: Record<string, Descriptor>; label: string; prefix: string }> = {
  // The prefixes exist because the axes share value names — `read_only` and
  // `full_access` appear on two of them, so without one, two chips side by side
  // are byte-identical and tell you nothing.
  sandbox: { table: SANDBOX, label: 'Sandbox', prefix: 'fs' },
  github: { table: GITHUB, label: 'GitHub', prefix: 'gh' },
  mcp: { table: MCP, label: 'Reach', prefix: 'mcp' }
}

interface ScopeChipProps {
  /** Which permission axis this chip describes. */
  axis: Axis
  value: SandboxLevel | GithubScope | McpReach
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
  const { table, label: axisLabel, prefix: axisPrefix } = AXES[axis]
  const descriptor = table[value] ?? table[Object.keys(table)[0]]
  const Icon = descriptor.icon

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              'inline-flex shrink-0 cursor-default items-center gap-1 rounded-full font-mono text-meta leading-none',
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
