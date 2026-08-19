import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '@/lib/utils'

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  )
}

function ResizablePanel({ style, ...props }: ResizablePrimitive.PanelProps) {
  return (
    <ResizablePrimitive.Panel
      data-slot="resizable-panel"
      // Two overrides of the library's inner content wrapper (v4 spreads the
      // style prop after its own `overflow: auto` etc., so these win):
      //
      // `height: 100%` — the wrapper's default height comes from *two* nested
      // flex stretches through `height: auto` layers, and a pane's `h-full`
      // resolved against that chain can wedge at a stale value after window
      // resize churn (seen live: the group thread laid out for an old height,
      // composer floating mid-window). A definite percentage removes the
      // dependency on stretch resolution entirely.
      //
      // `overflow: hidden` — the wrapper is a scroll container by default,
      // which is the failure's visible half: when a pane's height wedged, the
      // *panel* scrolled the whole pane, header and all. Every pane in this
      // app scrolls internally (ScrollArea in PaneBody/ListPanel/threads), so
      // panel-level scrolling is never wanted; hidden makes the symptom class
      // structurally impossible.
      style={{ height: '100%', overflow: 'hidden', ...style }}
      {...props}
    />
  )
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
        className
      )}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
