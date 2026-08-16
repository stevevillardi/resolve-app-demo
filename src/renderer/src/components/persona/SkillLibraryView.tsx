import { useState } from 'react'
import { BookOpen, Trash2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/common/EmptyState'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { usePersonas } from '@/hooks/usePersonas'
import { useDeleteSkill, useSkills, useUpdateSkill } from '@/hooks/useSkills'
import { useUiStore } from '@/store/useUiStore'
import type { PersonaTemplate, Skill } from '@/types'

function SkillForm({
  skill,
  personaTemplates
}: {
  skill: Skill
  personaTemplates: PersonaTemplate[]
}): React.JSX.Element {
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description)
  const [content, setContent] = useState(skill.content)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const setSelectedId = useUiStore((state) => state.setSelectedSkillId)

  const { save, isPending: saving, error: saveError } = useUpdateSkill()
  const { remove, isPending: deleting, error: deleteError } = useDeleteSkill()

  const usedBy = personaTemplates.filter((persona) => persona.skillIds.includes(skill.id))
  const dirty =
    name !== skill.name || description !== skill.description || content !== skill.content

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <header className="border-border drag-region flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
        <BookOpen className="text-muted-foreground size-4 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {name || 'Untitled skill'}
        </h1>
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            disabled={deleting}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={() => save({ ...skill, name, description, content })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 p-5">
          {(saveError ?? deleteError) && (
            <p className="text-destructive text-xs">{saveError ?? deleteError}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-name">Name</Label>
            <Input id="skill-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Shown when picking skills for a persona. One line.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-content">Instructions</Label>
            <Textarea
              id="skill-content"
              rows={14}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="font-mono text-[12.5px] leading-relaxed"
            />
            <p className="text-muted-foreground text-xs">
              Markdown, injected verbatim into every session that attaches this skill.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Used by</h2>
            {usedBy.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No persona attaches this skill yet — editing it affects nothing.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {usedBy.map((persona) => (
                  <li
                    key={persona.id}
                    className="border-border flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1"
                  >
                    <AvatarColorSwatch name={persona.name} color={persona.avatarColor} size="xs" />
                    <span className="text-xs">{persona.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </ScrollArea>

      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${skill.name}”?`}
        // Naming the affected personas matters more than the count: deleting a
        // skill doesn't block, it silently detaches, so this is the only place
        // the consequence is visible before it happens.
        description={
          usedBy.length === 0
            ? 'No persona attaches this skill, so nothing else changes.'
            : `${usedBy.length === 1 ? 'This persona attaches' : 'These personas attach'} it and will lose those instructions: ${usedBy.map((p) => p.name).join(', ')}.`
        }
        onConfirm={() => remove(skill.id, () => setSelectedId(null))}
      />
    </div>
  )
}

export function SkillLibraryView(): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedSkillId)
  const { data: skills = [] } = useSkills()
  const { data: personaTemplates = [] } = usePersonas()
  const skill = skills.find((s) => s.id === selectedId)

  if (!skill) {
    return (
      <div className="bg-background flex h-full flex-col">
        <div className="drag-region h-12 shrink-0" />
        <EmptyState
          icon={BookOpen}
          title="No skill selected"
          description="Skills are reusable instructions any persona can attach. Pick one to read or edit it."
        />
      </div>
    )
  }

  // Keyed so switching skills resets the form rather than showing the previous
  // one's values — the same stale-state bug the persona editor had.
  return <SkillForm key={skill.id} skill={skill} personaTemplates={personaTemplates} />
}
