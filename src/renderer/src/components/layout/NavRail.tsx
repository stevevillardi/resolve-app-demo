import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { ThemeMenu } from './ThemeMenu'
import { GitHubStatusButton } from '@/components/github/GitHubStatusButton'
import { RunIndicator } from '@/components/common/RunIndicator'
import { useActiveRuns } from '@/hooks/useMessages'
import { NAV_ITEMS } from '@/lib/nav-items'
import { useUiStore } from '@/store/useUiStore'

export function NavRail(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const setSection = useUiStore((state) => state.setSection)
  const navExpanded = useUiStore((state) => state.navExpanded)
  const { data: runs = [] } = useActiveRuns()

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border border-r">
      {/* The macOS traffic lights are inset over this strip (see
          titleBarStyle: 'hiddenInset' in src/main/index.ts), so it holds no
          content of its own and drags the window instead. */}
      <SidebarHeader className="drag-region h-12 justify-center p-0" />

      <SidebarContent className="px-2">
        <SidebarMenu className="gap-1">
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.section}>
              <SidebarMenuButton
                tooltip={item.label}
                isActive={section === item.section}
                onClick={() => setSection(item.section)}
                className="h-10 gap-2.5 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center"
              >
                <item.icon />
                {/* Hidden rather than clipped when collapsed — the button's
                    own overflow-hidden leaves a sliver of the word visible. */}
                <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="gap-1 px-2 pb-3">
        {/* What the fleet is doing right now. It sits above the account and
            appearance controls because it is state, not a setting — and it is
            the one thing here that changes on its own. */}
        <RunIndicator count={runs.length} expanded={navExpanded} />
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <GitHubStatusButton />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
