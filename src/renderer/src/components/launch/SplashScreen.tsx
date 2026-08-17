import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import icon from '@/assets/icon.png'

interface SplashScreenProps {
  /** Set once the launch check has settled; drives the fade-out. */
  leaving?: boolean
  error?: string
  onRetry?: () => void
}

/**
 * The first thing on screen at launch, held until the auth check settles.
 *
 * Deliberately in-renderer rather than a second BrowserWindow: main already
 * suppresses the pre-paint gap with `show: false` + backgroundColor +
 * ready-to-show (src/main/index.ts), so the only gap a user actually sees is
 * the auth.getStatus round trip — which only the renderer can observe.
 *
 * The whole window is a drag region. There's no title bar on macOS
 * (titleBarStyle: 'hiddenInset') and no nav rail yet to own that job, so
 * without this the window can't be moved while the splash is up.
 */
export function SplashScreen({
  leaving = false,
  error,
  onRetry
}: SplashScreenProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'drag-region bg-background fixed inset-0 z-50 flex flex-col items-center justify-center gap-6',
        'transition-opacity duration-300 motion-reduce:transition-none',
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      )}
    >
      <div className="flex flex-col items-center gap-4">
        <img
          src={icon}
          alt=""
          className="size-20 rounded-[22%] shadow-lg select-none"
          draggable={false}
        />
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Switchboard</h1>
          <p className="text-muted-foreground text-sm">
            {error ? 'Could not start' : 'Checking your connections…'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="no-drag flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground flex items-start gap-2 text-sm text-pretty">
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      ) : (
        // An indeterminate sliver rather than a spinner — this is a launch
        // screen, and a spinner reads as "something is stuck".
        <div className="bg-muted h-0.5 w-40 overflow-hidden rounded-full">
          <div className="bg-primary animate-splash-sweep h-full w-1/3 rounded-full" />
        </div>
      )}
    </div>
  )
}
