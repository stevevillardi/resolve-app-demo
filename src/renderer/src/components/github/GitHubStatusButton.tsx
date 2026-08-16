import { Github } from './GithubMark'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { useUiStore } from '@/store/useUiStore'

// Static until Phase 3 (docs/plan/03-app-auth.md) wires real device-flow state.
const CONNECTED = false

export function GitHubStatusButton(): React.JSX.Element {
  const setDialog = useUiStore((state) => state.setDialog)

  return (
    <SidebarMenuButton
      tooltip={CONNECTED ? 'GitHub · connected' : 'GitHub · not connected'}
      onClick={() => setDialog('github')}
      className="relative h-10 gap-2.5 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center"
    >
      <Github />
      <span className="group-data-[collapsible=icon]:hidden">GitHub</span>
      {/* A dot, not a red badge — not being connected yet is a normal state on
          first run, not an error the user has to clear. */}
      <span
        aria-hidden
        data-connected={CONNECTED}
        // Pinned to the icon's top-right corner, not the button's — otherwise
        // it lands on the label once the rail expands.
        className="ring-sidebar data-[connected=false]:bg-muted-foreground/60 data-[connected=true]:bg-scope-elevated absolute top-2 left-5 size-2 rounded-full ring-2"
      />
    </SidebarMenuButton>
  )
}
