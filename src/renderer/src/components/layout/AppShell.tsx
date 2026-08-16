import { useDefaultLayout } from 'react-resizable-panels'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { NavRail } from './NavRail'
import { ListPanel } from './ListPanel'
import { WorkspaceView } from './WorkspaceView'
import { NewContactFlow } from '@/components/persona/NewContactFlow'
import { GitHubConnectDialog } from '@/components/github/GitHubConnectDialog'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useUiStore } from '@/store/useUiStore'

// 64px so the inset macOS traffic lights (x:14, 3 × 12px buttons) sit fully
// inside the rail rather than straddling the list panel — see
// trafficLightPosition in src/main/index.ts.
const RAIL_WIDTH_ICON = '4rem'
const RAIL_WIDTH_EXPANDED = '13rem'

export function AppShell(): React.JSX.Element {
  useThemeSync()
  // Panel widths persist themselves to localStorage, so the shell reopens the
  // way you left it. react-resizable-panels v4 replaced the old `autoSaveId`
  // prop with this hook.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'persona-router-panes',
    storage: localStorage
  })
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
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel id="list" defaultSize={300} minSize={240} maxSize={480}>
            <ListPanel />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="workspace" minSize={420}>
            <WorkspaceView />
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>

      {/* The only two surfaces that stay modal: both are short, decision-shaped
          flows you finish and dismiss, not places you work. */}
      <NewContactFlow
        open={dialog === 'newContact'}
        onOpenChange={(open) => setDialog(open ? 'newContact' : null)}
      />
      <GitHubConnectDialog
        open={dialog === 'github'}
        onOpenChange={(open) => setDialog(open ? 'github' : null)}
        status="not_connected"
      />
    </SidebarProvider>
  )
}
