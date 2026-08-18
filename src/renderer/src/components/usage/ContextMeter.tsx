import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  CONTEXT_ELEVATED,
  CONTEXT_FULL,
  contextFill,
  formatTokens,
  type ContextTokens
} from '@/lib/usage'
import { CONTEXT_WINDOWS_LAST_VERIFIED } from '../../../../shared/context-windows'

/**
 * How full the session is, in the thread header (Phase 22).
 *
 * The forever-thread's quiet problem: a conversation you can scroll through
 * forever sits on a session that both fills up and re-bills its whole history
 * every turn, and until now nothing on screen said so. UsageBadge beside this
 * answers "what has this cost" — a lifetime total. This answers "how much room
 * is left", which is the question whose answer changes what you do next.
 *
 * Renders nothing before the first turn. A meter reading 0% on a conversation
 * that has not started is a placeholder pretending to be a measurement, and the
 * header is already carrying four things.
 */
export function ContextMeter({ tokens }: { tokens: ContextTokens | null }): React.JSX.Element {
  if (!tokens) return <></>

  const fill = contextFill(tokens)

  // No window for this model, so no fraction — the bare figure, which is what
  // this app showed everywhere before there was a table to divide by. The
  // fallback is what makes showing a percentage elsewhere defensible.
  if (!fill) {
    return (
      <Tooltip>
        <TooltipTrigger className="text-muted-foreground shrink-0 rounded-md font-mono text-meta tabular-nums">
          {formatTokens(tokens.lastPromptTokens)}
        </TooltipTrigger>
        <TooltipContent>
          <MeterDetail tokens={tokens} />
          <p className="text-muted-foreground mt-1 max-w-64 text-xs">
            No percentage: this app has no context-window figure for {tokens.model ?? 'this model'},
            and a guess would look like a measurement.
          </p>
        </TooltipContent>
      </Tooltip>
    )
  }

  const percent = Math.round(fill.fraction * 100)
  // The app's existing three-step severity register (--scope-*), rather than a
  // fourth palette for the same idea. The number is always beside the bar:
  // main.css's header says this scheme is "never color-alone", and a meter is
  // exactly the sort of thing that would quietly become so.
  const step =
    fill.fraction >= CONTEXT_FULL ? 'full' : fill.fraction >= CONTEXT_ELEVATED ? 'elevated' : 'safe'

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'text-muted-foreground flex shrink-0 items-center gap-1.5 rounded-md',
          'font-mono text-meta tabular-nums'
        )}
      >
        {/*
          Hidden on a narrow pane, where the header already competes with the
          backend badge, the spend and the ⋯ menu. The number survives, because
          it is the part that carries the information. Container query, not a
          viewport one — the pane is what varies, and the window minimum is
          wider than every viewport breakpoint anyway.
        */}
        <span
          className="bg-muted hidden h-1.5 w-7 overflow-hidden rounded-full @2xl/pane:block"
          aria-hidden
        >
          <span
            className={cn(
              'block h-full rounded-full transition-all',
              step === 'full' && 'bg-scope-full',
              step === 'elevated' && 'bg-scope-elevated',
              step === 'safe' && 'bg-muted-foreground/40'
            )}
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </span>
        <span
          className={cn(
            step === 'full' && 'text-scope-full',
            step === 'elevated' && 'text-scope-elevated'
          )}
        >
          ≈{percent}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <MeterDetail tokens={tokens} />
        <p className="text-muted-foreground mt-1 max-w-64 text-xs">
          Window {formatTokens(fill.window)},{' '}
          {fill.windowSource === 'published' ? 'as published' : 'inferred from the model family'} on{' '}
          {CONTEXT_WINDOWS_LAST_VERIFIED}.
        </p>
        {step !== 'safe' && (
          <p className="mt-1 max-w-64 text-xs">
            Start a fresh session from the ⋯ menu to reset it — the conversation stays.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The two figures and why they differ.
 *
 * `≈` on the fraction is not decoration: a turn reports one usage total
 * covering every model request it made, so a turn that ran ten tools reports
 * their prompts added together. It reads high, and the tooltip says so —
 * because the remedy this meter invites costs the model's memory of the thread,
 * and nobody should spend that on a number the app knows is approximate without
 * being told.
 */
function MeterDetail({ tokens }: { tokens: ContextTokens }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span>
        <span className="font-mono tabular-nums">{formatTokens(tokens.lastPromptTokens)}</span> in
        the last request
      </span>
      <span>
        <span className="font-mono tabular-nums">{formatTokens(tokens.billedInputTokens)}</span>{' '}
        input tokens billed over {tokens.turns} {tokens.turns === 1 ? 'turn' : 'turns'}
      </span>
      <span className="text-muted-foreground max-w-64">
        Approximate — one turn reports a single figure covering every request it made, so a turn
        that ran several tools reads high.
      </span>
    </div>
  )
}
