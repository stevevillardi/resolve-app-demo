import { useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConversationList } from '@/components/conversation/ConversationList'
import { PersonaList } from '@/components/persona/PersonaList'
import { SkillList } from '@/components/persona/SkillList'
import { RoutineList } from '@/components/routines/RoutineList'
import { UsageScopeList } from '@/components/usage/UsageScopeList'
import { useCreatePersona } from '@/hooks/usePersonas'
import { useCreateSkill } from '@/hooks/useSkills'
import { useUiStore, type Section } from '@/store/useUiStore'
import type { PersonaTemplateDraft, SkillDraft } from '@/types'

// `newLabel` is only set where the action actually does something — a "+" that
// visibly does nothing when clicked is worse than no "+" at all. Personas and
// skills got theirs in Phase 4, when there was finally somewhere to persist
// them. Routines stay without one until Phase 8: a routine is bound to a
// contact, and there are no contacts to bind to until Phase 6.
const PANEL: Record<Section, { title: string; searchPlaceholder?: string; newLabel?: string }> = {
  chats: { title: 'Chats', searchPlaceholder: 'Search conversations', newLabel: 'New contact' },
  personas: { title: 'Personas', searchPlaceholder: 'Search personas', newLabel: 'New persona' },
  skills: { title: 'Skills', searchPlaceholder: 'Search skills', newLabel: 'New skill' },
  routines: { title: 'Routines', searchPlaceholder: 'Search routines' },
  usage: { title: 'Usage' }
}

/** What a brand-new persona starts as — the safest scope on both axes (§4). */
const NEW_PERSONA: PersonaTemplateDraft = {
  name: 'New persona',
  avatarColor: '#2a78d6',
  backend: 'claude',
  model: null,
  systemPrompt: '',
  skillIds: [],
  sandbox: 'read_only',
  githubScope: 'read_only'
}

const NEW_SKILL: SkillDraft = { name: 'New skill', description: '', content: '' }

/**
 * The middle pane. Every section is master-detail, so this owns the chrome —
 * title, search, primary action — and only the list body changes. Keeping one
 * header means the window's top edge stays a single unbroken drag strip
 * regardless of which section is open.
 */
export function ListPanel(): React.JSX.Element {
  const section = useUiStore((state) => state.section)
  const setDialog = useUiStore((state) => state.setDialog)
  const setSelectedPersonaId = useUiStore((state) => state.setSelectedPersonaId)
  const setSelectedSkillId = useUiStore((state) => state.setSelectedSkillId)
  const [query, setQuery] = useState('')
  const config = PANEL[section]

  const { create: createPersona } = useCreatePersona()
  const { create: createSkill } = useCreateSkill()

  // Creating selects the new row, so "+" lands the user in the editor with the
  // cursor somewhere useful rather than adding a row they then have to find.
  const onNew = (): void => {
    if (section === 'personas') return createPersona(NEW_PERSONA, (p) => setSelectedPersonaId(p.id))
    if (section === 'skills') return createSkill(NEW_SKILL, (s) => setSelectedSkillId(s.id))
    setDialog('newContact')
  }

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
          // InputGroup rather than an absolutely-positioned icon: the icon is a
          // flex sibling of the field, so it centres on the input itself. The
          // previous revision anchored it to `top-1/2` of this padded wrapper,
          // which put it half the bottom padding below the text.
          <div className="no-drag px-4 pb-2.5">
            {/* `border-input` is near-white in light mode, which is invisible
                against `--background`; the search field wants the same hairline
                every other pane edge uses. */}
            <InputGroup className="bg-background dark:bg-background border-border h-7 rounded-md">
              <InputGroupAddon className="pl-2">
                <Search className="text-muted-foreground size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={config.searchPlaceholder}
                aria-label={config.searchPlaceholder}
                className="h-7 text-xs [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query && (
                <InputGroupAddon align="inline-end" className="pr-1.5">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                  >
                    <X className="size-3" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
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
