import { useState } from 'react'
import {
  BarChart3,
  BookOpen,
  Clock,
  GitFork,
  Moon,
  Sun,
  SunMoon,
  UserPlus,
  Users2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ConversationList } from '@/components/conversation/ConversationList'
import { NewContactFlow } from '@/components/persona/NewContactFlow'
import { PersonaDetailPanel } from '@/components/persona/PersonaDetailPanel'
import { SkillLibraryView } from '@/components/persona/SkillLibraryView'
import { UsageDashboard } from '@/components/usage/UsageDashboard'
import { GitHubConnectDialog } from '@/components/github/GitHubConnectDialog'
import { RoutineEditor } from '@/components/routines/RoutineEditor'
import { routines } from '@/mocks'
import { useUiStore, type ThemePreference } from '@/store/useUiStore'
import { cn } from '@/lib/utils'

const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark']
const THEME_ICON: Record<ThemePreference, React.JSX.Element> = {
  system: <SunMoon className="size-4" />,
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />
}

type Overlay = 'newContact' | 'personas' | 'skills' | 'usage' | 'routines' | null

export function Sidebar({ className }: { className?: string }): React.JSX.Element {
  const themePreference = useUiStore((state) => state.themePreference)
  const setThemePreference = useUiStore((state) => state.setThemePreference)
  const [overlay, setOverlay] = useState<Overlay>(null)

  const cycleTheme = (): void => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(themePreference) + 1) % THEME_CYCLE.length]
    setThemePreference(next)
  }

  return (
    <div className={cn('bg-card flex h-full flex-col', className)}>
      <div className="flex items-center justify-between px-3 py-3">
        <p className="text-sm font-semibold">Persona Router</p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={cycleTheme}
          aria-label={`Theme: ${themePreference}`}
        >
          {THEME_ICON[themePreference]}
        </Button>
      </div>
      <Separator />
      <div className="min-h-0 flex-1">
        <ConversationList />
      </div>
      <Separator />
      <div className="flex items-center justify-between gap-1 px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => setOverlay('newContact')}
        >
          <UserPlus className="size-4" />
          New
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Personas"
          onClick={() => setOverlay('personas')}
        >
          <Users2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Skill library"
          onClick={() => setOverlay('skills')}
        >
          <BookOpen className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Routines"
          onClick={() => setOverlay('routines')}
        >
          <Clock className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Usage dashboard"
          onClick={() => setOverlay('usage')}
        >
          <BarChart3 className="size-4" />
        </Button>
        <GitHubConnectDialog
          status="not_connected"
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Connect GitHub">
              <GitFork className="size-4" />
            </Button>
          }
        />
      </div>

      <NewContactFlow
        open={overlay === 'newContact'}
        onOpenChange={(open) => setOverlay(open ? 'newContact' : null)}
      />
      <PersonaDetailPanel
        open={overlay === 'personas'}
        onOpenChange={(open) => setOverlay(open ? 'personas' : null)}
      />
      <SkillLibraryView
        open={overlay === 'skills'}
        onOpenChange={(open) => setOverlay(open ? 'skills' : null)}
      />
      <UsageDashboard
        open={overlay === 'usage'}
        onOpenChange={(open) => setOverlay(open ? 'usage' : null)}
      />
      <RoutineEditor
        open={overlay === 'routines'}
        onOpenChange={(open) => setOverlay(open ? 'routines' : null)}
        routine={routines[0]}
      />
    </div>
  )
}
