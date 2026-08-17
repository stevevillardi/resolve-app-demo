import { cn } from '@/lib/utils'

/**
 * The composer's inline suggestion list, rendered above the field — shared
 * by the `/` command picker and the `@` file picker.
 *
 * Deliberately **not** a Popover wrapping cmdk's `Command`, which is what
 * MentionPicker uses. That one is trigger-driven: you click a button, focus
 * moves into the popover, and its own input takes the typing. Here the
 * textarea is the input — the user is mid-message — so moving focus would
 * break typing at exactly the moment they are doing it. A plain positioned
 * list with the Composer owning the keyboard is the shape that fits.
 *
 * Which means this component holds no state and handles no keys. It renders
 * what it is told and reports clicks; the selection logic lives in Composer,
 * and the rules it runs on live in lib/slash.ts and lib/file-token.ts where
 * they can be tested.
 */

export interface PickerRow {
  id: string
  primary: string
  secondary?: string
  badge?: string
}

export function ComposerPicker({
  label,
  rows,
  activeIndex,
  onPick
}: {
  label: string
  rows: PickerRow[]
  activeIndex: number
  onPick: (id: string) => void
}): React.JSX.Element {
  return (
    <div
      role="listbox"
      aria-label={label}
      className="bg-popover border-border absolute bottom-full left-0 z-50 mb-1.5 max-h-64 w-full max-w-md overflow-y-auto rounded-lg border p-1 shadow-md"
    >
      {rows.map((row, index) => (
        <button
          key={row.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // The textarea keeps focus, so the active row is highlighted from
          // props rather than by :focus — and pointer users get the same
          // affordance by hovering.
          onMouseDown={(event) => {
            // Before blur: a mousedown that lets the textarea lose focus first
            // closes the picker out from under the click.
            event.preventDefault()
            onPick(row.id)
          }}
          className={cn(
            'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm',
            index === activeIndex ? 'bg-accent' : 'hover:bg-accent/50'
          )}
        >
          <span className="min-w-0 truncate font-mono text-[13px]">{row.primary}</span>
          {row.secondary && (
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {row.secondary}
            </span>
          )}
          {row.badge && (
            <span className="text-muted-foreground shrink-0 text-meta">{row.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
