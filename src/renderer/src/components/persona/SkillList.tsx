import { useState } from 'react'
import { BookOpen, Trash2 } from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { usePersonas } from '@/hooks/usePersonas'
import { useDeleteSkill, useSkills } from '@/hooks/useSkills'
import { useUiStore } from '@/store/useUiStore'
import { filterList, isFiltering, noMatchDescription, type ListFilter } from '@/lib/list-filter'
import { FACET_STATE, STATE_ATTACHED, STATE_UNATTACHED } from '@/lib/section-facets'
import type { PersonaTemplate, Skill } from '@/types'

/** Right-click delete for a skill row — the same dialog and copy as the
 * library editor's trash icon, consequence included: deleting a skill doesn't
 * block, it silently detaches, so the affected personas are named up front. */
function SkillRowMenu({
  skill,
  usedBy
}: {
  skill: Skill
  usedBy: PersonaTemplate[]
}): React.JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const selectedId = useUiStore((state) => state.selectedSkillId)
  const setSelectedId = useUiStore((state) => state.setSelectedSkillId)
  const { remove } = useDeleteSkill()

  return (
    <>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
          <Trash2 />
          Delete skill…
        </ContextMenuItem>
      </ContextMenuContent>

      {confirmingDelete && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && setConfirmingDelete(false)}
          title={`Delete “${skill.name}”?`}
          description={
            usedBy.length === 0
              ? 'No persona attaches this skill, so nothing else changes.'
              : `${usedBy.length === 1 ? 'This persona attaches' : 'These personas attach'} it and will silently lose those instructions.`
          }
          {...(usedBy.length > 0
            ? {
                consequence: (
                  <ul className="flex flex-col gap-0.5">
                    {usedBy.map((persona) => (
                      <li key={persona.id} className="truncate">
                        {persona.name}
                      </li>
                    ))}
                  </ul>
                )
              }
            : {})}
          onConfirm={() =>
            remove(skill.id, () => {
              setConfirmingDelete(false)
              if (selectedId === skill.id) setSelectedId(null)
            })
          }
        />
      )}
    </>
  )
}

export function SkillList({ filter }: { filter: ListFilter }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedSkillId)
  const setSelectedId = useUiStore((state) => state.setSelectedSkillId)
  const { data: skills = [], isPending } = useSkills()
  const { data: personaTemplates = [] } = usePersonas()
  const filtering = isFiltering(filter)

  const attached = new Set(personaTemplates.flatMap((persona) => persona.skillIds))

  const visible = filterList(
    skills,
    filter,
    {
      // "Unused" is the question worth asking of a library that only grows:
      // a skill no persona carries is instruction text nothing ever sends.
      [FACET_STATE]: (skill) => [attached.has(skill.id) ? STATE_ATTACHED : STATE_UNATTACHED]
    },
    (skill) => ({ label: skill.name, detail: skill.description })
  )

  if (isPending) {
    return <EmptyState compact loading title="Loading skills…" />
  }

  if (visible.length === 0) {
    return filtering ? (
      <EmptyState
        compact
        icon={BookOpen}
        title="No skills match"
        description={noMatchDescription(filter)}
      />
    ) : (
      <EmptyState
        compact
        icon={BookOpen}
        title="No skills yet"
        description="A skill is reusable instruction text any persona can attach. Add one to get started."
      />
    )
  }

  return (
    <div className="flex flex-col">
      {visible.map((skill) => {
        const usedBy = personaTemplates.filter((persona) => persona.skillIds.includes(skill.id))
        const active = selectedId === skill.id
        return (
          <ListRow
            key={skill.id}
            active={active}
            onSelect={() => setSelectedId(skill.id)}
            contextMenu={<SkillRowMenu skill={skill} usedBy={usedBy} />}
          >
            <span className="block truncate text-row font-medium">{skill.name}</span>
            <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs">
              {skill.description}
            </span>
            {/* Which personas use a skill is what makes deleting it risky, so
                it belongs on the row rather than one click deeper. */}
            {usedBy.length > 0 && (
              <span className="mt-1 flex items-center gap-1">
                {usedBy.map((persona) => (
                  <span
                    key={persona.id}
                    title={persona.name}
                    aria-hidden
                    className="size-2 rounded-[3px]"
                    style={{ backgroundColor: persona.avatarColor }}
                  />
                ))}
                <span className="text-muted-foreground text-meta">
                  {usedBy.length} {usedBy.length === 1 ? 'persona' : 'personas'}
                </span>
              </span>
            )}
          </ListRow>
        )
      })}
    </div>
  )
}
