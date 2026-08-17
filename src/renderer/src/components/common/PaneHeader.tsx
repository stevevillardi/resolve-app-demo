import { cn } from '@/lib/utils'

interface PaneHeaderProps {
  /** Avatar, swatch or icon identifying what the pane is showing. */
  leading?: React.ReactNode
  title: string
  /**
   * Keeps the title in the accessibility tree but takes it off the strip.
   *
   * For the one pane that abuts the nav rail — Home, which has no list panel
   * between the two — where a visible title would land 9px from the green
   * traffic light. Still rendered, because a screen the assistive tree cannot
   * name is a worse trade than a blank strip.
   */
  titleHidden?: boolean
  /** Machine text — a repo path, a session id. Set in mono by the rule. */
  subtitle?: string
  /**
   * The long form, on hover, when the subtitle is an abbreviation of it.
   *
   * A repo path is routinely 60+ characters and told you nothing its last
   * segment didn't, so headers show the name and keep the path here.
   */
  subtitleTitle?: string
  actions?: React.ReactNode
  className?: string
}

/**
 * The window's title strip — the top 48px, and the one definition of it.
 *
 * Four places drew this independently: here, `EmptyPane`, the list panel, and
 * the nav rail's header. That is what let it drift, and the drift was not
 * cosmetic. `bg-card` was added to this file alone, so the seam it was meant to
 * close reopened on the one screen that renders `EmptyPane` — a profile with no
 * contacts, which is every fresh install and so the first thing anyone sees.
 *
 * Three properties, all load-bearing:
 *
 * `bg-card`, so the strip is one continuous surface across the whole window.
 * `--card`, `--sidebar` and the list panel's surface are the same colour in both
 * themes, which is what lets the segments join invisibly. It matters because on
 * Home there is no list panel between the rail and the pane, so the rail's
 * `bg-sidebar` met `bg-background` at x=64 — directly under the green traffic
 * light, which spans 57.5 to 70.5 and straddled the seam. The pane's own
 * background picking up below the border then reads as a tinted toolbar over
 * content rather than an accident of which section is open.
 *
 * `border-b`, the hairline that runs unbroken across the window at every
 * section.
 *
 * `drag-region`, because with `titleBarStyle: 'hiddenInset'` the app must
 * nominate its own draggable chrome. A pane that omitted it left the top 48px
 * undraggable, so which section you were on decided whether the window could be
 * moved by its top edge.
 */
export const PANE_STRIP = 'border-border bg-card drag-region h-12 shrink-0 border-b'

/**
 * The top strip of every detail pane, with a title in it.
 *
 * Every workspace view had hand-rolled this same header, which is why they had
 * drifted apart — different gaps, different truncation, some with a subtitle
 * slot and some without. One component means the border beneath them stays a
 * single unbroken line across the window at every section.
 *
 * The actions cluster opts out of the drag region with `no-drag`: interactive
 * children inside one stop receiving clicks entirely.
 */
export function PaneHeader({
  leading,
  title,
  titleHidden = false,
  subtitle,
  subtitleTitle,
  actions,
  className
}: PaneHeaderProps): React.JSX.Element {
  return (
    <header className={cn(PANE_STRIP, 'flex items-center gap-2.5 px-4', className)}>
      {leading}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1
          className={cn('truncate text-sm font-semibold tracking-tight', titleHidden && 'sr-only')}
        >
          {title}
        </h1>
        {subtitle && (
          <span
            className="text-muted-foreground truncate font-mono text-meta"
            {...(subtitleTitle ? { title: subtitleTitle } : {})}
          >
            {subtitle}
          </span>
        )}
      </div>
      {actions && <div className="no-drag flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  )
}
