import { useDefaultLayout } from 'react-resizable-panels'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { NavRail } from './NavRail'
import { ListPanel } from './ListPanel'
import { WorkspaceView } from './WorkspaceView'
import { NewContactFlow } from '@/components/persona/NewContactFlow'
import { GitHubConnectDialog } from '@/components/github/GitHubConnectDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { CommandPalette } from '@/components/common/CommandPalette'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useAuthRecoveryOnFocus, useVerifyGitHub } from '@/hooks/useAuth'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useMenuActions } from '@/hooks/useMenuActions'
import { useNavigationEvents } from '@/hooks/useNavigationEvents'
import { useUiStore } from '@/store/useUiStore'

// 64px so the inset macOS traffic lights (x:14, 3 × 12px buttons) sit fully
// inside the rail rather than straddling the list panel — see
// trafficLightPosition in src/main/index.ts.
const RAIL_WIDTH_ICON = '4rem'
const RAIL_WIDTH_EXPANDED = '13rem'

export function AppShell(): React.JSX.Element {
  useThemeSync()
  useVerifyGitHub()
  useAuthRecoveryOnFocus()
  useCommandPalette()
  useMenuActions()
  useNavigationEvents()
  // Panel widths persist themselves to localStorage, so the shell reopens the
  // way you left it. react-resizable-panels v4 replaced the old `autoSaveId`
  // prop with this hook.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'switchboard-panes',
    storage: localStorage
  })
  const section = useUiStore((state) => state.section)
  const navExpanded = useUiStore((state) => state.navExpanded)
  const setNavExpanded = useUiStore((state) => state.setNavExpanded)
  const dialog = useUiStore((state) => state.dialog)
  const setDialog = useUiStore((state) => state.setDialog)

  return (
    <SidebarProvider
      open={navExpanded}
      onOpenChange={setNavExpanded}
      style={
        {
          '--sidebar-width': RAIL_WIDTH_EXPANDED,
          '--sidebar-width-icon': RAIL_WIDTH_ICON
        } as React.CSSProperties
      }
      className="h-screen min-h-0 overflow-hidden"
    >
      <NavRail />
      <SidebarInset className="min-w-0 overflow-hidden">
        {/* Pixel sizes, not percentages: the list panel holds fixed-width rows,
            so what matters is that it never gets narrower than a readable row
            — not that it keeps a share of the window. */}
        {/*
          Home has no master list — it summarises every section, so a list beside
          it would be a list of what? Rendering the panel group at all on Home
          would also mean react-resizable-panels persisting a layout for a
          two-panel arrangement that is only sometimes two panels, so the whole
          group is skipped instead and the saved widths are left untouched for
          when a real section comes back.
        */}
        {section === 'home' ? (
          <WorkspaceView />
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
          >
            <ResizablePanel id="list" defaultSize={300} minSize={240} maxSize={480}>
              <ListPanel />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="workspace" minSize={420}>
              <WorkspaceView />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </SidebarInset>

      {/* The modal surfaces: short, decision-shaped flows you finish and
          dismiss, not places you work. */}
      <NewContactFlow
        open={dialog === 'newContact'}
        onOpenChange={(open) => setDialog(open ? 'newContact' : null)}
      />
      <GitHubConnectDialog
        open={dialog === 'github'}
        onOpenChange={(open) => setDialog(open ? 'github' : null)}
      />
      <SettingsDialog
        open={dialog === 'settings'}
        onOpenChange={(open) => setDialog(open ? 'settings' : null)}
      />
      <CommandPalette />
    </SidebarProvider>
  )
}
