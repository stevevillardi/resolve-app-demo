import { useMemo } from 'react'
import { FolderGit2, Layers } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useUsageSummaries } from '@/hooks/useUsage'
import { repoName } from '@/lib/format'
import { matchesQuery } from '@/lib/list-filter'
import { byContactId, formatCostSummary, summariesFor } from '@/lib/usage'
import { useUiStore } from '@/store/useUiStore'
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { EMPTY_LIST_FILTER } from '@/lib/list-filter'
import { FACET_PERSONA, FACET_REPO } from '@/lib/section-facets'
import { MessagesSquare } from 'lucide-react'

/**
 * Master list for the usage section: all spend, one persona's, or one repo's.
 *
 * Persona and repo are the two axes spend is reported along, and a Contact sits
 * at the intersection of them — so scoping lives here and the dashboard is left
 * to the range, source and metric controls.
 */
/**
 * §A4: the rail that had the longest list and no way to narrow it.
 *
 * `ListPanel` gave every other section a search box and gave this one nothing,
 * which is backwards — it is the only rail whose length grows on *both* axes at
 * once, one row per persona plus one per repository. No facets: the dashboard
 * beside it already owns range, measure and source, and a second set of
 * controls for the same screen would only raise the question of which wins.
 */
export function UsageScopeList({ query }: { query: string }): React.JSX.Element {
  const showIn = useUiStore((state) => state.showIn)

  /**
   * "Show me the conversations behind this number" (§C).
   *
   * The usage rail names a persona or a repository and says what it cost; until
   * now that was where the trail ended. A right-click rather than a click,
   * because the left-click already means something here — it scopes the
   * dashboard, which is what people come to this screen for.
   */
  const showConversations = (facetId: string, value: string): void =>
    showIn('chats', { ...EMPTY_LIST_FILTER, facets: { [facetId]: [value] } })

  const scope = useUiStore((state) => state.usageScope)
  const setScope = useUiStore((state) => state.setUsageScope)

  const { data: summaries = [] } = useUsageSummaries()
  const { data: contacts = [], isPending } = useContacts()
  const { data: personas = [] } = usePersonas()

  // Every repo any Contact is bound to, whether or not it has spent anything —
  // a repo that has cost nothing yet is still a place work happens, and hiding
  // it until it bills would make the list flicker into existence mid-demo.
  const repoPaths = useMemo(
    () =>
      [...new Set(contacts.map((contact) => contact.repoPath))]
        .sort()
        .filter((path) => matchesQuery({ label: repoName(path), detail: path }, query)),
    [contacts, query]
  )

  // The full path is searchable as well as the name shown, so two checkouts
  // both called `api` can be told apart by typing what is above them.
  const visiblePersonas = useMemo(
    () => personas.filter((persona) => matchesQuery({ label: persona.name }, query)),
    [personas, query]
  )

  /**
   * Spend per scope, from the SQL rollup (Phase 25 §B1).
   *
   * `costFor` is called once per row and used to scan the entire `usage_events`
   * table each time, unmemoized — so a profile with twenty personas and twenty
   * repos rescanned every turn ever recorded forty times per render. Indexing
   * the rollup once and composing from it makes the row cost proportional to the
   * contacts in that scope instead.
   *
   * A scope nobody has spent in yields undefined, and `formatCostSummary` is
   * never asked about it — the row shows the em dash the empty summary would
   * have produced anyway, but by saying "no turns" rather than "zero dollars".
   */
  const summaryIndex = useMemo(() => byContactId(summaries), [summaries])

  const costFor = (contactIds: string[]): string => {
    const summary = summariesFor(summaryIndex, contactIds)
    return summary ? formatCostSummary(summary) : '—'
  }

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

      {visiblePersonas.length === 0 && repoPaths.length === 0 && (
        <EmptyState
          compact
          title={query.trim() ? 'Nothing matches' : 'No spend yet'}
          description={
            query.trim()
              ? `No persona or repo matching “${query.trim()}”.`
              : "Usage appears here after a contact's first reply."
          }
        />
      )}

      {visiblePersonas.length > 0 && heading('By persona')}

      {visiblePersonas.map((persona) => {
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
            contextMenu={
              <ContextMenuContent>
                <ContextMenuItem onClick={() => showConversations(FACET_PERSONA, persona.id)}>
                  <MessagesSquare />
                  Show its conversations
                </ContextMenuItem>
              </ContextMenuContent>
            }
            leading={
              <AvatarColorSwatch
                name={persona.name}
                color={persona.avatarColor}
                seed={persona.avatarSeed}
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
            contextMenu={
              <ContextMenuContent>
                <ContextMenuItem onClick={() => showConversations(FACET_REPO, repoPath)}>
                  <MessagesSquare />
                  Show its conversations
                </ContextMenuItem>
              </ContextMenuContent>
            }
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
