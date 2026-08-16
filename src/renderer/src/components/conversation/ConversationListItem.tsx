import type { KeyboardEvent } from 'react'
import { Users } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { UsageBadge } from '@/components/usage/UsageBadge'
import { cn } from '@/lib/utils'
import type { UsageSummary } from '@/types'

interface ConversationListItemProps {
  name: string
  preview: string
  kind: 'contact' | 'group'
  avatarColor?: string
  active: boolean
  usage?: UsageSummary
  onSelect: () => void
}

export function ConversationListItem({
  name,
  preview,
  kind,
  avatarColor,
  active,
  usage,
  onSelect
}: ConversationListItemProps): React.JSX.Element {
  const accent = kind === 'group' ? 'var(--accent-group)' : (avatarColor ?? 'var(--accent-contact)')

  // A plain <div role="button"> rather than a <button> — UsageBadge below
  // renders its own focusable tooltip trigger, and nesting interactive
  // elements inside a <button> is invalid HTML.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      data-active={active}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 border-l-[3px] px-3 py-2.5 text-left transition-colors',
        'hover:bg-accent',
        active ? 'bg-accent' : 'border-l-transparent'
      )}
      style={active ? { borderLeftColor: accent } : undefined}
    >
      {kind === 'group' ? (
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: 'var(--accent-group)' }}
        >
          <Users className="size-4" />
        </span>
      ) : (
        <AvatarColorSwatch name={name} color={avatarColor ?? 'var(--accent-contact)'} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
        </span>
        <span className="text-muted-foreground block truncate text-xs">{preview}</span>
      </span>
      {usage && <UsageBadge summary={usage} variant="compact" />}
    </div>
  )
}
