import { AlertTriangle, RotateCw } from 'lucide-react'
import { MarkdownMessage } from '@/components/markdown/MarkdownMessage'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { Button } from '@/components/ui/button'
import { StreamingIndicator } from './StreamingIndicator'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
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
  onRetry?: () => void
  /**
   * What the agent is doing right now, while `status` is `streaming` — the
   * command it is running, or the file it is reading. Null between tools.
   */
  activity?: string | null
}

const ERROR_TITLE: Record<MessageBubbleError['kind'], string> = {
  rate_limit: 'Rate limited',
  sandbox_denied: 'Blocked by sandbox',
  network: 'Network error',
  auth: 'Not signed in',
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
  onRetry,
  activity
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
            size="xs"
          />
          <span className="text-xs font-medium">{senderName}</span>
          {timestamp !== undefined && (
            <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
              {formatTime(timestamp)}
            </span>
          )}
        </div>
      )}
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
        {isOutbound ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <MarkdownMessage content={content} />
        )}
        {status === 'streaming' && (
          <StreamingIndicator
            backend={backend}
            className={cn(content.trim() && 'mt-2')}
            activity={activity ?? undefined}
          />
        )}
      </div>
      {isOutbound && timestamp !== undefined && (
        <span className="text-muted-foreground mr-1 font-mono text-[10px] tabular-nums">
          {formatTime(timestamp)}
        </span>
      )}
    </div>
  )
}
