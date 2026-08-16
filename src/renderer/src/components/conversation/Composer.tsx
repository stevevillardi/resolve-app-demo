import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ComposerProps {
  placeholder?: string
  onSend?: (value: string) => void
  onValueChange?: (value: string) => void
  value?: string
  leadingAction?: ReactNode
  /** Shown under the field — e.g. which persona and sandbox will handle this. */
  hint?: ReactNode
}

const MAX_HEIGHT = 168

export function Composer({
  placeholder = 'Message…',
  onSend,
  onValueChange,
  value: controlledValue,
  leadingAction,
  hint
}: ComposerProps): React.JSX.Element {
  const [internalValue, setInternalValue] = useState('')
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    if (!isControlled) setInternalValue(next)
    onValueChange?.(next)
  }

  const handleSend = (): void => {
    if (!value.trim()) return
    onSend?.(value.trim())
    if (!isControlled) setInternalValue('')
    onValueChange?.('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="shrink-0 px-4 pt-2 pb-4">
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
        <Button
          size="icon-sm"
          onClick={handleSend}
          disabled={!value.trim()}
          aria-label="Send message"
          className="rounded-full"
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>
      {hint && (
        <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 px-1 text-[11px]">
          {hint}
        </div>
      )}
    </div>
  )
}
