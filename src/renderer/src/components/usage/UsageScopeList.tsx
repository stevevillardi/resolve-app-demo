import { useMemo } from 'react'
import { FolderGit2, Layers } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useUsageEvents } from '@/hooks/useUsage'
import { repoName } from '@/lib/format'
import { formatCostSummary, usageForContacts } from '@/lib/usage'
import { useUiStore } from '@/store/useUiStore'

/**
 * Master list for the usage section: all spend, one persona's, or one repo's.
 *
 * Persona and repo are the two axes blueprint §10 names, and a Contact sits at
 * the intersection of them — so scoping lives here and the dashboard is left to
 * the range, source and metric controls.
 */
export function UsageScopeList(): React.JSX.Element {
  const scope = useUiStore((state) => state.usageScope)
  const setScope = useUiStore((state) => state.setUsageScope)

  const { data: events = [] } = useUsageEvents()
  const { data: contacts = [], isPending } = useContacts()
  const { data: personas = [] } = usePersonas()

  // Every repo any Contact is bound to, whether or not it has spent anything —
  // a repo that has cost nothing yet is still a place work happens, and hiding
  // it until it bills would make the list flicker into existence mid-demo.
  const repoPaths = useMemo(
    () => [...new Set(contacts.map((contact) => contact.repoPath))].sort(),
    [contacts]
  )

  const costFor = (contactIds: string[]): string =>
    formatCostSummary(usageForContacts(events, contactIds))

  const cost = (contactIds: string[]): React.JSX.Element => (
    <span className="text-muted-foreground shrink-0 font-mono text-meta tabular-nums">
      {costFor(contactIds)}
    </span>
  )

  const heading = (text: string): React.JSX.Element => (
    <p className="text-muted-foreground px-2 pt-3 pb-1 text-meta font-medium tracking-wide uppercase">
      {text}
    </p>
  )

  // "All personas" with a "—" beside it is not a neutral thing to render while
  // the first fetch is in flight: it reads as a fleet that has spent nothing.
  if (isPending) return <EmptyState compact loading title="Loading usage…" />

  return (
    <div className="flex flex-col">
      <ListRow
        active={scope.kind === 'all'}
        onSelect={() => setScope({ kind: 'all' })}
        align="center"
        leading={
          <span className="border-border flex size-8 shrink-0 items-center justify-center rounded-lg border">
            <Layers className="text-muted-foreground size-4" />
          </span>
        }
        trailing={cost(contacts.map((contact) => contact.id))}
      >
        <span className="block truncate text-row font-medium">All personas</span>
      </ListRow>

      {personas.length === 0 && contacts.length === 0 && (
        <EmptyState
          compact
          title="No spend yet"
          description="Usage appears here once a Contact takes its first turn."
        />
      )}

      {personas.length > 0 && heading('By persona')}

      {personas.map((persona) => {
        const contactIds = contacts
          .filter((contact) => contact.personaTemplateId === persona.id)
          .map((contact) => contact.id)
        const active = scope.kind === 'persona' && scope.id === persona.id
        return (
          <ListRow
            key={persona.id}
            active={active}
            onSelect={() => setScope({ kind: 'persona', id: persona.id })}
            align="center"
            leading={
              <AvatarColorSwatch
                name={persona.name}
                color={persona.avatarColor}
                seed={persona.id}
              />
            }
            trailing={cost(contactIds)}
          >
            <span className="block truncate text-row font-medium">{persona.name}</span>
            <span className="text-muted-foreground block text-xs">
              {contactIds.length} {contactIds.length === 1 ? 'contact' : 'contacts'}
            </span>
          </ListRow>
        )
      })}

      {repoPaths.length > 0 && heading('By repo')}

      {repoPaths.map((repoPath) => {
        const contactIds = contacts
          .filter((contact) => contact.repoPath === repoPath)
          .map((contact) => contact.id)
        const active = scope.kind === 'repo' && scope.repoPath === repoPath
        return (
          <ListRow
            key={repoPath}
            active={active}
            onSelect={() => setScope({ kind: 'repo', repoPath })}
            align="center"
            leading={
              <span className="border-border flex size-8 shrink-0 items-center justify-center rounded-lg border">
                <FolderGit2 className="text-muted-foreground size-4" />
              </span>
            }
            trailing={cost(contactIds)}
          >
            <span className="block truncate font-mono text-row font-medium">
              {repoName(repoPath)}
            </span>
            <span className="text-muted-foreground block text-xs">
              {contactIds.length} {contactIds.length === 1 ? 'contact' : 'contacts'}
            </span>
          </ListRow>
        )
      })}
    </div>
  )
}
