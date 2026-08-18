import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { blockingRun, lockModeFor, lockRefusal, workingPathFor } from '../../../../shared/locking'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { UsageBadge } from '@/components/usage/UsageBadge'
import { ContextMeter } from '@/components/usage/ContextMeter'
import { TurnCost } from '@/components/usage/TurnCost'
import { OpenPRButton } from '@/components/github/OpenPRButton'
import { ContactMenu } from './ContactMenu'
import { ThreadHeader } from './ThreadHeader'
import { DaySeparator } from './DaySeparator'
import { UnreadSeparator } from './UnreadSeparator'
import { SessionSeparator } from './SessionSeparator'
import { MessageBubble } from './MessageBubble'
import { ApprovalPrompt } from './ApprovalPrompt'
import { WorkChips } from './WorkChips'
import { WorkDiffDialog } from './WorkDiffDialog'
import { Composer } from './Composer'
import { useContacts, useContactContext } from '@/hooks/useConversations'
import { useContactFiles } from '@/hooks/useContactFiles'
import { usePersonas } from '@/hooks/usePersonas'
import {
  useActiveRuns,
  useAgentStream,
  useCancelRun,
  useMessages,
  useRetryTurn,
  useSendMessage,
  useToolCalls
} from '@/hooks/useMessages'
import { useMarkRead } from '@/hooks/useUnread'
import { useUsageEvents } from '@/hooks/useUsage'
import { useOpenPullRequest, usePullRequestState } from '@/hooks/usePullRequests'
import { useRunStore } from '@/store/useRunStore'
import { draftKey, useDraftStore } from '@/store/useDraftStore'
import { streamText } from '@/lib/stream'
import { slashCommands } from '@/lib/slash'
import { hasUnansweredTail } from '@/lib/turn-tail'
import { firstUnreadIndex } from '@/lib/unread'
import { awaitingFreshSession, sessionBoundaries } from '@/lib/session'
import { contextTokens, usageByMessage, usageForContact } from '@/lib/usage'
import { isSameDay, repoName } from '@/lib/format'

interface ThreadViewProps {
  contactId: string
}

export function ThreadView({ contactId }: ThreadViewProps): React.JSX.Element {
  const { data: contacts = [] } = useContacts()
  const { data: personas = [] } = usePersonas()
  const { data: thread = [] } = useMessages(contactId)
  const { data: persistedToolCalls = [] } = useToolCalls(contactId)
  const { data: usageEvents = [] } = useUsageEvents(contactId)
  const { data: runs = [] } = useActiveRuns()

  const contact = contacts.find((candidate) => candidate.id === contactId)
  const persona = personas.find((candidate) => candidate.id === contact?.personaTemplateId)

  const turn = useRunStore((state) => state.byContact[contactId])
  useAgentStream(contactId)

  const { send, error: sendError, reset } = useSendMessage(contactId)
  const { retry, error: retryError, reset: resetRetry } = useRetryTurn()
  const { cancel } = useCancelRun()

  // Only fetched once somebody types a slash. contacts.context stats the
  // filesystem for sibling branches, and a thread being open is no reason to
  // pay for that — the same gating the context panel uses.
  const draftId = draftKey('contact', contactId)
  const draft = useDraftStore((state) => state.byConversation[draftId] ?? '')
  const setDraft = useDraftStore((state) => state.setDraft)
  const clearDraft = useDraftStore((state) => state.clearDraft)
  const [workMessageId, setWorkMessageId] = useState<string | null>(null)
  const { data: capability } = useContactContext(contactId, draft.startsWith('/'))
  const commands = useMemo(() => slashCommands(capability), [capability])
  // Same lazy gate for @file: no git until an @ exists to complete.
  const files = useContactFiles(contactId, draft.includes('@'))

  const { data: prState } = usePullRequestState(contactId)
  const { open: openPr, isPending: opening, error: prError, reset: resetPr } = useOpenPullRequest()

  const usage = useMemo(() => usageForContact(usageEvents, contactId), [usageEvents, contactId])

  // Which usage row paid for which reply (§G6), from the same array. Built once
  // rather than scanned per message: a long thread renders hundreds of bubbles.
  const turnCosts = useMemo(() => usageByMessage(usageEvents), [usageEvents])

  // The session's own figures, from rows this view already has — no new query.
  // Read off `contact.backendSessionId` rather than contacts.context, which
  // stats the filesystem and is deliberately only fetched on demand.
  const context = useMemo(
    () =>
      contextTokens(usageEvents, contact?.backendSessionId ?? null, persona?.backend ?? 'claude'),
    [usageEvents, contact?.backendSessionId, persona?.backend]
  )

  // What main would say if this send were made right now, decided by the rule
  // main itself uses (src/shared/locking.ts) rather than by a second reading of
  // it. Both of this contact's own facts matter: a `read_only` persona is
  // refused by nobody, and an isolated one is locked on its worktree rather
  // than on the repo — the composer used to ignore both.
  const blocker =
    contact && persona
      ? blockingRun(
          runs.filter((run) => run.contactId !== contactId),
          workingPathFor(contact),
          lockModeFor(persona, contact.isolation)
        )
      : null

  // This contact's held write, if its turn is paused on one (Phase 24). Off
  // the runs query rather than the stream store, so it shows for a routine's
  // turn too and survives a reload — see ApprovalPrompt.
  const approvalRun = runs.find((run) => run.contactId === contactId && run.approval)

  const contentRef = useRef<HTMLDivElement>(null)
  const streamed = turn ? streamText(turn.stream) : ''

  // The divider is placed against the boundary as it was when this thread
  // opened, captured once per contactId — the mark-read effect below moves
  // the live value forward immediately, and a divider computed against that
  // would vanish in the frame it appeared. Captured with the render-time
  // adjust-state pattern rather than an effect, so the first paint already
  // has it.
  const [boundary, setBoundary] = useState<{ id: string; at: number | null } | null>(null)
  if (contact && boundary?.id !== contactId) {
    setBoundary({ id: contactId, at: contact.lastReadAt })
  }
  const unreadIndex = firstUnreadIndex(thread, boundary?.id === contactId ? boundary.at : null)

  // Where the backend session changed under the conversation. Unlike the unread
  // boundary this needs no captured-at-open value: it is a property of the rows
  // themselves, so it cannot move while the thread is on screen.
  const boundaries = useMemo(() => sessionBoundaries(thread), [thread])

  // Read on open, and on arrival while open. Both views force-scroll to the
  // bottom, so on-screen ≡ read; there is no scroll tracking to say otherwise.
  // Keyed on the last row's timestamp rather than the array, so a refetch
  // that changes nothing re-marks nothing.
  const { markContactRead } = useMarkRead()
  const lastMessageAt = thread.length > 0 ? thread[thread.length - 1].timestamp : null
  const contactLoaded = contact !== undefined
  useEffect(() => {
    if (!contactLoaded) return
    markContactRead(contactId)
  }, [contactId, contactLoaded, lastMessageAt, markContactRead])

  // Follow the reply as it arrives. Keyed on the streamed text rather than just
  // the message count, so it also tracks a bubble growing in place.
  //
  // Anchored on the content and walked up to the viewport: ScrollArea is a Base
  // UI Root whose props type doesn't promise to carry a ref through to the
  // scrolling element, and the viewport is the thing that actually scrolls.
  useEffect(() => {
    const viewport = contentRef.current?.closest('[data-slot="scroll-area-viewport"]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [thread.length, streamed, approvalRun?.approval?.id])

  if (!contact || !persona) {
    return <EmptyState icon={MessageSquare} title="Conversation not found" />
  }

  const isRunning = Boolean(turn && !turn.stream.finished)

  const doRetry = (): void => {
    resetRetry()
    retry(contactId)
  }

  // The durable half of the retry surface: after a reload or a crash the
  // stream error is gone, and the only evidence left is a user message with
  // no reply. `turn` covers the synchronous window after a send; the runs
  // query covers a renderer reload while main is still mid-turn.
  const interrupted = hasUnansweredTail(
    thread,
    Boolean(turn) || runs.some((run) => run.contactId === contactId)
  )

  return (
    // `@container/pane` declared here rather than inherited: this view does not
    // use PaneBody, which is where every other pane gets it, so a `@…/pane:`
    // class in the header would silently never fire. That is the same defect
    // Phase 16 found across the whole renderer — a responsive class measuring a
    // container nobody declared.
    <div className="@container/pane bg-background flex h-full min-h-0 flex-col">
      {/*
        The repo's name, not its path. The full path is often 60+ characters —
        a macOS temp checkout is over 80 — and it was taking the entire header
        while telling you nothing the last segment doesn't. The whole path is
        still one hover away, which is the right ratio for something you need
        about once a session.
      */}
      <ThreadHeader
        leading={
          <AvatarColorSwatch
            name={persona.name}
            color={persona.avatarColor}
            seed={persona.id}
            size="sm"
          />
        }
        title={persona.name}
        subtitle={repoName(contact.repoPath)}
        subtitleTitle={contact.repoPath}
        actions={
          <>
            <BackendBadge backend={persona.backend} />
            {/*
              Beside the spend, and deliberately: one answers what this has
              cost, the other how much room is left, and the second is the one
              that changes what you do next.
            */}
            <ContextMeter tokens={context} />
            <UsageBadge summary={usage} />
            <OpenPRButton
              githubScope={persona.githubScope}
              available={prState?.available ?? false}
              pr={prState?.pr ?? null}
              isPending={opening}
              onOpen={() => {
                resetPr()
                openPr(contactId)
              }}
            />
            <ContactMenu contact={contact} backend={persona.backend} />
          </>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        {/*
          `min-h-full justify-end`, so a short conversation sits just above the
          composer instead of pinned to the top with several hundred pixels of
          nothing between the last message and the field you reply in. Once the
          thread outgrows the viewport this does nothing — justify-end only has
          room to act while the content underflows.

          It can go straight on the content element because Base UI's Viewport
          renders its children directly, with no wrapper of its own.
        */}
        <div
          ref={contentRef}
          className="mx-auto flex min-h-full max-w-4xl flex-col justify-end gap-3 px-4 py-4"
        >
          {thread.length === 0 && !turn ? (
            <EmptyState
              icon={MessageSquare}
              title="No messages yet"
              description={`Ask ${persona.name} something about ${contact.repoPath}.`}
            />
          ) : (
            thread.map((message, index) => {
              const previous = thread[index - 1]
              const newDay = !previous || !isSameDay(previous.timestamp, message.timestamp)
              // The turn's persisted tool record, mapped onto the live
              // timeline's shape. A call still 'running' in history is a turn
              // that died mid-call — shown failed and named interrupted,
              // because pretending it finished would be worse than either.
              const calls = persistedToolCalls
                .filter((call) => call.messageId === message.id)
                .map((call) => ({
                  id: call.id,
                  name: call.name,
                  detail: call.status === 'running' ? 'interrupted' : (call.detail ?? ''),
                  ...(call.output ? { output: call.output } : {}),
                  status: (call.status === 'running' ? 'failed' : call.status) as
                    'completed' | 'failed'
                }))
              return (
                <Fragment key={message.id}>
                  {newDay && <DaySeparator timestamp={message.timestamp} />}
                  {/*
                    Above the unread line when both land on one row: the session
                    boundary is the older fact, and the two read in that order.
                  */}
                  {boundaries.has(index) && <SessionSeparator />}
                  {index === unreadIndex && <UnreadSeparator />}
                  <MessageBubble
                    role={message.role}
                    content={message.content}
                    timestamp={message.timestamp}
                    backend={persona.backend}
                    {...(calls.length > 0 ? { toolCalls: calls } : {})}
                  />
                  {message.role === 'assistant' && message.work && (
                    <WorkChips work={message.work} onOpen={() => setWorkMessageId(message.id)} />
                  )}
                  {/*
                    What this turn cost, under the reply it bought (§G6). Read
                    from the usage events this view already holds, so no new
                    query — only migration 0020's link. Absent rather than zero
                    when there is no row: a turn from before the column existed
                    has an unknown cost, not a free one.
                  */}
                  {message.role === 'assistant' && turnCosts.get(message.id) && (
                    <TurnCost event={turnCosts.get(message.id)!} />
                  )}
                </Fragment>
              )
            })
          )}

          {/*
            The live bubble. It shows while a turn runs and disappears once the
            identical row has been refetched — useAgentStream clears the store
            only after invalidation resolves, so the text never blinks out and
            back in.
          */}
          {turn && !turn.stream.error && (
            <MessageBubble
              role="assistant"
              content={streamed}
              status="streaming"
              backend={persona.backend}
              activity={turn.stream.activity}
              reasoning={turn.stream.reasoning}
              toolCalls={turn.stream.toolCalls}
            />
          )}

          {turn?.stream.error && (
            <MessageBubble
              role="assistant"
              content={streamed}
              status="error"
              error={turn.stream.error}
              backend={persona.backend}
              onRetry={doRetry}
            />
          )}

          {/* Below the live bubble: the ask is the turn's newest utterance,
              and the thread reads downward. */}
          {approvalRun?.approval && (
            <ApprovalPrompt runId={approvalRun.runId} approval={approvalRun.approval} />
          )}

          {/* The same notice, degraded to what survives a reload: no error
              kind, no partial text — just the shape of the thread saying a
              question never got its answer. */}
          {interrupted && (
            <MessageBubble
              role="assistant"
              content=""
              status="error"
              error={{ kind: 'unknown', message: 'This turn was interrupted before it finished.' }}
              backend={persona.backend}
              onRetry={doRetry}
            />
          )}

          {/*
            The same line before the fact. A cleared resume key IS the durable
            trace of a fresh session, so this appears the moment it is asked for
            rather than only after a turn has been paid for to prove it — and it
            sits at the tail, which is exactly where the boundary will be drawn.
          */}
          {awaitingFreshSession(contact.backendSessionId, thread.length) && (
            <SessionSeparator pending />
          )}
        </div>
      </ScrollArea>

      <WorkDiffDialog
        contactId={contactId}
        messageId={workMessageId}
        onClose={() => setWorkMessageId(null)}
      />

      <Composer
        placeholder={`Message ${persona.name}…`}
        value={draft}
        onValueChange={(value) => setDraft(draftId, value)}
        commands={commands}
        files={files}
        onSend={(value) => {
          reset()
          // Cleared only on acceptance: a lock refusal rejects the mutation,
          // and the refused draft must still be sitting in the field.
          send(value, { onSuccess: () => clearDraft(draftId) })
        }}
        busy={isRunning}
        onStop={() => turn && cancel(turn.runId)}
        disabled={Boolean(blocker)}
        notice={
          // A pull-request refusal belongs here rather than beside the button:
          // the messages name what to do next ("commit or discard them first"),
          // and the header has no room to say it.
          sendError ??
          retryError ??
          prError ??
          (blocker ? lockRefusal(blocker.contactName) : undefined)
        }
        hint={
          // Scope lives beside the send button rather than buried in the
          // header: what this persona is allowed to do is exactly what you
          // want to know at the moment you hand it work.
          <>
            <span>Runs as</span>
            <AvatarColorSwatch
              name={persona.name}
              color={persona.avatarColor}
              seed={persona.id}
              size="xs"
            />
            <span className="text-foreground font-medium">{persona.name}</span>
            <ScopeChip axis="sandbox" value={persona.sandbox} />
            <ScopeChip axis="github" value={persona.githubScope} />
          </>
        }
      />
    </div>
  )
}
