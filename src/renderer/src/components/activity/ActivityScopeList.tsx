import { useMemo } from 'react'
import { FolderGit2, History, User } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { useContacts } from '@/hooks/useConversations'
import { useAuditEvents } from '@/hooks/useAudit'
import { repoName } from '@/lib/format'
import { useUiStore } from '@/store/useUiStore'
import type { AuditEvent } from '@/types'

/**
 * Master list for the Activity section: all governance events, one repo's, or
 * one contact's. Mirrors UsageScopeList's shape, with repo and contact as the
 * two axes — the ones the audit trail itself is about — rather than persona
 * and repo.
 */
export function ActivityScopeList(): React.JSX.Element {
  const scope = useUiStore((state) => state.auditScope)
  const setScope = useUiStore((state) => state.setAuditScope)

  const { data: events = [], isPending: eventsPending } = useAuditEvents()
  const { data: contacts = [], isPending: contactsPending } = useContacts()

  // Every repo a Contact is bound to, plus every repo an event still names —
  // a repo whose last Contact was deleted must not fall out of the sidebar,
  // since its history is exactly what a governance trail exists to keep.
  const repoPaths = useMemo(
    () =>
      [...new Set([...contacts.map((c) => c.repoPath), ...events.map((e) => e.repoPath)])].sort(),
    [contacts, events]
  )

  const countFor = (predicate: (event: AuditEvent) => boolean): number =>
    events.filter(predicate).length

  const count = (n: number): React.JSX.Element => (
    <span className="text-muted-foreground shrink-0 font-mono text-meta tabular-nums">{n}</span>
  )

  const heading = (text: string): React.JSX.Element => (
    <p className="text-muted-foreground px-2 pt-3 pb-1 text-meta font-medium tracking-wide uppercase">
      {text}
    </p>
  )

  if (eventsPending || contactsPending)
    return <EmptyState compact loading title="Loading activity…" />

  return (
    <div className="flex flex-col">
      <ListRow
        active={scope.kind === 'all'}
        onSelect={() => setScope({ kind: 'all' })}
        align="center"
        leading={
          <span className="border-border flex size-8 shrink-0 items-center justify-center rounded-lg border">
            <History className="text-muted-foreground size-4" />
          </span>
        }
        trailing={count(events.length)}
      >
        <span className="block truncate text-row font-medium">All activity</span>
      </ListRow>

      {events.length === 0 && (
        <EmptyState
          compact
          title="No activity yet"
          description="Governance actions — repo trust, contact changes, merges — appear here as they happen."
        />
      )}

      {repoPaths.length > 0 && heading('By repo')}

      {repoPaths.map((repoPath) => {
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
            trailing={count(countFor((event) => event.repoPath === repoPath))}
          >
            <span className="block truncate font-mono text-row font-medium">
              {repoName(repoPath)}
            </span>
          </ListRow>
        )
      })}

      {contacts.length > 0 && heading('By contact')}

      {contacts.map((contact) => {
        const active = scope.kind === 'contact' && scope.id === contact.id
        return (
          <ListRow
            key={contact.id}
            active={active}
            onSelect={() => setScope({ kind: 'contact', id: contact.id })}
            align="center"
            leading={
              <span className="border-border flex size-8 shrink-0 items-center justify-center rounded-lg border">
                <User className="text-muted-foreground size-4" />
              </span>
            }
            trailing={count(countFor((event) => event.contactId === contact.id))}
          >
            <span className="block truncate text-row font-medium">{contact.displayName}</span>
          </ListRow>
        )
      })}
    </div>
  )
}
