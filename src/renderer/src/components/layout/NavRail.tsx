import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { Settings } from 'lucide-react'
import { ThemeMenu } from './ThemeMenu'
import { GitHubStatusButton } from '@/components/github/GitHubStatusButton'
import { RunIndicator } from '@/components/common/RunIndicator'
import { PANE_STRIP } from '@/components/common/PaneHeader'
import { useActiveRuns } from '@/hooks/useMessages'
import { NAV_ITEMS, RAIL_BUTTON } from '@/lib/nav-items'
import { useUiStore } from '@/store/useUiStore'
import { cn } from '@/lib/utils'

export function NavRail(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const setSection = useUiStore((state) => state.setSection)
  const { data: runs = [] } = useActiveRuns()

  return (
    <Sidebar
      collapsible="icon"
      /*
       * The rail's divider starts *below* the title strip, and the strip's own
       * hairline runs the full width of the window instead.
       *
       * The macOS traffic lights are inset over the window's first 71px — three
       * 13px buttons on a 22px pitch from x:13 — and this rail is 64px wide when
       * collapsed, so a full-height right border draws a line straight through
       * the green button. Widening the rail to clear them would cost 16px of
       * every screen to buy nothing; moving the lights left far enough (x:3)
       * would jam them against the window edge.
       *
       * Nothing has to take the divider's place up there, because --sidebar and
       * --card are the same colour in both themes: with no line, the strip
       * simply reads as one continuous surface, which is what a title bar is.
       *
       * The border is kept but made transparent rather than removed, so the 1px
       * it reserves in the layout stays put and the hairline can sit exactly
       * where it used to. `bg-sidebar` on the container is what fills that 1px:
       * a transparent border shows whatever is *behind* the fixed container,
       * which is --background — white against --card in light mode and pure
       * black in dark, i.e. the same line through the traffic lights this was
       * meant to remove, just in the opposite colour. Painting the container
       * (background-clip defaults to border-box) puts the rail's own surface
       * under the border instead, and --sidebar and --card are equal, so the
       * strip stays seamless too.
       */
      className="bg-sidebar border-transparent after:absolute after:-right-px after:top-12 after:bottom-0 after:w-px after:bg-sidebar-border after:content-['']"
    >
      {/* Holds no content: the traffic lights are inset over it. `PANE_STRIP`
          rather than the rail's own classes, so this is the same surface and the
          same hairline as the list panel's and every pane's — including
          `border-border` over `border-sidebar-border`, which makes the line
          across the window match exactly rather than nearly. */}
      <SidebarHeader className={cn(PANE_STRIP, 'justify-center p-0')} />

      <SidebarContent className="px-2">
        <SidebarMenu className="gap-1">
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.section}>
              <SidebarMenuButton
                tooltip={item.label}
                // Collapsed, the label span is hidden and the button is an icon
                // with no accessible name at all — so a screen reader announces
                // six unlabelled buttons, and so does Playwright.
                aria-label={item.label}
                isActive={section === item.section}
                onClick={() => setSection(item.section)}
                className={RAIL_BUTTON}
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
          {/* What the fleet is doing right now. First in the footer because it
              is state, not a setting — the one row here that changes on its
              own — but a permanent button either way: a control that only
              exists while running cannot be learned, and an idle click gets
              an honest empty state. */}
          <SidebarMenuItem>
            <RunIndicator runs={runs} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <GitHubStatusButton />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeMenu />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SettingsButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

/** The gear. ⌘, and the application menu land in the same place. */
function SettingsButton(): React.JSX.Element {
  const setDialog = useUiStore((state) => state.setDialog)
  return (
    <SidebarMenuButton
      aria-label="Settings"
      onClick={() => setDialog('settings')}
      className={RAIL_BUTTON}
    >
      <Settings />
      <span className="group-data-[collapsible=icon]:hidden">Settings</span>
    </SidebarMenuButton>
  )
}
