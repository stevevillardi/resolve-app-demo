import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ApiKeyFieldProps {
  label: string
  placeholder: string
  isPending: boolean
  error?: string | null
  onSubmit: (apiKey: string) => void
}

/** Key entry for the two backends that accept one. Never echoes the value back. */
export function ApiKeyField({
  label,
  placeholder,
  isPending,
  error,
  onSubmit
}: ApiKeyFieldProps): React.JSX.Element {
  const [value, setValue] = useState('')

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = value.trim()
        if (!trimmed || isPending) return
        onSubmit(trimmed)
        // Clear immediately — the field is write-only, and a stored key must
        // never be readable back out of the DOM.
        setValue('')
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          disabled={isPending}
          onChange={(event) => setValue(event.target.value)}
          className="font-mono"
        />
        <Button type="submit" size="sm" disabled={!value.trim() || isPending}>
          {isPending && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
          Save
        </Button>
      </div>
      {error && <p className="text-destructive text-sm text-pretty">{error}</p>}
    </form>
  )
}
