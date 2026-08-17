import { useState } from 'react'
import { BookOpen, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyPane } from '@/components/common/EmptyPane'
import { PaneHeader } from '@/components/common/PaneHeader'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { usePersonas } from '@/hooks/usePersonas'
import { useDeleteSkill, useSkills, useUpdateSkill } from '@/hooks/useSkills'
import { useUiStore } from '@/store/useUiStore'
import type { PersonaTemplate, Skill } from '@/types'

/**
 * The skill editor.
 *
 * Unlike every other workspace view this is not a form — it is one long-form
 * writing surface with two metadata fields attached. So it deliberately opts
 * out of PaneBody: the instructions field claims all remaining height instead
 * of sitting at a fixed `rows` inside a scrolling column, which previously left
 * a third of the pane empty on any reasonably sized window.
 */
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
    // Declares `@container/pane` itself, because this is the one view that
    // opts out of PaneBody — which is where every other pane gets it.
    <div className="@container/pane bg-background flex h-full min-h-0 flex-col">
      <PaneHeader
        leading={<BookOpen className="text-muted-foreground size-4 shrink-0" />}
        title={name || 'Untitled skill'}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete skill"
              disabled={deleting}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!dirty || saving}
              onClick={() => save({ ...skill, name, description, content })}
            >
              <Check className="size-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      {(saveError ?? deleteError) && (
        <p className="text-destructive border-border shrink-0 border-b px-5 py-2 text-xs">
          {saveError ?? deleteError}
        </p>
      )}

      {/* Metadata band. Name and description describe the skill; the
          instructions below are the skill. Keeping them on one row stops two
          short strings from consuming the top third of a writing surface. */}
      <div className="border-border grid shrink-0 grid-cols-1 gap-4 border-b px-5 py-4 @2xl/pane:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
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
            placeholder="Shown when picking skills for a persona. One line."
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-5 pt-4 pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="skill-content">Instructions</Label>
          <span className="text-muted-foreground font-mono text-meta tabular-nums">
            {content.length.toLocaleString()} chars
          </span>
        </div>
        <textarea
          id="skill-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          placeholder="Write what this skill should tell a persona to do…"
          className="border-input bg-background scrollbar-subtle focus-visible:border-ring focus-visible:ring-ring/40 placeholder:text-muted-foreground min-h-0 flex-1 resize-none rounded-lg border p-3 font-mono text-code leading-relaxed outline-none focus-visible:ring-2"
        />
        <p className="text-muted-foreground text-xs">
          Markdown, injected verbatim into every session that attaches this skill.
        </p>
      </div>

      {/* Who is affected stays pinned in view while you edit — this is the only
          place the consequence of a change is visible before it happens. */}
      <div className="border-border flex shrink-0 flex-wrap items-center gap-1.5 border-t px-5 py-2.5">
        <span className="text-muted-foreground text-xs">Used by</span>
        {usedBy.length === 0 ? (
          <span className="text-muted-foreground text-xs">
            no persona yet — editing this affects nothing.
          </span>
        ) : (
          usedBy.map((persona) => (
            <span
              key={persona.id}
              className="border-border flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1"
            >
              <AvatarColorSwatch
                name={persona.name}
                color={persona.avatarColor}
                seed={persona.id}
                size="xs"
              />
              <span className="text-xs">{persona.name}</span>
            </span>
          ))
        )}
      </div>

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
      <EmptyPane
        icon={BookOpen}
        title="No skill selected"
        description="Skills are reusable instructions any persona can attach. Pick one to read or edit it."
      />
    )
  }

  // Keyed so switching skills resets the form rather than showing the previous
  // one's values — the same stale-state bug the persona editor had.
  return <SkillForm key={skill.id} skill={skill} personaTemplates={personaTemplates} />
}
