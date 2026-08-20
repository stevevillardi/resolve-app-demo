import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { PaneBody } from '@/components/common/PaneBody'
import { PaneHeader } from '@/components/common/PaneHeader'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { useContacts } from '@/hooks/useConversations'
import { useAuditEvents } from '@/hooks/useAudit'
import { formatRelative, repoName } from '@/lib/format'
import { ACTION_LABELS, actorLabel, auditScopeFilter, filterAuditEvents } from '@/lib/audit-report'
import { useUiStore } from '@/store/useUiStore'
import type { AuditActorKind } from '@/types'

/**
 * Repo/contact governance history: a filterable, append-only feed
 * over `audit_events`. Deliberately a table and nothing else — this is a log
 * to scan and correlate against a timestamp, not a metric to chart, so it
 * skips UsageDashboard's chart/breakdown machinery entirely.
 */

const ACTOR_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'user', label: 'You' },
  { value: 'routine', label: 'Routines' },
  { value: 'system', label: 'System' }
] as const
type ActorFilter = (typeof ACTOR_FILTERS)[number]['value']

export function ActivityDashboard(): React.JSX.Element {
  const scope = useUiStore((state) => state.auditScope)
  const [actorFilter, setActorFilter] = useState<ActorFilter>('all')

  const { data: events = [], isPending } = useAuditEvents()
  const { data: contacts = [] } = useContacts()

  const contactName = useMemo(() => {
    const byId = new Map(contacts.map((contact) => [contact.id, contact.displayName]))
    return (contactId: string | null): string | null =>
      contactId ? (byId.get(contactId) ?? null) : null
  }, [contacts])

  const shown = useMemo(() => {
    const inScope = events.filter(auditScopeFilter(scope))
    return filterAuditEvents(inScope, {
      ...(actorFilter !== 'all' && { actorKinds: [actorFilter as AuditActorKind] })
    })
  }, [events, scope, actorFilter])

  const scopeName =
    scope.kind === 'all'
      ? 'All activity'
      : scope.kind === 'repo'
        ? repoName(scope.repoPath)
        : (contactName(scope.id) ?? 'Contact')

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <PaneHeader
        title={scopeName}
        actions={
          <SegmentedControl
            options={ACTOR_FILTERS}
            value={actorFilter}
            onChange={setActorFilter}
            aria-label="Filter by actor"
          />
        }
      />

      <PaneBody measure="wide">
        {isPending && events.length === 0 ? (
          <EmptyState loading title="Reading activity" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={History}
            title="No activity matches these filters"
            description="Widen the actor filter, or pick a different scope."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-xs">
                  <th className="pb-1.5 pr-3 font-medium">When</th>
                  <th className="pb-1.5 pr-3 font-medium">Action</th>
                  <th className="pb-1.5 pr-3 font-medium">Actor</th>
                  <th className="pb-1.5 pr-3 font-medium">Repo</th>
                  <th className="pb-1.5 pr-3 font-medium">Contact</th>
                  <th className="pb-1.5 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((event) => (
                  <tr key={event.id} className="border-border/70 border-b last:border-0">
                    <td
                      className="py-2 pr-3 whitespace-nowrap text-meta text-muted-foreground"
                      title={new Date(event.createdAt).toLocaleString()}
                    >
                      {formatRelative(event.createdAt)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{ACTION_LABELS[event.action]}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {actorLabel(event)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap font-mono text-meta">
                      {repoName(event.repoPath)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {contactName(event.contactId) ?? '—'}
                    </td>
                    <td className="py-2 text-muted-foreground">{event.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PaneBody>
    </div>
  )
}
