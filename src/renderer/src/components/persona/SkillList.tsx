import { BookOpen } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { cn } from '@/lib/utils'
import { personaTemplates, skills } from '@/mocks'
import { useUiStore } from '@/store/useUiStore'

export function SkillList({ query }: { query: string }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedSkillId)
  const setSelectedId = useUiStore((state) => state.setSelectedSkillId)
  const needle = query.trim().toLowerCase()

  const visible = skills.filter(
    (skill) =>
      !needle ||
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle)
  )

  if (visible.length === 0) {
    return (
      <EmptyState
        compact
        icon={BookOpen}
        title="No skills match"
        description={`Nothing matching “${query.trim()}”.`}
      />
    )
  }

  return (
    <div className="flex flex-col">
      {visible.map((skill) => {
        const usedBy = personaTemplates.filter((persona) => persona.skillIds.includes(skill.id))
        const active = selectedId === skill.id
        return (
          <button
            key={skill.id}
            type="button"
            onClick={() => setSelectedId(skill.id)}
            className={cn(
              'flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left transition-colors',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
              active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            )}
          >
            <span className="truncate text-[13px] font-medium">{skill.name}</span>
            <span className="text-muted-foreground line-clamp-2 text-xs">{skill.description}</span>
            {/* Which personas use a skill is what makes deleting it risky, so
                it belongs on the row rather than one click deeper. */}
            {usedBy.length > 0 && (
              <span className="flex items-center gap-1 pt-0.5">
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
          </button>
        )
      })}
    </div>
  )
}
