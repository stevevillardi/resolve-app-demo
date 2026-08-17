import { cn } from '@/lib/utils'
import type { SlashCommand } from '@/lib/slash'

/**
 * The `/` menu, rendered above the composer.
 *
 * Deliberately **not** a Popover wrapping cmdk's `Command`, which is what
 * MentionPicker uses. That one is trigger-driven: you click a button, focus
 * moves into the popover, and its own input takes the typing. Here the textarea
 * is the input — the user is mid-message — so moving focus would break typing
 * at exactly the moment they are doing it. A plain positioned list with the
 * Composer owning the keyboard is the shape that fits.
 *
 * Which means this component holds no state and handles no keys. It renders
 * what it is told and reports clicks; the selection logic lives in Composer,
 * and the rules it runs on live in lib/slash.ts where they can be tested.
 */
export function SlashPicker({
  commands,
  activeIndex,
  onPick
}: {
  commands: SlashCommand[]
  activeIndex: number
  onPick: (command: SlashCommand) => void
}): React.JSX.Element {
  return (
    <div
      role="listbox"
      aria-label="Commands"
      className="bg-popover border-border absolute bottom-full left-0 z-50 mb-1.5 max-h-64 w-full max-w-md overflow-y-auto rounded-lg border p-1 shadow-md"
    >
      {commands.map((command, index) => (
        <button
          key={`${command.kind}:${command.name}`}
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
            onPick(command)
          }}
          className={cn(
            'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm',
            index === activeIndex ? 'bg-accent' : 'hover:bg-accent/50'
          )}
        >
          <span className="font-mono text-[13px]">/{command.name}</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {command.description}
          </span>
          <span className="text-muted-foreground shrink-0 text-meta">
            {command.kind === 'repo-skill' ? 'repo skill' : 'tool'}
          </span>
        </button>
      ))}
    </div>
  )
}
