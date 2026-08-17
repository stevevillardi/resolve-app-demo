import { useEffect, useState } from 'react'
import { GitBranch, MessagesSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ListRow } from '@/components/common/ListRow'
import { PaneBody } from '@/components/common/PaneBody'
import { PaneHeader } from '@/components/common/PaneHeader'
import { RunPulse } from '@/components/common/RunIndicator'
import { Section } from '@/components/common/Section'
import { useBranches } from '@/hooks/useBranches'
import { useContacts } from '@/hooks/useConversations'
import { useActiveRuns, useCancelRun, useMessagePreviews } from '@/hooks/useMessages'
import { usePersonas } from '@/hooks/usePersonas'
import { useUsageEvents } from '@/hooks/useUsage'
import { formatElapsed, recentActivity, spendWindow } from '@/lib/home'
import { formatListTimestamp, repoName } from '@/lib/format'
import { formatCostSummary, formatTokens } from '@/lib/usage'
import { useUiStore } from '@/store/useUiStore'

const RECENT_LIMIT = 6
const SPEND_DAYS = 7

/**
 * Which of the two screens this is.
 *
 * `home` is the Home section: everything at rest, including spend. `chats` is
 * the Chats pane with nothing selected — the same live activity, minus the
 * money, because a section about conversations should not be where you find out
 * what the month cost. One component rather than two because the running-turn
 * and recent-activity blocks are identical, and two copies of them would drift
 * the way the four pane headers did before Phase 13.
 */
type Variant = 'home' | 'chats'

/**
 * The resting screen.
 *
 * This is the first thing seen on every launch — selection is deliberately not
 * persisted (`useUiStore`'s `partialize`), so the app always opens here, and it
 * used to be a single centred empty state in about a thousand by eight hundred
 * pixels of nothing. The data to fill it has existed since Phase 6 and every
 * query below is already being fetched by something else in the shell.
 *
 * Quiet on purpose. Each block renders only when it has something to say, so
 * the screen grows into a summary as the fleet is used rather than presenting
 * four empty headings on a fresh install. The Usage section owns charts; this
 * is a place to rest, not a dashboard.
 */
export function WorkspaceHome({ variant = 'home' }: { variant?: Variant } = {}): React.JSX.Element {
  const setDialog = useUiStore((state) => state.setDialog)
  const setSection = useUiStore((state) => state.setSection)
  const setSelected = useUiStore((state) => state.setSelectedConversation)
  const setSelectedBranch = useUiStore((state) => state.setSelectedBranch)

  const { data: contacts = [], isPending: contactsPending } = useContacts()
  const { data: personas = [] } = usePersonas()
  const { data: previews = [] } = useMessagePreviews()
  const { data: runs = [] } = useActiveRuns()
  const { data: events = [] } = useUsageEvents()
  // Only Home shows these, and the query stats the filesystem, so Chats does
  // not pay for a list it will not render.
  const { data: branches = [] } = useBranches()
  const { cancel } = useCancelRun()

  // Runs are timed, so this screen has to re-render on its own — nothing else
  // invalidates while a turn is simply continuing to run. Only ticks while
  // something is actually running.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (runs.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [runs.length])

  const recent = recentActivity(previews, contacts, personas, RECENT_LIMIT)
  const spend = spendWindow(events, now, SPEND_DAYS)
  const repoCount = new Set(contacts.map((contact) => contact.repoPath)).size
  // Only the ones with something in them. A branch with no diff against the
  // repo is not waiting on anybody.
  const waiting = variant === 'home' ? branches.filter((b) => b.files.length > 0) : []

  // A fresh install is a different screen, not an emptier version of this one:
  // there is nothing to summarise and exactly one thing to do.
  if (!contactsPending && contacts.length === 0) {
    return (
      <EmptyPane
        icon={MessagesSquare}
        title="No contacts yet"
        description="A contact is one persona bound to one repository. Make one and it can start work in it."
        action={
          <Button variant="outline" size="sm" onClick={() => setDialog('newContact')}>
            New contact
          </Button>
        }
      />
    )
  }

  const nothingToShow = runs.length === 0 && recent.length === 0 && spend.turns === 0
  if (nothingToShow) {
    return variant === 'chats' ? (
      <EmptyPane
        icon={MessagesSquare}
        title="No conversation selected"
        description="Pick a contact to message one persona, or a repo group to see everything working in that repository."
      />
    ) : (
      <EmptyPane
        icon={MessagesSquare}
        title="Nothing has run yet"
        // Contacts exist, so the fresh-install branch above did not fire. What
        // is missing is not setup, it is a first message.
        description="Your contacts are set up. Send one a message and this screen starts reporting what the fleet is doing."
        action={
          <Button variant="outline" size="sm" onClick={() => setSection('chats')}>
            Go to chats
          </Button>
        }
      />
    )
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <PaneHeader title={variant === 'chats' ? 'Chats' : 'Overview'} />
      <PaneBody measure="wide">
        {runs.length > 0 && (
          <Section
            title={runs.length === 1 ? '1 turn running' : `${runs.length} turns running`}
            description="What the fleet is doing right now."
          >
            <div className="flex flex-col gap-1.5">
              {runs.map((run) => (
                <div
                  key={run.runId}
                  className="border-border flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
                >
                  <RunPulse />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-row font-medium">{run.contactName}</span>
                    <span className="text-muted-foreground block truncate font-mono text-meta">
                      {repoName(run.workingPath)}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono text-meta tabular-nums">
                    {formatElapsed(run.startedAt, now)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Stop ${run.contactName}`}
                    onClick={() => cancel(run.runId)}
                  >
                    <Square className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {recent.length > 0 && (
          <Section title="Recent" description="The last thing said in each conversation.">
            {/* Two across once there is room. Six rows down the left of a
                1200px pane is the same wasted width this pass exists to fix. */}
            <div className="grid gap-x-4 @4xl/pane:grid-cols-2">
              {recent.map((item) => (
                <ListRow
                  key={item.contactId}
                  active={false}
                  onSelect={() => setSelected({ kind: 'contact', id: item.contactId })}
                  leading={
                    <AvatarColorSwatch name={item.name} color={item.color} seed={item.personaId} />
                  }
                  trailing={
                    <span className="text-muted-foreground shrink-0 font-mono text-micro tabular-nums">
                      {formatListTimestamp(item.timestamp, now)}
                    </span>
                  }
                >
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-row font-medium">{item.name}</span>
                    <span className="text-muted-foreground shrink-0 font-mono text-meta">
                      {item.repo}
                    </span>
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                    {/* Whose turn it was, because "the last thing said" is only
                        useful if you know whether it was you or the persona. */}
                    {item.role === 'user' && <span className="text-foreground/70">You: </span>}
                    {item.preview}
                  </span>
                </ListRow>
              ))}
            </div>
          </Section>
        )}

        {/*
          Work a persona finished that is now waiting on a human. Home only,
          and worth the extra query: a branch on disk with commits nobody has
          merged is the one thing in this app that quietly accumulates, and
          until now it was visible only if you thought to open the Branches
          section and look.
        */}
        {variant === 'home' && waiting.length > 0 && (
          <Section
            title={waiting.length === 1 ? '1 branch waiting' : `${waiting.length} branches waiting`}
            description="Finished work that has not been merged or discarded."
          >
            <div className="grid gap-1.5 @4xl/pane:grid-cols-2">
              {waiting.map((branch) => (
                <ListRow
                  key={`${branch.repoPath} ${branch.branch}`}
                  active={false}
                  align="center"
                  bordered
                  leading={<GitBranch className="text-muted-foreground size-4 shrink-0" />}
                  onSelect={() => {
                    setSelectedBranch({ repoPath: branch.repoPath, branch: branch.branch })
                    setSection('branches')
                  }}
                  trailing={
                    <span className="text-muted-foreground shrink-0 font-mono text-micro tabular-nums">
                      {branch.files.length} {branch.files.length === 1 ? 'file' : 'files'}
                    </span>
                  }
                >
                  <span className="block truncate font-mono text-meta">{branch.branch}</span>
                  {/* `contactName` is already "Persona · repo", so appending the
                      repo again prints it twice — the exact thing Phase 13 fixed
                      in BranchDetail's subtitle. Only added when it is missing. */}
                  <span className="text-muted-foreground block truncate text-xs">
                    {branch.contactName ?? `No contact · ${repoName(branch.repoPath)}`}
                  </span>
                </ListRow>
              ))}
            </div>
          </Section>
        )}

        {/* Home only. In Chats this is a section about money in a pane about
            conversations — the Usage section already owns it, and the point of
            splitting the two screens was to stop each one being everything. */}
        {variant === 'home' && spend.turns > 0 && (
          <Section title={`Last ${spend.days} days`}>
            <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
              <span>
                <span className="text-foreground font-mono tabular-nums">
                  {formatCostSummary(spend)}
                </span>{' '}
                spent
              </span>
              <span>
                <span className="text-foreground font-mono tabular-nums">
                  {formatTokens(spend.totalInputTokens + spend.totalOutputTokens)}
                </span>{' '}
                tokens
              </span>
              <span>
                <span className="text-foreground font-mono tabular-nums">{spend.turns}</span>{' '}
                {spend.turns === 1 ? 'turn' : 'turns'}
              </span>
              <span>
                <span className="text-foreground font-mono tabular-nums">{contacts.length}</span>{' '}
                {contacts.length === 1 ? 'contact' : 'contacts'} across{' '}
                <span className="text-foreground font-mono tabular-nums">{repoCount}</span>{' '}
                {repoCount === 1 ? 'repo' : 'repos'}
              </span>
            </div>
          </Section>
        )}
      </PaneBody>
    </div>
  )
}
