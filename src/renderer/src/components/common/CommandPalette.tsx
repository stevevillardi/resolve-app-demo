import { useMemo, useState } from 'react'
import { BookOpen, Clock, Moon, Plus, Sun } from 'lucide-react'
// lucide 1.x dropped brand marks, so the GitHub logo is inlined in the repo.
import { Github } from '@/components/github/GithubMark'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ScopeChip } from '@/components/common/ScopeChip'
import { NAV_ITEMS } from '@/lib/nav-items'
import { useContacts, useGroups } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useSkills } from '@/hooks/useSkills'
import { buildCommandSections, type CommandItem as Command_ } from '@/lib/command-palette'
import { repoName } from '@/lib/format'
import { useRoutines } from '@/hooks/useRoutines'
import { useUiStore } from '@/store/useUiStore'

/**
 * ⌘K — jump to anything, or start anything.
 *
 * A console is keyboard-first, and before this the app had exactly one shortcut
 * (⌘B, bound by the sidebar). Every row carries the identity of what it opens
 * rather than being flattened to a string: personas bring their scope chips,
 * conversations their persona colour and repo. Recognising the thing you want
 * is most of what a palette is for.
 *
 * Filtering is ours, not cmdk's (`shouldFilter={false}`), so that group order
 * is fixed and scoring is testable — see lib/command-palette.ts.
 */
export function CommandPalette(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const dialog = useUiStore((state) => state.dialog)
  const setDialog = useUiStore((state) => state.setDialog)
  const setSection = useUiStore((state) => state.setSection)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)
  const setSelectedPersonaId = useUiStore((state) => state.setSelectedPersonaId)
  const setSelectedSkillId = useUiStore((state) => state.setSelectedSkillId)
  const setSelectedRoutineId = useUiStore((state) => state.setSelectedRoutineId)
  const setThemePreference = useUiStore((state) => state.setThemePreference)

  const { data: contacts = [] } = useContacts()
  const { data: groups = [] } = useGroups()
  const { data: personas = [] } = usePersonas()
  const { data: skills = [] } = useSkills()
  const { data: routines = [] } = useRoutines()

  const open = dialog === 'command'
  const close = (): void => {
    setDialog(null)
    setQuery('')
  }

  /** Every row's payload, keyed by the id the pure layer sorts on. */
  const { items, run, render } = useMemo(() => {
    const items: Command_[] = []
    const run = new Map<string, () => void>()
    const render = new Map<string, React.ReactNode>()

    const personaFor = (id: string): (typeof personas)[number] | undefined =>
      personas.find((persona) => persona.id === id)

    for (const contact of contacts) {
      const persona = personaFor(contact.personaTemplateId)
      const id = `contact:${contact.id}`
      items.push({
        id,
        group: 'Conversations',
        label: persona?.name ?? contact.displayName,
        detail: contact.repoPath
      })
      run.set(id, () => {
        setSection('chats')
        setSelectedConversation({ kind: 'contact', id: contact.id })
      })
      render.set(
        id,
        <>
          <AvatarColorSwatch
            name={persona?.name ?? contact.displayName}
            color={persona?.avatarColor ?? 'var(--muted)'}
            size="xs"
          />
          <span className="truncate">{persona?.name ?? contact.displayName}</span>
          <CommandShortcut className="truncate font-mono text-[11px] tracking-normal">
            {repoName(contact.repoPath)}
          </CommandShortcut>
        </>
      )
    }

    for (const group of groups) {
      const id = `group:${group.id}`
      items.push({
        id,
        group: 'Conversations',
        label: repoName(group.repoPath),
        detail: group.repoPath,
        keywords: ['group', 'repo']
      })
      run.set(id, () => {
        setSection('chats')
        setSelectedConversation({ kind: 'group', id: group.id })
      })
      render.set(
        id,
        <>
          <span className="bg-muted size-4 shrink-0 rounded-[4px]" aria-hidden />
          <span className="truncate">{repoName(group.repoPath)}</span>
          <CommandShortcut className="shrink-0 text-[11px] tracking-normal">
            Repo group
          </CommandShortcut>
        </>
      )
    }

    for (const persona of personas) {
      const id = `persona:${persona.id}`
      items.push({
        id,
        group: 'Personas',
        label: persona.name,
        detail: persona.systemPrompt,
        keywords: [persona.backend, persona.sandbox, persona.githubScope]
      })
      run.set(id, () => {
        setSection('personas')
        setSelectedPersonaId(persona.id)
      })
      render.set(
        id,
        <>
          <AvatarColorSwatch name={persona.name} color={persona.avatarColor} size="xs" />
          <span className="truncate">{persona.name}</span>
          {/* The scope chips travel with the persona everywhere else in the
              app; dropping them here would make the palette the one place a
              persona's permissions are invisible. */}
          <CommandShortcut className="flex shrink-0 items-center gap-1 tracking-normal">
            <ScopeChip axis="sandbox" value={persona.sandbox} />
            <ScopeChip axis="github" value={persona.githubScope} />
          </CommandShortcut>
        </>
      )
    }

    for (const skill of skills) {
      const id = `skill:${skill.id}`
      items.push({ id, group: 'Skills', label: skill.name, detail: skill.description })
      run.set(id, () => {
        setSection('skills')
        setSelectedSkillId(skill.id)
      })
      render.set(
        id,
        <>
          <BookOpen className="text-muted-foreground" />
          <span className="truncate">{skill.name}</span>
          <CommandShortcut className="truncate text-[11px] tracking-normal">
            {skill.description}
          </CommandShortcut>
        </>
      )
    }

    for (const routine of routines) {
      const contact = contacts.find((candidate) => candidate.id === routine.contactId)
      const persona = personas.find((candidate) => candidate.id === contact?.personaTemplateId)
      const id = `routine:${routine.id}`
      items.push({
        id,
        group: 'Routines',
        label: persona?.name ?? 'Routine',
        detail: `${routine.schedule} ${routine.prompt}`,
        keywords: ['schedule', 'cron']
      })
      run.set(id, () => {
        setSection('routines')
        setSelectedRoutineId(routine.id)
      })
      render.set(
        id,
        <>
          <Clock className="text-muted-foreground" />
          <span className="truncate">{persona?.name ?? 'Routine'}</span>
          <CommandShortcut className="shrink-0 font-mono text-[11px] tracking-normal">
            {routine.schedule}
          </CommandShortcut>
        </>
      )
    }

    for (const nav of NAV_ITEMS) {
      const id = `section:${nav.section}`
      items.push({ id, group: 'Go to', label: nav.label })
      run.set(id, () => setSection(nav.section))
      render.set(
        id,
        <>
          <nav.icon className="text-muted-foreground" />
          <span>{nav.label}</span>
        </>
      )
    }

    const actions: {
      id: string
      label: string
      icon: React.ReactNode
      keywords?: string[]
      onRun: () => void
    }[] = [
      {
        id: 'action:new-contact',
        label: 'New contact',
        icon: <Plus className="text-muted-foreground" />,
        keywords: ['bind', 'repo', 'create'],
        onRun: () => setDialog('newContact')
      },
      {
        id: 'action:connect-github',
        label: 'Connect GitHub',
        icon: <Github className="text-muted-foreground" />,
        keywords: ['auth', 'login', 'token'],
        onRun: () => setDialog('github')
      },
      {
        id: 'action:theme-light',
        label: 'Switch to light theme',
        icon: <Sun className="text-muted-foreground" />,
        keywords: ['appearance', 'mode'],
        onRun: () => setThemePreference('light')
      },
      {
        id: 'action:theme-dark',
        label: 'Switch to dark theme',
        icon: <Moon className="text-muted-foreground" />,
        keywords: ['appearance', 'mode'],
        onRun: () => setThemePreference('dark')
      }
    ]

    for (const action of actions) {
      items.push({
        id: action.id,
        group: 'Actions',
        label: action.label,
        ...(action.keywords && { keywords: action.keywords })
      })
      run.set(action.id, action.onRun)
      render.set(
        action.id,
        <>
          {action.icon}
          <span>{action.label}</span>
        </>
      )
    }

    return { items, run, render }
  }, [
    contacts,
    groups,
    personas,
    routines,
    skills,
    setDialog,
    setSection,
    setSelectedConversation,
    setSelectedPersonaId,
    setSelectedRoutineId,
    setSelectedSkillId,
    setThemePreference
  ])

  const sections = useMemo(() => buildCommandSections(items, query), [items, query])

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? setDialog('command') : close())}
      title="Command palette"
      description="Jump to a conversation, persona, skill or routine, or start a new one."
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Jump to or start anything…"
        />
        <CommandList className="max-h-[22rem]">
          <CommandEmpty className="text-muted-foreground">
            Nothing matches “{query.trim()}”.
          </CommandEmpty>
          {sections.map((section) => (
            <CommandGroup key={section.group} heading={section.group}>
              {section.items.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={entry.id}
                  onSelect={() => {
                    run.get(entry.id)?.()
                    close()
                  }}
                >
                  {render.get(entry.id)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <div className="border-border text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1">
            <CommandShortcut className="ml-0 font-mono">↑↓</CommandShortcut> navigate
          </span>
          <span className="flex items-center gap-1">
            <CommandShortcut className="ml-0 font-mono">↵</CommandShortcut> open
          </span>
          <span className="flex items-center gap-1">
            <CommandShortcut className="ml-0 font-mono">esc</CommandShortcut> dismiss
          </span>
        </div>
      </Command>
    </CommandDialog>
  )
}
