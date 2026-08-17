import { Fragment, useEffect, useMemo, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { UsageBadge } from '@/components/usage/UsageBadge'
import { OpenPRButton } from '@/components/github/OpenPRButton'
import { ContactMenu } from './ContactMenu'
import { ThreadHeader } from './ThreadHeader'
import { DaySeparator } from './DaySeparator'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import {
  useActiveRuns,
  useAgentStream,
  useCancelRun,
  useMessages,
  useSendMessage
} from '@/hooks/useMessages'
import { useUsageEvents } from '@/hooks/useUsage'
import { useOpenPullRequest, usePullRequestState } from '@/hooks/usePullRequests'
import { useRunStore } from '@/store/useRunStore'
import { streamText } from '@/lib/stream'
import { usageForContact } from '@/lib/usage'
import { isSameDay, repoName } from '@/lib/format'

interface ThreadViewProps {
  contactId: string
}

export function ThreadView({ contactId }: ThreadViewProps): React.JSX.Element {
  const { data: contacts = [] } = useContacts()
  const { data: personas = [] } = usePersonas()
  const { data: thread = [] } = useMessages(contactId)
  const { data: usageEvents = [] } = useUsageEvents(contactId)
  const { data: runs = [] } = useActiveRuns()

  const contact = contacts.find((candidate) => candidate.id === contactId)
  const persona = personas.find((candidate) => candidate.id === contact?.personaTemplateId)

  const turn = useRunStore((state) => state.byContact[contactId])
  useAgentStream(contactId)

  const { send, error: sendError, reset } = useSendMessage(contactId)
  const { cancel } = useCancelRun()

  const { data: prState } = usePullRequestState(contactId)
  const { open: openPr, isPending: opening, error: prError, reset: resetPr } = useOpenPullRequest()

  const usage = useMemo(() => usageForContact(usageEvents, contactId), [usageEvents, contactId])

  // A turn on *another* contact bound to the same repo is what blocks this one
  // (blueprint §15D), so the check is by working path, not by contact.
  const blocker = runs.find(
    (run) => run.contactId !== contactId && run.workingPath === contact?.repoPath
  )

  const contentRef = useRef<HTMLDivElement>(null)
  const streamed = turn ? streamText(turn.stream) : ''

  // Follow the reply as it arrives. Keyed on the streamed text rather than just
  // the message count, so it also tracks a bubble growing in place.
  //
  // Anchored on the content and walked up to the viewport: ScrollArea is a Base
  // UI Root whose props type doesn't promise to carry a ref through to the
  // scrolling element, and the viewport is the thing that actually scrolls.
  useEffect(() => {
    const viewport = contentRef.current?.closest('[data-slot="scroll-area-viewport"]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [thread.length, streamed])

  if (!contact || !persona) {
    return <EmptyState icon={MessageSquare} title="Conversation not found" />
  }

  const isRunning = Boolean(turn && !turn.stream.finished)

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      {/*
        The repo's name, not its path. The full path is often 60+ characters —
        a macOS temp checkout is over 80 — and it was taking the entire header
        while telling you nothing the last segment doesn't. The whole path is
        still one hover away, which is the right ratio for something you need
        about once a session.
      */}
      <ThreadHeader
        leading={<AvatarColorSwatch name={persona.name} color={persona.avatarColor} size="sm" />}
        title={persona.name}
        subtitle={repoName(contact.repoPath)}
        subtitleTitle={contact.repoPath}
        actions={
          <>
            <BackendBadge backend={persona.backend} />
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
              return (
                <Fragment key={message.id}>
                  {newDay && <DaySeparator timestamp={message.timestamp} />}
                  <MessageBubble
                    role={message.role}
                    content={message.content}
                    timestamp={message.timestamp}
                    backend={persona.backend}
                  />
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
            />
          )}

          {turn?.stream.error && (
            <MessageBubble
              role="assistant"
              content={streamed}
              status="error"
              error={turn.stream.error}
              backend={persona.backend}
            />
          )}
        </div>
      </ScrollArea>

      <Composer
        placeholder={`Message ${persona.name}…`}
        onSend={(value) => {
          reset()
          send(value)
        }}
        busy={isRunning}
        onStop={() => turn && cancel(turn.runId)}
        disabled={Boolean(blocker)}
        notice={
          // A pull-request refusal belongs here rather than beside the button:
          // the messages name what to do next ("commit or discard them first"),
          // and the header has no room to say it.
          sendError ??
          prError ??
          (blocker
            ? `${blocker.contactName} is working in this repo. Wait for it to finish, or stop it from that conversation.`
            : undefined)
        }
        hint={
          // Scope lives beside the send button rather than buried in the
          // header: what this persona is allowed to do is exactly what you
          // want to know at the moment you hand it work.
          <>
            <span>Runs as</span>
            <span className="text-foreground font-medium">{persona.name}</span>
            <ScopeChip axis="sandbox" value={persona.sandbox} />
            <ScopeChip axis="github" value={persona.githubScope} />
          </>
        }
      />
    </div>
  )
}
