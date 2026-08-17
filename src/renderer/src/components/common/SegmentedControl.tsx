import { useId, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface SegmentedControlOption<T extends string> {
  value: T
  label: string
  /**
   * Drawn before the label, at the label's own size. For segments naming a
   * *thing* rather than a level — the two backends have marks, `read_only` and
   * `full` do not and should not acquire decorative ones.
   */
  icon?: React.ComponentType<{ className?: string }>
}

interface SegmentedControlProps<T extends string> {
  /**
   * `readonly` so an `as const` options table passes straight through. Six call
   * sites were writing `.map((option) => ({ ...option }))` purely to strip the
   * modifier, which also handed this component a fresh array every render.
   */
  options: readonly SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Equal-width segments. Only for a control that has to fill a fixed column. */
  fill?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * A radiogroup, not a tablist — these pick a *value* for a field (backend,
 * sandbox, scope, range), they don't switch panels. Arrow keys move between
 * options natively because each segment is a real radio input under the label.
 *
 * Segments size to their own labels. The previous revision gave every segment
 * `flex-1`, so all of them took the width of the longest — which is why "All"
 * on the usage dashboard was rendered as wide as "Summaries", and its selected
 * thumb three times wider than the word inside it.
 *
 * That also means the thumb can no longer be positioned by arithmetic. It used
 * `calc((100% - 0.25rem) / n)` and `translateX(index * 100%)`, which is only
 * correct while the segments are equal — so the two changes had to happen
 * together. The thumb is measured off the selected label instead.
 *
 * `offsetLeft`/`offsetWidth` rather than `getBoundingClientRect`: the track is
 * `relative`, so it is already the offsetParent and the numbers need no
 * subtraction. They are integer-rounded too, which keeps sub-pixel drift from
 * re-triggering the observer below.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  'aria-label': ariaLabel,
  className
}: SegmentedControlProps<T>): React.JSX.Element {
  const groupName = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const segmentRefs = useRef(new Map<string, HTMLLabelElement>())
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)

  // A stable dependency even when the caller passes an inline array literal, so
  // the observer is rebuilt when the options really change rather than on every
  // render.
  const shape = options
    .map((option) => `${option.value}|${option.label}|${option.icon ? '1' : '0'}`)
    .join(',')

  useLayoutEffect(() => {
    const measure = (): void => {
      const active = segmentRefs.current.get(value)
      if (!active) return
      const left = active.offsetLeft
      const width = active.offsetWidth
      if (width === 0) return
      // Identity-guarded. A ResizeObserver callback that always produces a new
      // object, feeding a transition on the thing being observed, is how you
      // get "ResizeObserver loop completed with undelivered notifications".
      setThumb((previous) =>
        previous && previous.left === left && previous.width === width ? previous : { left, width }
      )
    }

    measure()

    const observer = new ResizeObserver(measure)
    if (trackRef.current) observer.observe(trackRef.current)
    for (const element of segmentRefs.current.values()) observer.observe(element)

    // Inter is bundled rather than fetched, but @fontsource still applies it
    // asynchronously — every label's width changes at that moment, and without
    // this the thumb keeps the fallback face's measurements for the session.
    void document.fonts?.ready.then(measure)

    return () => observer.disconnect()
  }, [value, shape])

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      // `self-start` as well as `inline-flex`: every caller puts this inside a
      // `flex flex-col` Field, where the default `align-items: stretch` makes
      // an inline-flex box fill the column anyway. Sizing the segments to their
      // labels was pointless while the track around them still spanned the pane
      // — which is exactly what it did once the panes got wider.
      className={cn(
        'bg-muted relative rounded-lg p-0.5',
        fill ? 'flex' : 'inline-flex self-start',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'bg-background ring-border/60 pointer-events-none absolute inset-y-0.5 left-0 rounded-md ring-1',
          // Hidden until the first measurement lands, or the thumb visibly
          // slides in from zero width on mount.
          thumb ? 'transition-[transform,width] duration-150 ease-out' : 'opacity-0'
        )}
        style={thumb ? { transform: `translateX(${thumb.left}px)`, width: thumb.width } : undefined}
      />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <label
            key={option.value}
            ref={(element) => {
              if (element) segmentRefs.current.set(option.value, element)
              else segmentRefs.current.delete(option.value)
            }}
            className={cn(
              'relative z-10 cursor-pointer rounded-md px-2.5 py-1 text-center text-xs font-medium whitespace-nowrap transition-colors',
              'focus-within:ring-ring/50 focus-within:ring-2',
              fill && 'flex-1',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon && <option.icon className="mr-1 inline-block size-3 align-[-1px]" />}
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
