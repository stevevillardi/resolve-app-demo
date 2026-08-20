import { ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  activeFacetCount,
  clearFacets,
  selectedValues,
  toggleFacetValue,
  visibleFacets,
  type FacetSpec,
  type ListFilter
} from '@/lib/list-filter'

/**
 * The chips under a rail's search box.
 *
 * A search box answers "find the one I can already name". These answer the
 * question a fleet actually raises — "show me everything on this repository",
 * "only the ones that are paused" — which no amount of typing gets at, because
 * the thing being filtered on is not in the text of the row.
 *
 * Chips rather than a `repo:` search syntax, which was the alternative:
 * a syntax is invisible until documented, needs a parser and an error state for
 * a typo, and gives no way to see what is currently applied. A chip shows its
 * own state, and a chip with nothing selected shows that too.
 *
 * Built from the existing `DropdownMenu` checkbox items and `menu-styles`
 * rather than a new primitive. Multi-select is the point — see the OR-within
 * rule in `list-filter.ts` — so a checkbox menu is the right control and the
 * app already has one.
 */
export function FacetBar({
  specs,
  filter,
  onChange
}: {
  specs: FacetSpec[]
  filter: ListFilter
  onChange: (next: ListFilter) => void
}): React.JSX.Element | null {
  // A facet nobody can make a decision in is not rendered at all, so a
  // one-repository profile never sees this bar and the seeded three-contact
  // demo sees only the facets that mean something.
  const shown = visibleFacets(specs)
  if (shown.length === 0) return null

  const active = activeFacetCount(filter)

  return (
    <div className="no-drag flex flex-wrap items-center gap-1 px-4 pb-2.5">
      {shown.map((spec) => {
        const selected = selectedValues(filter, spec.id)
        return (
          <DropdownMenu key={spec.id}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  // The chip carries its own state: the label alone while it is
                  // off, the chosen value once one is picked, and a count past
                  // that. A chip that looked identical filtered and unfiltered
                  // would be the whole feature failing quietly.
                  className={cn(
                    'h-6 gap-1 rounded-full px-2 text-meta font-normal',
                    selected.length > 0 && 'border-primary/40 bg-primary/10 text-foreground'
                  )}
                  aria-label={`Filter by ${spec.label}`}
                >
                  <span className="truncate">{chipLabel(spec, selected)}</span>
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
              {spec.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={selected.includes(option.value)}
                  // `onCheckedChange`, not `onClick`: it is the handler that
                  // also fires for a keyboard toggle, and a facet reachable by
                  // mouse only would be worse than the shortcuts this app
                  // already documents.
                  //
                  // The menu deliberately stays open across a pick — Base UI's
                  // `closeOnClick` already defaults to false on a checkbox
                  // item, so there is nothing to pass. Picking two
                  // repositories is one decision, and closing after the first
                  // would make the OR-within-a-facet rule cost a reopen per
                  // value.
                  onCheckedChange={() => onChange(toggleFacetValue(filter, spec.id, option.value))}
                >
                  <span className="truncate">{option.label}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}

      {/* Only once there is something to clear. A permanently present "Clear"
          is a button that does nothing most of the time, and the count is what
          makes it worth a click — it says how much is hidden. */}
      {active > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 rounded-full px-2 text-meta font-normal"
          onClick={() => onChange(clearFacets(filter))}
        >
          <X className="size-3" />
          Clear {active}
        </Button>
      )}
    </div>
  )
}

/**
 * What the chip reads.
 *
 * The chosen value when there is exactly one, because "billing-api" is more
 * use than "Repo · 1" and is the common case. The facet's own name plus a count
 * past that, because two or more values do not fit and the count is the part
 * worth reading.
 */
function chipLabel(spec: FacetSpec, selected: string[]): string {
  if (selected.length === 0) return spec.label
  if (selected.length === 1) {
    const option = spec.options.find((candidate) => candidate.value === selected[0])
    return option?.label ?? spec.label
  }
  return `${spec.label} · ${selected.length}`
}
