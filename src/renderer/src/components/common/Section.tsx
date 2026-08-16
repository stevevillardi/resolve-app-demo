import { cn } from '@/lib/utils'

interface SectionProps {
  title: string
  /** What the section is for, in one line. Optional — some sections are self-evident. */
  description?: React.ReactNode
  /** Right-aligned control belonging to the section, e.g. a range picker. */
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * A titled group of related controls or rows inside a pane body.
 *
 * Repeated by hand in every workspace view, which is how the same heading ended
 * up with three different gaps beneath it. Headings stay `h2` under the pane
 * header's `h1` so each pane is one coherent document outline.
 */
export function Section({
  title,
  description,
  action,
  children,
  className
}: SectionProps): React.JSX.Element {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-muted-foreground text-xs">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}
