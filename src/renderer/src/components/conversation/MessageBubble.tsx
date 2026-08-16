import { AlertTriangle } from 'lucide-react'
import { MarkdownMessage } from '@/components/markdown/MarkdownMessage'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { StreamingIndicator } from './StreamingIndicator'
import { cn } from '@/lib/utils'
import type { MessageBubbleError, MessageBubbleStatus, MessageRole, PersonaBackend } from '@/types'

interface MessageBubbleProps {
  role: MessageRole
  content: string
  status?: MessageBubbleStatus
  error?: MessageBubbleError
  backend?: PersonaBackend
  senderName?: string
  senderColor?: string
}

export function MessageBubble({
  role,
  content,
  status = 'sent',
  error,
  backend = 'claude',
  senderName,
  senderColor
}: MessageBubbleProps): React.JSX.Element {
  const isOutbound = role === 'user'

  if (status === 'error') {
    return (
      <div className="flex justify-start">
        <div
          className="flex max-w-[85%] items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{
            backgroundColor: 'var(--status-error-bg)',
            color: 'var(--status-error-fg)',
            borderColor: 'var(--status-error-border)'
          }}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error?.message ?? 'Something went wrong.'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1', isOutbound ? 'items-end' : 'items-start')}>
      {!isOutbound && senderName && (
        <div className="ml-1 flex items-center gap-1.5">
          <AvatarColorSwatch
            name={senderName}
            color={senderColor ?? 'var(--accent-contact)'}
            size="sm"
          />
          <span className="text-muted-foreground text-xs font-medium">{senderName}</span>
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-[var(--radius-bubble)] px-3.5 py-2.5 text-sm',
          isOutbound
            ? 'bg-bubble-outbound text-bubble-outbound-fg'
            : 'bg-bubble-inbound text-bubble-inbound-fg border-bubble-inbound-border border'
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
            className="mt-2"
            activity={backend === 'codex' ? 'grep -r fetchStuff' : undefined}
          />
        )}
      </div>
    </div>
  )
}
