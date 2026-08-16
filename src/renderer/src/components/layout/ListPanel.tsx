import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConversationList } from '@/components/conversation/ConversationList'
import { PersonaList } from '@/components/persona/PersonaList'
import { SkillList } from '@/components/persona/SkillList'
import { RoutineList } from '@/components/routines/RoutineList'
import { UsageScopeList } from '@/components/usage/UsageScopeList'
import { useUiStore, type Section } from '@/store/useUiStore'

// `newLabel` is only set where the action actually does something. Creating a
// persona, skill, or routine needs somewhere to persist it, which arrives with
// the data layer in Phase 4 — a "+" that visibly does nothing when clicked is
// worse than no "+" at all, so those get one then.
const PANEL: Record<Section, { title: string; searchPlaceholder?: string; newLabel?: string }> = {
  chats: { title: 'Chats', searchPlaceholder: 'Search conversations', newLabel: 'New contact' },
  personas: { title: 'Personas', searchPlaceholder: 'Search personas' },
  skills: { title: 'Skills', searchPlaceholder: 'Search skills' },
  routines: { title: 'Routines', searchPlaceholder: 'Search routines' },
  usage: { title: 'Usage' }
}

/**
 * The middle pane. Every section is master-detail, so this owns the chrome —
 * title, search, primary action — and only the list body changes. Keeping one
 * header means the window's top edge stays a single unbroken drag strip
 * regardless of which section is open.
 */
export function ListPanel(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const setDialog = useUiStore((state) => state.setDialog)
  const [query, setQuery] = useState('')
  const config = PANEL[section]

  const onNew = (): void => setDialog('newContact')

  return (
    <div className="bg-card flex h-full min-h-0 flex-col">
      <div className="border-border drag-region shrink-0 border-b">
        <div className="flex h-12 items-center justify-between gap-2 pr-2 pl-4">
          <h2 className="truncate text-sm font-semibold tracking-tight">{config.title}</h2>
          {config.newLabel && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onNew}
                    aria-label={config.newLabel}
                    className="no-drag"
                  >
                    <Plus className="size-4" />
                  </Button>
                }
              />
              <TooltipContent side="bottom">{config.newLabel}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {config.searchPlaceholder && (
          <div className="no-drag relative px-4 pb-2.5">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={config.searchPlaceholder}
              aria-label={config.searchPlaceholder}
              className="bg-background border-border focus-visible:border-ring focus-visible:ring-ring/40 placeholder:text-muted-foreground h-7 w-full rounded-md border pr-2 pl-7 text-xs outline-none focus-visible:ring-2 [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {section === 'chats' && <ConversationList query={query} />}
          {section === 'personas' && <PersonaList query={query} />}
          {section === 'skills' && <SkillList query={query} />}
          {section === 'routines' && <RoutineList query={query} />}
          {section === 'usage' && <UsageScopeList />}
        </div>
      </ScrollArea>
    </div>
  )
}
