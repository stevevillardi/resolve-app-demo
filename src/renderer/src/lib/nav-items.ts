import { BarChart3, BookOpen, Clock, GitBranch, House, MessagesSquare, Users2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Section } from '@/store/useUiStore'

export interface NavItem {
  section: Section
  label: string
  icon: LucideIcon
}

/**
 * The geometry of a nav-rail button.
 *
 * The vendored `SidebarMenuButton` defaults to `size-8`, which is too small for
 * a rail that is the app's primary navigation, so all three of its users
 * override it. They had the same string written out verbatim three times, which
 * is one edit away from a rail whose buttons are different heights.
 *
 * Lives here rather than beside the components because a `.tsx` exporting a
 * non-component breaks React Fast Refresh — the same reason NAV_ITEMS does.
 */
export const RAIL_BUTTON =
  'h-10 gap-2.5 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center'

/**
 * The workspaces, ordered by how often you reach for them rather than
 * alphabetically: conversations are the app, everything below configures what
 * talks in them — except Branches, which sits next to Chats because it holds
 * work waiting on the user rather than configuration.
 *
 * Lives here rather than in NavRail.tsx so both the rail and the command
 * palette's "Go to" group read one list — and because a .tsx file that exports
 * a non-component breaks React Fast Refresh.
 */
export const NAV_ITEMS: NavItem[] = [
  // First, and the one the app launches on. It used to be reachable only as the
  // fall-through of Chats-with-nothing-selected — and since nothing ever clears
  // the selection except deleting a contact, picking any conversation made the
  // overview unreachable until the next relaunch.
  { section: 'home', label: 'Home', icon: House },
  { section: 'chats', label: 'Chats', icon: MessagesSquare },
  { section: 'branches', label: 'Branches', icon: GitBranch },
  { section: 'personas', label: 'Personas', icon: Users2 },
  { section: 'skills', label: 'Skills', icon: BookOpen },
  { section: 'routines', label: 'Routines', icon: Clock },
  { section: 'usage', label: 'Usage', icon: BarChart3 }
]
