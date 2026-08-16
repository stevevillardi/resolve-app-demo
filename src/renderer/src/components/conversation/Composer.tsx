import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ComposerProps {
  placeholder?: string
  onSend?: (value: string) => void
  onValueChange?: (value: string) => void
  value?: string
  leadingAction?: ReactNode
}

export function Composer({
  placeholder = 'Message…',
  onSend,
  onValueChange,
  value: controlledValue,
  leadingAction
}: ComposerProps): React.JSX.Element {
  const [internalValue, setInternalValue] = useState('')
  const value = controlledValue ?? internalValue

  const handleChange = (next: string): void => {
    setInternalValue(next)
    onValueChange?.(next)
  }

  const handleSend = (): void => {
    if (!value.trim()) return
    onSend?.(value.trim())
    setInternalValue('')
    onValueChange?.('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-border flex items-end gap-2 border-t px-3 py-3">
      {leadingAction}
      <Textarea
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className="max-h-32 min-h-9 resize-none"
      />
      <Button size="icon" onClick={handleSend} disabled={!value.trim()} aria-label="Send message">
        <SendHorizontal className="size-4" />
      </Button>
    </div>
  )
}
