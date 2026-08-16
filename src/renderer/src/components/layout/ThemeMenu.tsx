import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { useUiStore, type ThemePreference } from '@/store/useUiStore'

const THEMES: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
]

// A menu rather than a cycling button: cycling forces you to click through
// states you don't want and never shows which of the three is active.
export function ThemeMenu(): React.JSX.Element {
  const themePreference = useUiStore((state) => state.themePreference)
  const setThemePreference = useUiStore((state) => state.setThemePreference)
  const active = THEMES.find((theme) => theme.value === themePreference) ?? THEMES[0]
  const ActiveIcon = active.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            aria-label={`Theme: ${active.label}`}
            className="h-10 gap-2.5 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center"
          >
            <ActiveIcon />
            <span className="group-data-[collapsible=icon]:hidden">Theme</span>
          </SidebarMenuButton>
        }
      />
      <DropdownMenuContent side="right" align="end" className="w-44">
        <DropdownMenuRadioGroup
          value={themePreference}
          onValueChange={(value) => setThemePreference(value as ThemePreference)}
        >
          {THEMES.map((theme) => (
            <DropdownMenuRadioItem key={theme.value} value={theme.value}>
              <theme.icon />
              {theme.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
