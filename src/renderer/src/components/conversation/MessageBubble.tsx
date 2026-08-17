import { AlertTriangle, Copy, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { MarkdownMessage } from '@/components/markdown/MarkdownMessage'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { StreamingIndicator } from './StreamingIndicator'
import { ToolCallTimeline } from './ToolCallTimeline'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/lib/stream'
import type { MessageBubbleError, MessageBubbleStatus, MessageRole, PersonaBackend } from '@/types'

interface MessageBubbleProps {
  role: MessageRole
  content: string
  timestamp?: number
  status?: MessageBubbleStatus
  error?: MessageBubbleError
  backend?: PersonaBackend
  senderName?: string
  senderColor?: string
  /** The sending persona's id — seeds the bot avatar beside group replies. */
  senderSeed?: string
  onRetry?: () => void
  /**
   * What the agent is doing right now, while `status` is `streaming` — the
   * command it is running, or the file it is reading. Null between tools.
   */
  activity?: string | null
  /**
   * What it has done so far this turn.
   *
   * Distinct from `activity` above, which is one current line that is replaced
   * as work moves on. This is the record, and it is what makes a tool call
   * visible as work rather than something to infer from the reply — the thing
   * blueprint §9 objects to, and sharpest for an MCP call, which can read or
   * write GitHub while leaving no trace in the text at all.
   */
  toolCalls?: ToolCall[]
}

const ERROR_TITLE: Record<MessageBubbleError['kind'], string> = {
  rate_limit: 'Rate limited',
  sandbox_denied: 'Blocked by sandbox',
  network: 'Network error',
  auth: 'Not signed in',
  // Rare on screen: messaging.ts retries a dead resume key with a fresh
  // session before letting this surface, so seeing it means even that failed.
  session: "Couldn't resume this conversation",
  // The default classifyErrorMessage() result, so this is the common case
  // rather than a fallback nobody hits.
  unknown: "Couldn't complete this turn"
}

export function MessageBubble({
  role,
  content,
  timestamp,
  status = 'sent',
  error,
  backend = 'claude',
  senderName,
  senderColor,
  senderSeed,
  onRetry,
  activity,
  toolCalls
}: MessageBubbleProps): React.JSX.Element {
  const isOutbound = role === 'user'

  // Failures render in the thread, not a console (blueprint §15C) — but as a
  // notice with a title and a way forward, not a red bubble. A bubble implies
  // someone said something; nobody said this.
  if (status === 'error') {
    return (
      <div className="flex justify-start">
        <div className="border-destructive/30 bg-destructive/5 flex max-w-[min(46rem,88%)] items-start gap-2.5 rounded-lg border px-3 py-2.5">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-destructive text-xs font-semibold">
              {ERROR_TITLE[error?.kind ?? 'unknown']}
            </p>
            <p className="text-foreground/80 mt-0.5 text-sm">
              {error?.message ?? 'Something went wrong.'}
            </p>
            {/* Whatever the agent managed to say before it failed. Often the
                most useful part of a failed turn, so it is kept rather than
                replaced by the error. */}
            {content.trim() && (
              <div className="text-foreground/70 mt-2 text-sm">
                <MarkdownMessage content={content} />
              </div>
            )}
            {onRetry && (
              <Button variant="outline" size="xs" onClick={onRetry} className="mt-2 gap-1">
                <RotateCw className="size-3" />
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1', isOutbound ? 'items-end' : 'items-start')}>
      {!isOutbound && senderName && (
        <div className="ml-0.5 flex items-center gap-1.5">
          <AvatarColorSwatch
            name={senderName}
            color={senderColor ?? 'var(--muted-foreground)'}
            seed={senderSeed}
            size="xs"
          />
          <span className="text-xs font-medium">{senderName}</span>
          {timestamp !== undefined && (
            <span className="text-muted-foreground font-mono text-micro tabular-nums">
              {formatTime(timestamp)}
            </span>
          )}
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              className={cn(
                'max-w-[min(46rem,88%)] px-3.5 py-2.5 text-sm',
                // Asymmetric corner: the bubble's inner-bottom corner tightens toward
                // its author, which is what makes direction readable without a tail.
                isOutbound
                  ? 'bg-bubble-outbound text-bubble-outbound-foreground rounded-[var(--radius-bubble)] rounded-br-md'
                  : 'bg-bubble-inbound text-bubble-inbound-foreground rounded-[var(--radius-bubble)] rounded-bl-md'
              )}
            >
              {/* History: the turn's persisted tool record, above the reply it
                  produced — same reading order as the live stream, where the
                  work scrolls past before the answer lands. */}
              {!isOutbound && status === 'sent' && (toolCalls ?? []).length > 0 && (
                <ToolCallTimeline calls={toolCalls ?? []} className="mb-2" />
              )}
              {isOutbound ? (
                <p className="whitespace-pre-wrap">{content}</p>
              ) : (
                <MarkdownMessage content={content} />
              )}
              {status === 'streaming' && (
                <>
                  {/* Above the indicator: what has happened reads top-down, and what
                      is happening now stays last, where the eye already is. */}
                  <ToolCallTimeline
                    calls={toolCalls ?? []}
                    className={cn((content.trim() || (toolCalls ?? []).length > 0) && 'mt-2')}
                  />
                  <StreamingIndicator
                    backend={backend}
                    className={cn((content.trim() || (toolCalls ?? []).length > 0) && 'mt-2')}
                    activity={activity ?? undefined}
                  />
                </>
              )}
            </div>
          }
        />
        <ContextMenuContent>
          {/* The whole message, not the DOM selection — "copy what this said"
              is the request a bubble menu answers; partial copy stays with
              ordinary text selection. Toasted because a clipboard write has no
              visible effect of its own. */}
          <ContextMenuItem
            onClick={() => {
              void navigator.clipboard.writeText(content)
              toast('Copied')
            }}
          >
            <Copy />
            Copy text
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isOutbound && timestamp !== undefined && (
        <span className="text-muted-foreground mr-1 font-mono text-micro tabular-nums">
          {formatTime(timestamp)}
        </span>
      )}
    </div>
  )
}
