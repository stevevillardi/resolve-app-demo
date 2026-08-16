import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Copy, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
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
 * Deliberately *not* a route-level boundary per pane. The point here is to
 * guarantee the window is never blank, so it sits at the root and covers the
 * splash and onboarding too. Per-view boundaries that keep the rest of the
 * shell alive are a reasonable later refinement, not a substitute.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
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

    return (
      // drag-region because the macOS title bar is hidden: without it the
      // window cannot be moved once the shell that normally provides the drag
      // strip has been replaced.
      <div className="bg-background drag-region flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="border-border text-destructive flex size-12 items-center justify-center rounded-xl border border-dashed">
          <AlertTriangle className="size-5" />
        </span>

        <div className="flex flex-col gap-1">
          <p className="text-title font-medium">Something broke while drawing this screen</p>
          <p className="text-muted-foreground mx-auto max-w-md text-sm text-pretty">
            Your personas, skills and conversations are stored on disk and are unaffected. Reloading
            starts the window again from the same data.
          </p>
        </div>

        <p className="text-muted-foreground max-w-md truncate font-mono text-xs">
          {error.message || error.name || 'Unknown error'}
        </p>

        <div className="no-drag flex items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => window.location.reload()}>
            <RotateCw className="size-3.5" />
            Reload
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
