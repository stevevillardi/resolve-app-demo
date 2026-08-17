import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SlashPicker } from './SlashPicker'
import {
  applySlashCommand,
  parseSlashQuery,
  rankSlashCommands,
  type SlashCommand
} from '@/lib/slash'
import { cn } from '@/lib/utils'

interface ComposerProps {
  placeholder?: string
  /**
   * Fired with the trimmed draft. Deliberately does NOT clear the field —
   * whether a send was accepted is the owner's knowledge (the IPC can refuse,
   * e.g. a repo-lock refusal), and clearing here used to destroy the draft
   * before the refusal came back. Owners clear on success.
   */
  onSend?: (value: string) => void
  onValueChange: (value: string) => void
  /** Always controlled: both thread views own their draft state. */
  value: string
  leadingAction?: ReactNode
  /** Shown under the field — e.g. which persona and sandbox will handle this. */
  hint?: ReactNode
  /**
   * A turn is running: the send button becomes a stop button.
   *
   * Typing stays enabled on purpose — composing the next message while the
   * current one runs is normal, and only *sending* has to wait.
   */
  busy?: boolean
  onStop?: () => void
  /** Blocks sending outright — another persona holds this repo (§15D). */
  disabled?: boolean
  /** Why sending is blocked. Replaces the hint while set. */
  notice?: ReactNode
  /**
   * What `/` offers. Absent or empty disables the picker entirely.
   *
   * Resolved by the caller from what this contact can actually reach, so the
   * menu never offers a capability the session is sealed against — see
   * lib/slash.ts.
   */
  commands?: SlashCommand[]
}

const MAX_HEIGHT = 168

export function Composer({
  placeholder = 'Message…',
  onSend,
  onValueChange,
  value,
  leadingAction,
  hint,
  busy = false,
  onStop,
  disabled = false,
  notice,
  commands = []
}: ComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Escape closes the picker without clearing what was typed. Keyed on the
  // value so that typing another character reopens it — dismissing `/rel` and
  // then typing `e` is a new intention, not a continuation of the old one.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const query = parseSlashQuery(value)
  const matches = query === null ? [] : rankSlashCommands(commands, query)
  const pickerOpen = matches.length > 0 && dismissedFor !== value
  const active = matches[Math.min(activeIndex, matches.length - 1)]

  // The previous revision set rows={1} with a max-height and never grew: a
  // textarea's height is fixed by `rows` unless something measures scrollHeight
  // and writes it back. Layout effect, not effect, so there is no visible jump.
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`
    element.style.overflowY = element.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
  }, [value])

  const handleChange = (next: string): void => {
    onValueChange(next)
    // Back to the top whenever the query changes: the old index pointed into a
    // list that no longer exists, and keeping it would highlight an unrelated
    // row.
    setActiveIndex(0)
  }

  const pick = (command: SlashCommand): void => {
    handleChange(applySlashCommand(value, command))
    textareaRef.current?.focus()
  }

  const handleSend = (): void => {
    if (!value.trim() || disabled || busy) return
    onSend?.(value.trim())
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // The picker owns the keyboard while it is open, and this block has to come
    // first: the Enter arm below sends unconditionally, so leaving it ahead
    // would fire off "/rel" as a message the moment somebody chose a command.
    //
    // Nothing here fights ⌘K — that is bound on `window` in the capture phase
    // precisely so a composer keydown cannot beat it, and `/` is not a chord.
    if (pickerOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + matches.length) % matches.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        if (active) pick(active)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        // Closes the menu, keeps the text. Someone who typed `/` meaning a path
        // should not lose the line to get rid of the suggestion.
        setDismissedFor(value)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    // The same measure as the message column above it. Both thread views centre
    // their messages at `max-w-4xl` while this was full-bleed, so on a wide
    // window the field you reply in was visibly wider than everything you were
    // replying to — two independent decisions about width inside one pane.
    <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-2 pb-4">
      {/* Relative so the picker can sit directly above the field rather than
          being positioned against the pane. */}
      <div className="relative">
        {pickerOpen && (
          <SlashPicker
            commands={matches}
            activeIndex={Math.min(activeIndex, matches.length - 1)}
            onPick={pick}
          />
        )}
      </div>
      <div
        className={cn(
          'bg-card border-border flex items-end gap-1.5 rounded-xl border p-1.5 transition-shadow',
          'focus-within:border-ring focus-within:ring-ring/30 focus-within:ring-2'
        )}
      >
        {leadingAction}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="placeholder:text-muted-foreground min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-relaxed outline-none"
        />
        {busy ? (
          <Button
            size="icon-sm"
            variant="secondary"
            onClick={onStop}
            aria-label="Stop generating"
            className="rounded-full"
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            aria-label="Send message"
            className="rounded-full"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
      {(notice ?? hint) && (
        <div
          className={cn(
            'mt-1.5 flex items-center gap-1.5 px-1 text-meta',
            notice ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {notice ?? hint}
        </div>
      )}
    </div>
  )
}
