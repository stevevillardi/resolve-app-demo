import { useEffect, useRef, useState } from 'react'
import { LibraryBig, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { StarterLibraryDialog } from '@/components/onboarding/StarterLibraryDialog'
import { ConversationList } from '@/components/conversation/ConversationList'
import { PersonaList } from '@/components/persona/PersonaList'
import { SkillList } from '@/components/persona/SkillList'
import { RoutineList } from '@/components/routines/RoutineList'
import { PANE_STRIP } from '@/components/common/PaneHeader'
import { UsageScopeList } from '@/components/usage/UsageScopeList'
import { ActivityScopeList } from '@/components/activity/ActivityScopeList'
import { useCreatePersona } from '@/hooks/usePersonas'
import { useCreateSkill } from '@/hooks/useSkills'
import { useContacts } from '@/hooks/useConversations'
import { BranchList } from '@/components/branches/BranchList'
import { useCreateRoutine } from '@/hooks/useRoutines'
import { FacetBar } from '@/components/common/FacetBar'
import { useSectionFacets } from '@/hooks/useSectionFacets'
import { EMPTY_LIST_FILTER, type ListFilter } from '@/lib/list-filter'
import { useUiStore, type Section } from '@/store/useUiStore'
import type { PersonaTemplateDraft, SkillDraft } from '@/types'

// `newLabel` is only set where the action actually does something — a "+" that
// visibly does nothing when clicked is worse than no "+" at all. Routines need
// a Contact to bind to, so their button is present but disabled until there is
// one — see `canCreate` below.
const PANEL: Record<Section, { title: string; searchPlaceholder?: string; newLabel?: string }> = {
  // Present only to satisfy `Record<Section, …>`. Home renders no list panel at
  // all — AppShell drops the whole panel group for it — so nothing here is ever
  // read. Kept rather than loosened to a Partial, because the exhaustiveness is
  // what makes adding a section a compile error instead of an empty pane.
  home: { title: 'Home' },
  chats: { title: 'Chats', searchPlaceholder: 'Search conversations', newLabel: 'New contact' },
  personas: { title: 'Personas', searchPlaceholder: 'Search personas', newLabel: 'New persona' },
  skills: { title: 'Skills', searchPlaceholder: 'Search skills', newLabel: 'New skill' },
  routines: { title: 'Routines', searchPlaceholder: 'Search routines', newLabel: 'New routine' },
  // §A4: the one rail whose length grows on *both* axes at once — every
  // persona and every repo — and the only one that had no way to narrow at all.
  // No facets: the dashboard beside it already owns range, measure and source.
  usage: { title: 'Usage', searchPlaceholder: 'Search personas and repos' },
  // No "+": a branch is produced by a persona doing work, never made here.
  branches: { title: 'Branches', searchPlaceholder: 'Search branches' },
  // No "+": an audit row is produced by a governance action, never made here.
  activity: { title: 'Activity' }
}

/**
 * What a brand-new persona starts as — the safest scope on both axes, read-only
 * on disk and read-only on GitHub, and no MCP servers, which is the third thing
 * that has to start closed.
 */
const NEW_PERSONA: PersonaTemplateDraft = {
  name: 'New persona',
  avatarColor: '#2a78d6',
  backend: 'claude',
  model: null,
  systemPrompt: '',
  skillIds: [],
  mcpServerIds: [],
  sandbox: 'read_only',
  githubScope: 'read_only'
}

const NEW_SKILL: SkillDraft = { name: 'New skill', description: '', content: '' }

/**
 * A new routine starts **paused**, with a schedule but no prompt.
 *
 * Everything else in this app creates something inert. A routine is the one
 * thing that would start doing work on its own the moment it exists, and an
 * empty prompt firing unattended at 09:00 tomorrow is not what anyone meant by
 * pressing "+".
 */
const NEW_ROUTINE_SCHEDULE = '0 9 * * *'

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
  const setSelectedRoutineId = useUiStore((state) => state.setSelectedRoutineId)
  const [filter, setFilter] = useState<ListFilter>(EMPTY_LIST_FILTER)
  const query = filter.query
  const setQuery = (next: string): void => setFilter((current) => ({ ...current, query: next }))
  const searchRef = useRef<HTMLInputElement>(null)
  const config = PANEL[section]
  const facets = useSectionFacets(section)

  /**
   * `/` focuses the search, `esc` clears it and gives focus back.
   *
   * Guarded on the event target rather than on a flag: `/` is a perfectly
   * ordinary character to type into the composer or a system prompt, and a
   * global binding that swallowed it would be a much worse bug than the missing
   * shortcut. Capture phase for the same reason ⌘K uses it — a bubbling
   * listener loses to any component that stops propagation first.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true

      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }

      if (event.key === 'Escape' && target === searchRef.current) {
        // Only when there is something to clear. Otherwise `esc` should keep
        // meaning "close whatever is open", which is what everything else in
        // the app uses it for.
        setFilter((current) => {
          if (current.query) searchRef.current?.focus()
          return { ...current, query: '' }
        })
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // A search left behind in one section is invisible in the next but still
  // filtering it, which reads as an empty list rather than as a filter.
  //
  // Adjusted during render rather than in an effect: React's own documented
  // pattern for resetting state when something changes, and the one the
  // set-state-in-effect rule is pointing at. An effect would render the stale
  // filter once before clearing it.
  const [searchedSection, setSearchedSection] = useState(section)
  if (searchedSection !== section) {
    setSearchedSection(section)
    // The facets go with it. A repo chosen in Chats means nothing in Skills,
    // and `matchesFacets` treats a selection it has no values for as matching
    // nothing — so carrying one across would empty the next rail with no
    // visible cause. Adjusted during render rather than in an effect, which is
    // React's own documented pattern and what the query already used.
    setFilter(EMPTY_LIST_FILTER)
  }

  const { create: createPersona } = useCreatePersona()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const { create: createSkill } = useCreateSkill()
  const { create: createRoutine } = useCreateRoutine()
  const contacts = useContacts().data ?? []

  // A routine's contact_id is NOT NULL, so there has to be a Contact to bind
  // to. Disabled-with-a-reason beats a button that throws.
  const canCreate = section !== 'routines' || contacts.length > 0

  // Creating selects the new row, so "+" lands the user in the editor with the
  // cursor somewhere useful rather than adding a row they then have to find.
  const onNew = (): void => {
    if (section === 'personas') return createPersona(NEW_PERSONA, (p) => setSelectedPersonaId(p.id))
    if (section === 'skills') return createSkill(NEW_SKILL, (s) => setSelectedSkillId(s.id))
    if (section === 'routines') {
      const contact = contacts[0]
      if (!contact) return
      return createRoutine(
        {
          contactId: contact.id,
          schedule: NEW_ROUTINE_SCHEDULE,
          prompt: '',
          enabled: false,
          monthlyBudgetUsd: null
        },
        (routine) => setSelectedRoutineId(routine.id)
      )
    }
    setDialog('newContact')
  }

  return (
    <div className="bg-card flex h-full min-h-0 flex-col">
      {/* The window's title strip, deliberately empty.

          The macOS traffic lights are inset over the window's first 71px, and
          the nav rail is only 64px wide — so this pane's left padding lands 8px
          from the green button. A section title there was legible but crowded,
          and the only ways to buy it room were to widen the rail or to indent
          the title away from the rows it heads. Both are worse than giving the
          strip up: with the rail's divider stopped above (NavRail.tsx) the
          lights now sit in an unbroken surface, and the title moved down to
          where it can be a heading rather than a label wedged beside chrome. */}
      <div className={PANE_STRIP} />

      <div className="border-border drag-region shrink-0 border-b">
        {/* The actions stay with the title rather than in the strip above: a "+"
            beside "Personas" says what it adds; a "+" floating in the title bar
            does not. */}
        <div className="flex items-center justify-between gap-2 pt-2.5 pr-2 pb-1.5 pl-4">
          <h2 className="truncate text-base font-semibold tracking-tight">{config.title}</h2>
          <span className="flex items-center">
            {/* The catalog's durable re-entry point: onboarding's chooser is
              one-shot, and both of these sections are made of what it seeds. */}
            {(section === 'personas' || section === 'skills') && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setLibraryOpen(true)}
                      aria-label="Browse starter library"
                      className="no-drag"
                    >
                      <LibraryBig className="size-4" />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">Browse starter library</TooltipContent>
              </Tooltip>
            )}
            {config.newLabel && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={onNew}
                      disabled={!canCreate}
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
          </span>
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
                ref={searchRef}
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
        {/* Under the box rather than beside it: the chips wrap, and a row that
            grows sideways into the search field would push the field's own
            clear button off the edge on a narrow panel (the rail goes down to
            240px). */}
        <FacetBar specs={facets} filter={filter} onChange={setFilter} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* data-slot so the screenshot sweep can address "the rows of whatever
            section is open" without knowing which component drew them. */}
        <div data-slot="list-body" className="p-2">
          {/* Its own boundary, separate from the workspace's: a bad row must not
              take the search field and the "+" with it, and losing the list is
              the one failure that leaves you unable to select your way out. */}
          <ErrorBoundary variant="pane" resetKey={section}>
            {section === 'chats' && <ConversationList filter={filter} />}
            {section === 'personas' && <PersonaList filter={filter} />}
            {section === 'skills' && <SkillList filter={filter} />}
            {section === 'routines' && <RoutineList filter={filter} />}
            {section === 'usage' && <UsageScopeList query={query} />}
            {section === 'branches' && <BranchList filter={filter} />}
            {section === 'activity' && <ActivityScopeList />}
          </ErrorBoundary>
        </div>
      </ScrollArea>

      <StarterLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />
    </div>
  )
}
