import { BarChart3, BookOpen, Clock, GitBranch, MessagesSquare, Users2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Section } from '@/store/useUiStore'

export interface NavItem {
  section: Section
  label: string
  icon: LucideIcon
}

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
  { section: 'chats', label: 'Chats', icon: MessagesSquare },
  { section: 'branches', label: 'Branches', icon: GitBranch },
  { section: 'personas', label: 'Personas', icon: Users2 },
  { section: 'skills', label: 'Skills', icon: BookOpen },
  { section: 'routines', label: 'Routines', icon: Clock },
  { section: 'usage', label: 'Usage', icon: BarChart3 }
]
