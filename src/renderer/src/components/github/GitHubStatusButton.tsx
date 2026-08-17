import { Github } from './GithubMark'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { useAuthStatus } from '@/hooks/useAuth'
import { RAIL_BUTTON } from '@/lib/nav-items'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/useUiStore'

/**
 * Three states, not two.
 *
 * It used to render `connected` straight from "a token is stored", which is all
 * `getGitHubStatus` could tell it — so a token revoked on github.com showed a
 * healthy dot forever and the only symptom was a feature failing somewhere
 * else. `tokenState` is now what GitHub last actually said, and a rejected
 * token gets the same red the `full_access` scope chip uses: this is the one
 * status in the rail that needs something done about it.
 */
type Dot = 'absent' | 'ok' | 'attention'

export function GitHubStatusButton(): React.JSX.Element {
  const setDialog = useUiStore((state) => state.setDialog)
  const { data: status } = useAuthStatus()
  const github = status?.github

  const dot: Dot = !github?.connected
    ? 'absent'
    : github.tokenState === 'rejected' || github.tokenState === 'locked'
      ? 'attention'
      : 'ok'

  return (
    <SidebarMenuButton
      tooltip={tooltip(github)}
      onClick={() => setDialog('github')}
      className={cn('relative', RAIL_BUTTON)}
    >
      <Github />
      <span className="group-data-[collapsible=icon]:hidden">GitHub</span>
      {/* A dot, not a red badge — not being connected yet is a normal state on
          first run, not an error the user has to clear. A *rejected* token is
          different: something worked yesterday and does not today. */}
      <span
        aria-hidden
        data-dot={dot}
        // Pinned to the icon's top-right corner, not the button's — otherwise
        // it lands on the label once the rail expands.
        className={cn(
          'ring-sidebar absolute top-2 left-5 size-2 rounded-full ring-2',
          'data-[dot=absent]:bg-muted-foreground/60',
          'data-[dot=ok]:bg-scope-elevated',
          'data-[dot=attention]:bg-scope-full'
        )}
      />
    </SidebarMenuButton>
  )
}

function tooltip(
  github: { connected: boolean; login?: string; error?: string } | undefined
): string {
  if (!github?.connected) return 'GitHub · not connected'
  // The error, when there is one, already says what to do about it — repeating
  // "connected" alongside it would be the same lie in a smaller font.
  if (github.error) return `GitHub · ${github.error}`
  return `GitHub · connected${github.login ? ` as ${github.login}` : ''}`
}
