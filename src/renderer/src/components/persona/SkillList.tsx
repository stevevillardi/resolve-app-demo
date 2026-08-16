import { BookOpen } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { usePersonas } from '@/hooks/usePersonas'
import { useSkills } from '@/hooks/useSkills'
import { useUiStore } from '@/store/useUiStore'

export function SkillList({ query }: { query: string }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedSkillId)
  const setSelectedId = useUiStore((state) => state.setSelectedSkillId)
  const { data: skills = [], isPending } = useSkills()
  const { data: personaTemplates = [] } = usePersonas()
  const needle = query.trim().toLowerCase()

  const visible = skills.filter(
    (skill) =>
      !needle ||
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle)
  )

  if (isPending) {
    return <EmptyState compact loading title="Loading skills…" />
  }

  if (visible.length === 0) {
    return needle ? (
      <EmptyState
        compact
        icon={BookOpen}
        title="No skills match"
        description={`Nothing matching “${query.trim()}”.`}
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
          <ListRow key={skill.id} active={active} onSelect={() => setSelectedId(skill.id)}>
            <span className="block truncate text-[13px] font-medium">{skill.name}</span>
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
                <span className="text-muted-foreground text-[11px]">
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
