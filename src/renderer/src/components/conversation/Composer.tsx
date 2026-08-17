import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ComposerPicker, type PickerRow } from './ComposerPicker'
import { applyFileToken, parseFileToken, rankFiles } from '@/lib/file-token'
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
  /**
   * What `@` completes against: the working tree's paths, relative. Absent
   * or empty disables the file picker entirely.
   */
  files?: string[]
  /**
   * Earliest index an @file token may start at. The group composer passes 1:
   * its index-0 `@` is the mention, never a file.
   */
  fileMinStart?: number
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
  commands = [],
  files = [],
  fileMinStart = 0
}: ComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Escape closes the picker without clearing what was typed. Keyed on the
  // value so that typing another character reopens it — dismissing `/rel` and
  // then typing `e` is a new intention, not a continuation of the old one.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Where the cursor is, tracked because the @file token is caret-anchored —
  // the slash picker never needed to know.
  const [caret, setCaret] = useState(0)

  const slashQuery = parseSlashQuery(value)
  const slashMatches = slashQuery === null ? [] : rankSlashCommands(commands, slashQuery)

  const fileToken = files.length > 0 ? parseFileToken(value, caret, fileMinStart) : null
  const fileMatches = fileToken ? rankFiles(files, fileToken.query) : []

  // Slash wins when both could match: a value starting `/` is a command by
  // the slash parser's own strict-prefix rule, and a file token cannot start
  // at index 0 of the same word anyway — the tie is theoretical, the rule
  // still explicit.
  const activePicker: 'slash' | 'file' | null =
    slashMatches.length > 0 ? 'slash' : fileMatches.length > 0 ? 'file' : null

  const rows: PickerRow[] =
    activePicker === 'slash'
      ? slashMatches.map((command) => ({
          id: `${command.kind}:${command.name}`,
          primary: `/${command.name}`,
          secondary: command.description,
          badge: command.kind === 'repo-skill' ? 'repo skill' : 'tool'
        }))
      : activePicker === 'file'
        ? fileMatches.map((path) => ({ id: path, primary: path }))
        : []

  const pickerOpen = rows.length > 0 && dismissedFor !== value
  const boundedIndex = Math.min(activeIndex, rows.length - 1)

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

  const pickRow = (id: string): void => {
    if (activePicker === 'slash') {
      const command = slashMatches.find((candidate) => `${candidate.kind}:${candidate.name}` === id)
      if (!command) return
      handleChange(applySlashCommand(value, command))
      textareaRef.current?.focus()
      return
    }
    if (activePicker === 'file' && fileToken) {
      const next = applyFileToken(value, fileToken, id)
      handleChange(next.value)
      setCaret(next.caret)
      const element = textareaRef.current
      element?.focus()
      // After React has written the new value into the DOM — setting the
      // selection against the old text would land the cursor mid-path.
      requestAnimationFrame(() => element?.setSelectionRange(next.caret, next.caret))
    }
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
        setActiveIndex((index) => (index + 1) % rows.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + rows.length) % rows.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        const row = rows[boundedIndex]
        if (row) pickRow(row.id)
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
          <ComposerPicker
            label={activePicker === 'file' ? 'Files' : 'Commands'}
            rows={rows}
            activeIndex={boundedIndex}
            onPick={pickRow}
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
          onChange={(event) => {
            setCaret(event.target.selectionStart ?? event.target.value.length)
            handleChange(event.target.value)
          }}
          // onSelect fires for every cursor move — clicks, arrows, selection —
          // which is exactly the set of events that can relocate an @token.
          onSelect={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
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
