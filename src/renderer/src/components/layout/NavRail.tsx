import { BarChart3, BookOpen, Clock, MessagesSquare, Users2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import { useUiStore, type Section } from '@/store/useUiStore'

interface NavItem {
  section: Section
  label: string
  icon: LucideIcon
}

// Ordered by how often you reach for them, not alphabetically: conversations
// are the app, everything below configures what talks in them.
const NAV_ITEMS: NavItem[] = [
  { section: 'chats', label: 'Chats', icon: MessagesSquare },
  { section: 'personas', label: 'Personas', icon: Users2 },
  { section: 'skills', label: 'Skills', icon: BookOpen },
  { section: 'routines', label: 'Routines', icon: Clock },
  { section: 'usage', label: 'Usage', icon: BarChart3 }
]

export function NavRail(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const setSection = useUiStore((state) => state.setSection)

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
