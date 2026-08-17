import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Copy, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /**
   * `window` fills the screen and offers a reload — the last line of defence,
   * used once at the root. `pane` fills its own pane and offers a local retry,
   * leaving the nav rail and list panel usable.
   */
  variant?: 'window' | 'pane'
  /**
   * Clears the caught error when it changes. Pass the section, so moving away
   * and coming back is a fresh attempt rather than a screen you are stuck on
   * until the whole window is reloaded.
   */
  resetKey?: string
}

interface State {
  error: Error | null
  componentStack: string | null
  copied: boolean
}

/**
 * Catches a render-time throw anywhere below it.
 *
 * Without this, one bad render unmounts the whole tree and Electron shows a
 * blank window — no message, no way back, and in a packaged app no devtools
 * either. That is the worst failure mode the shell has, because it looks
 * identical to the app hanging at launch.
 *
 * A class component because that is still the only way to implement
 * `getDerivedStateFromError`; React has no hook equivalent.
 *
 * Used at two levels, which is the refinement an earlier revision of this
 * comment called for. At the root in `variant="window"`, guaranteeing the
 * window is never blank and covering the splash and onboarding too. And around
 * each pane in `variant="pane"`, so a throw in one section leaves the nav rail
 * and the list panel usable — you can walk away from a broken screen instead of
 * having to reload the whole window to escape it. The root one is not a
 * fallback for the pane ones; it catches what they cannot, including a throw
 * from a provider.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidUpdate(previous: Props): void {
    // A new section is a new attempt. Without this, one broken pane stays
    // broken for the life of the window even after navigating away and back,
    // because the boundary has no idea anything changed underneath it.
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, componentStack: null, copied: false })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The renderer console is the only sink here — main has no logger, and
    // wiring one across the IPC boundary from inside a failure path is exactly
    // where a second throw would be unrecoverable.
    console.error('Unhandled render error', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  private details(): string {
    const { error, componentStack } = this.state
    return [error?.stack ?? String(error), componentStack].filter(Boolean).join('\n\n')
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const pane = this.props.variant === 'pane'

    return (
      // drag-region because the macOS title bar is hidden: without it the window
      // cannot be moved once the shell that normally provides the drag strip has
      // been replaced. The pane variant keeps the strip for the same reason —
      // the PaneHeader that would have carried it is what just threw.
      <div
        className={
          pane
            ? 'bg-background drag-region flex h-full flex-col items-center justify-center gap-4 px-6 text-center'
            : 'bg-background drag-region flex h-screen flex-col items-center justify-center gap-4 px-6 text-center'
        }
      >
        <span className="border-border text-destructive flex size-12 items-center justify-center rounded-xl border border-dashed">
          <AlertTriangle className="size-5" />
        </span>

        <div className="flex flex-col gap-1">
          <p className="text-title font-medium">
            {pane ? 'This section could not be drawn' : 'Something broke while drawing this screen'}
          </p>
          <p className="text-muted-foreground mx-auto max-w-md text-sm text-pretty">
            {pane
              ? 'The rest of the app is still working — you can switch to another section. Your data is on disk and is unaffected.'
              : 'Your personas, skills and conversations are stored on disk and are unaffected. Reloading starts the window again from the same data.'}
          </p>
        </div>

        <p className="text-muted-foreground max-w-md truncate font-mono text-xs">
          {error.message || error.name || 'Unknown error'}
        </p>

        <div className="no-drag flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() =>
              pane
                ? this.setState({ error: null, componentStack: null, copied: false })
                : window.location.reload()
            }
          >
            <RotateCw className="size-3.5" />
            {pane ? 'Try again' : 'Reload'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              void navigator.clipboard
                .writeText(this.details())
                .then(() => this.setState({ copied: true }))
            }}
          >
            <Copy className="size-3.5" />
            {this.state.copied ? 'Copied' : 'Copy details'}
          </Button>
        </div>
      </div>
    )
  }
}
