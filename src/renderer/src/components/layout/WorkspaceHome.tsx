import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  GitBranch,
  Loader2,
  MessagesSquare
} from 'lucide-react'
import { Bar, BarChart } from 'recharts'
import { Button } from '@/components/ui/button'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ListRow } from '@/components/common/ListRow'
import { PaneBody } from '@/components/common/PaneBody'
import { PaneHeader } from '@/components/common/PaneHeader'
import { RunRow } from '@/components/common/RunRow'
import { Section } from '@/components/common/Section'
import { GuideStrip, WorkspaceGuide } from './WorkspaceGuide'
import { useAuthStatus, useRefreshAuth } from '@/hooks/useAuth'
import { useBudget } from '@/hooks/useSettings'
import { useBranches } from '@/hooks/useBranches'
import { useContacts } from '@/hooks/useConversations'
import { useActiveRuns, useCancelRun, useMessagePreviews } from '@/hooks/useMessages'
import { usePersonas } from '@/hooks/usePersonas'
import { useNextRuns, useRoutines } from '@/hooks/useRoutines'
import { useUsageEvents } from '@/hooks/useUsage'
import {
  authBannerFor,
  budgetBannerFor,
  dailySpend,
  formatUpcoming,
  missedRuns,
  recentActivity,
  spendWindow,
  upcomingRuns
} from '@/lib/home'
import { formatListTimestamp, repoName } from '@/lib/format'
import { formatCostSummary, formatTokens } from '@/lib/usage'
import { useUiStore } from '@/store/useUiStore'

const RECENT_LIMIT = 6
const SPEND_DAYS = 7
const UPCOMING_LIMIT = 3

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
  const setSelectedRoutineId = useUiStore((state) => state.setSelectedRoutineId)

  const { data: contacts = [], isPending: contactsPending } = useContacts()
  const { data: personas = [] } = usePersonas()
  const { data: previews = [] } = useMessagePreviews()
  const { data: runs = [] } = useActiveRuns()
  const { data: events = [] } = useUsageEvents()
  // Only Home shows these, and the query stats the filesystem, so Chats does
  // not pay for a list it will not render.
  const { data: branches = [] } = useBranches()
  const { data: nextRunRows = [] } = useNextRuns()
  const { data: routines = [] } = useRoutines()
  const { data: authStatus } = useAuthStatus()
  const { monthlyBudgetUsd } = useBudget()
  const { refresh: refreshAuth, isPending: refreshingAuth } = useRefreshAuth()
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
  const spendByDay = dailySpend(events, now, SPEND_DAYS)
  const upcoming = variant === 'home' ? upcomingRuns(nextRunRows, UPCOMING_LIMIT) : []
  const missed = variant === 'home' ? missedRuns(routines, contacts, UPCOMING_LIMIT) : []
  const banner = variant === 'home' ? authBannerFor(authStatus) : null
  const budgetBanner =
    variant === 'home' ? budgetBannerFor(events, monthlyBudgetUsd, routines, now) : null
  const repoCount = new Set(contacts.map((contact) => contact.repoPath)).size
  // Only the ones with something in them, and not yet landed. A merged branch
  // is finished work, not waiting work — counting it kept the banner up
  // forever (Phase 19). A branch with no diff against the
  // repo is not waiting on anybody.
  const waiting = variant === 'home' ? branches.filter((b) => b.files.length > 0 && !b.merged) : []

  // A fresh install is a different screen, not an emptier version of this one:
  // there is nothing to summarise, and what the person on the other side needs
  // is not a report but the app explained. Both variants get it — with no
  // contacts there is nothing for Chats to offer either, and a first launch
  // clicking into Chats should not be answered with a shorter apology.
  if (!contactsPending && contacts.length === 0) {
    return <WorkspaceGuide />
  }

  // Missed fires and a crossed budget both keep the summary on screen even
  // when the week was otherwise quiet: a month of silent 9:00 misses, or a
  // quiet week after a spendy month-start, is exactly when the empty state
  // would swallow the one thing worth saying.
  const nothingToShow =
    runs.length === 0 &&
    recent.length === 0 &&
    spend.turns === 0 &&
    missed.length === 0 &&
    budgetBanner === null
  if (nothingToShow) {
    // Chats keeps its one sentence. There is a list panel beside it holding the
    // contacts that exist, so the answer to "why is this pane blank" is two
    // inches to the left — and the point of splitting these two screens was to
    // stop each of them being everything.
    return variant === 'chats' ? (
      <EmptyPane
        icon={MessagesSquare}
        title="No conversation selected"
        description="Pick a contact to message one persona, or a repo group to see everything working in that repository."
      />
    ) : (
      // Contacts exist, so the fresh-install branch above did not fire — but
      // Home has no list panel and nothing to report, so it is still a blank
      // pane, and the guide is still the most useful thing to put in it. The
      // checklist reads the same live state, so the first step arrives ticked.
      <WorkspaceGuide />
    )
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      {/* Home is the one pane that abuts the nav rail, so its title is kept for
          assistive tech but taken off the strip: at this pane's left padding it
          would sit 9px from the green traffic light. Chats has a list panel in
          between and is nowhere near them, so it keeps its visible title. */}
      <PaneHeader
        title={variant === 'chats' ? 'Chats' : 'Overview'}
        titleHidden={variant === 'home'}
      />
      <PaneBody measure="wide">
        {/* Degraded auth, on the screen the app opens to — the sidebar dot
            already knows, but a dot is not a sentence. Rejected GitHub tokens
            offer the reconnect dialog; a backend probe failure offers the same
            re-check the onboarding cards carry. */}
        {banner && (
          <div className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3">
            <AlertTriangle className="text-destructive size-4 shrink-0" />
            <p className="min-w-0 flex-1 text-sm text-pretty">{banner.message}</p>
            {banner.kind === 'github' ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('github')}>
                Reconnect…
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={refreshAuth} disabled={refreshingAuth}>
                {refreshingAuth && (
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                )}
                Check again
              </Button>
            )}
          </div>
        )}

        {/* The month-to-date crossing, in the warning register — deliberately
            not destructive: nothing failed and nothing was stopped, which the
            copy also says. One banner, worst overage, computed by the same
            priced-floor rules as the toast so the two cannot disagree. */}
        {budgetBanner && (
          <div className="border-scope-elevated/40 bg-scope-elevated-bg/30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3">
            <AlertTriangle className="text-scope-elevated size-4 shrink-0" />
            <p className="min-w-0 flex-1 text-sm text-pretty">{budgetBanner.message}</p>
            <Button variant="outline" size="sm" onClick={() => setSection('usage')}>
              See usage
            </Button>
          </div>
        )}

        {runs.length > 0 && (
          <Section
            title={runs.length === 1 ? '1 turn running' : `${runs.length} turns running`}
            description="What the fleet is doing right now."
          >
            <div className="flex flex-col gap-1.5">
              {runs.map((run) => (
                <RunRow key={run.runId} run={run} now={now} onStop={cancel} />
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
                  key={`${branch.repoPath}\0${branch.branch}`}
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

        {/*
          Fires that silently never happened (review §C2). Above Scheduled
          because outstanding beats upcoming, and in the warning register
          rather than the destructive one — nothing failed, something didn't
          run. Clicking lands in the editor, where Run now is the catch-up.
        */}
        {variant === 'home' && missed.length > 0 && (
          <Section
            title={missed.length === 1 ? '1 routine missed its schedule' : 'Missed schedules'}
            description="Fires skipped while the app was closed or the machine slept. Run now catches up."
          >
            <div className="grid gap-1.5 @4xl/pane:grid-cols-3">
              {missed.map((run) => (
                <ListRow
                  key={run.routineId}
                  active={false}
                  align="center"
                  bordered
                  leading={<CalendarClock className="text-scope-elevated size-4 shrink-0" />}
                  onSelect={() => {
                    setSelectedRoutineId(run.routineId)
                    setSection('routines')
                  }}
                  trailing={
                    <span className="text-scope-elevated shrink-0 font-mono text-micro tabular-nums">
                      ×{run.count}
                    </span>
                  }
                >
                  <span className="block truncate text-row">{run.prompt}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {run.contactName ? `${run.contactName} · ` : ''}
                    last missed {formatListTimestamp(run.lastMissedAt, now)}
                  </span>
                </ListRow>
              ))}
            </div>
          </Section>
        )}

        {/*
          What fires next, without opening Routines. The tray answers this for
          someone glancing at the menu bar; Home answers it for someone sitting
          in the app. Same data, same absolute-time rule.
        */}
        {variant === 'home' && upcoming.length > 0 && (
          <Section title="Scheduled" description="The next unattended work.">
            <div className="grid gap-1.5 @4xl/pane:grid-cols-3">
              {upcoming.map((run) => (
                <ListRow
                  key={run.routineId}
                  active={false}
                  align="center"
                  bordered
                  leading={<CalendarClock className="text-muted-foreground size-4 shrink-0" />}
                  onSelect={() => {
                    setSelectedRoutineId(run.routineId)
                    setSection('routines')
                  }}
                >
                  <span className="block truncate text-row">{run.prompt}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {run.contactName ? `${run.contactName} · ` : ''}
                    {formatUpcoming(run.nextRun, now)}
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
            {/* A shape, not a chart: no axes, no legend, no tooltip config —
                the Usage section owns real charts. Seven bars answer "was this
                week's spend flat or spiky" at a glance, which a total cannot. */}
            <ChartContainer
              config={{ cost: { label: 'Spend', color: 'var(--chart-1)' } }}
              className="mb-2 aspect-auto h-12 w-full max-w-md"
            >
              <BarChart data={spendByDay} margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                {/* The one interaction the sparkline supports: which day was
                    that spike. Label comes from the bucket, value formatted as
                    money — the same formatter the summary line uses. */}
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_label, payload) =>
                        new Date(
                          (payload?.[0]?.payload as { day?: number })?.day ?? 0
                        ).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric'
                        })
                      }
                      formatter={(value) => `$${Number(value).toFixed(2)}`}
                      indicator="dot"
                    />
                  }
                />
                <Bar dataKey="cost" fill="var(--color-cost)" radius={2} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
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
                {repoCount === 1 ? 'repo' : 'repos'}, running{' '}
                <span className="text-foreground font-mono tabular-nums">{personas.length}</span>{' '}
                {personas.length === 1 ? 'persona' : 'personas'}
              </span>
            </div>
          </Section>
        )}

        {/*
          Last, and Home only. The summary above is why you are on this screen;
          the guide is the reference you want on week one and not on week five,
          so it sits under everything and remembers having been folded away.
          Chats does not get it — see the empty branch above.
        */}
        {variant === 'home' && <GuideStrip />}
      </PaneBody>
    </div>
  )
}
