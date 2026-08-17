import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useApplyStarterSelection, useSeedCatalog } from '@/hooks/useSeed'
import { PersonaCatalogGrid, SkillCatalogList } from './StarterCatalogPicker'

/**
 * The starter catalog, after onboarding (Phase 17). This is the durable
 * re-entry point — the onboarding chooser is one-shot and the
 * `onboarding_completed` flag is never cleared, so anyone who skipped setup or
 * later wants Bug Hunter reaches the same picker here.
 *
 * Post-onboarding, the defaults are what is *installed* (not what is
 * recommended): the dialog edits reality, and reality is what the user has
 * kept. Unchecking removes only where removal is safe — main refuses to
 * strand a bound contact or strip an attached Skill (services/seed.ts).
 */
export function StarterLibraryDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  // Content is mounted per opening, so stale picks never greet the next visit
  // and no reset bookkeeping exists to forget.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <StarterLibraryContent onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function StarterLibraryContent({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { data: catalog } = useSeedCatalog()
  const { apply, isPending, error } = useApplyStarterSelection()
  const [personaOverrides, setPersonaOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [skillOverrides, setSkillOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())

  const personaSelected = (id: string): boolean =>
    personaOverrides.get(id) ?? Boolean(catalog?.personas.find((p) => p.entry.id === id)?.installed)
  const skillSelected = (id: string): boolean =>
    skillOverrides.get(id) ?? Boolean(catalog?.skills.find((s) => s.entry.id === id)?.installed)

  const requiredBy = new Map<string, string>()
  for (const { entry } of catalog?.personas ?? []) {
    if (!personaSelected(entry.id)) continue
    for (const skillId of entry.skillIds) {
      if (!requiredBy.has(skillId)) requiredBy.set(skillId, entry.name)
    }
  }

  const applySelection = (): void => {
    if (!catalog) return
    apply(
      catalog.personas.map(({ entry }) => entry.id).filter(personaSelected),
      catalog.skills
        .map(({ entry }) => entry.id)
        .filter((id) => skillSelected(id) || requiredBy.has(id)),
      () => {
        toast('Starter library updated')
        onClose()
      }
    )
  }

  return (
    <DialogContent className="@container/pane flex max-h-[85vh] flex-col sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Starter library</DialogTitle>
        <DialogDescription>
          Add or remove the built-in personas and Skills. Anything a contact depends on stays put.
        </DialogDescription>
      </DialogHeader>

      {catalog ? (
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 py-1">
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Personas
            </p>
            <PersonaCatalogGrid
              catalog={catalog}
              isSelected={personaSelected}
              onToggle={(id) =>
                setPersonaOverrides(new Map(personaOverrides).set(id, !personaSelected(id)))
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Skills
            </p>
            <SkillCatalogList
              catalog={catalog}
              isSelected={skillSelected}
              onToggle={(id) =>
                setSkillOverrides(new Map(skillOverrides).set(id, !skillSelected(id)))
              }
              requiredBy={requiredBy}
            />
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          Loading the starter catalog…
        </p>
      )}

      {error && <p className="text-destructive text-sm text-pretty">{error}</p>}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={applySelection} disabled={isPending || !catalog}>
          {isPending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
          Apply
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
