import { useState } from 'react'
import { Check, Trash2, Users2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { CheckRow } from '@/components/common/CheckRow'
import { FieldGrid, FieldGridSpan } from '@/components/common/FieldGrid'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { PaneHeader } from '@/components/common/PaneHeader'
import { PaneBody } from '@/components/common/PaneBody'
import { Field } from '@/components/common/Field'
import { Section } from '@/components/common/Section'
import { useContacts } from '@/hooks/useConversations'
import { useDeletePersona, usePersonas, useUpdatePersona } from '@/hooks/usePersonas'
import { useModels } from '@/hooks/useModels'
import { useSkills } from '@/hooks/useSkills'
import { useUiStore } from '@/store/useUiStore'
import type {
  Contact,
  GithubScope,
  PersonaBackend,
  PersonaTemplate,
  SandboxLevel,
  Skill
} from '@/types'

/** Stands in for `model: null` — Select can't carry null as a value. */
const DEFAULT_MODEL = '__default__'

const BACKEND_OPTIONS: { value: PersonaBackend; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' }
]

const SANDBOX_OPTIONS: { value: SandboxLevel; label: string }[] = [
  { value: 'read_only', label: 'Read only' },
  { value: 'workspace_write', label: 'Write' },
  { value: 'full_access', label: 'Full' }
]

const GITHUB_SCOPE_OPTIONS: { value: GithubScope; label: string }[] = [
  { value: 'read_only', label: 'Read only' },
  { value: 'open_pr', label: 'Open PR' },
  { value: 'full_access', label: 'Full' }
]

function PersonaForm({
  persona,
  allSkills,
  boundContacts
}: {
  persona: PersonaTemplate
  allSkills: Skill[]
  boundContacts: Contact[]
}): React.JSX.Element {
  const [name, setName] = useState(persona.name)
  const [avatarColor, setAvatarColor] = useState(persona.avatarColor)
  const [backend, setBackend] = useState<PersonaBackend>(persona.backend)
  const [model, setModel] = useState<string | null>(persona.model)
  const availableModels = useModels(backend)
  // "Default" has to be expressible, since null — let the backend choose — is a
  // real and common answer rather than an unset field. A sentinel value is
  // needed because Select can't carry null.
  const modelItems = [
    { label: "Default (backend's choice)", value: DEFAULT_MODEL },
    ...availableModels.map((name) => ({ label: name, value: name }))
  ]
  const [systemPrompt, setSystemPrompt] = useState(persona.systemPrompt)
  const [sandbox, setSandbox] = useState<SandboxLevel>(persona.sandbox)
  const [githubScope, setGithubScope] = useState<GithubScope>(persona.githubScope)
  const [skillIds, setSkillIds] = useState<string[]>(persona.skillIds)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const setSelectedId = useUiStore((state) => state.setSelectedPersonaId)

  const { save, isPending: saving, error: saveError } = useUpdatePersona()
  const { remove, isPending: deleting, error: deleteError, reset } = useDeletePersona()

  const toggleSkill = (skillId: string): void => {
    setSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    )
  }

  const edited: PersonaTemplate = {
    ...persona,
    name,
    avatarColor,
    backend,
    model,
    systemPrompt,
    sandbox,
    githubScope,
    skillIds
  }
  const dirty = JSON.stringify(edited) !== JSON.stringify(persona)

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <PaneHeader
        leading={<AvatarColorSwatch name={name || persona.name} color={avatarColor} size="sm" />}
        title={name || 'Untitled persona'}
        actions={
          <>
            <BackendBadge backend={backend} />
            {/* Still no UsageBadge here, though real events exist as of Phase 6.
                Spend is per Contact, and a persona can be bound to several — a
                single figure here would be summing unlike things. The dashboard
                (Phase 10) is where cross-contact totals belong. */}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete persona"
              disabled={deleting}
              onClick={() => {
                reset()
                setConfirmingDelete(true)
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!dirty || saving}
              onClick={() => save(edited)}
            >
              <Check className="size-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      <PaneBody>
        {(saveError ?? deleteError) && (
          <p className="text-destructive text-xs">{saveError ?? deleteError}</p>
        )}

        <section className="flex flex-col gap-4">
          {/* Capped rather than stretched. A persona name is a dozen
              characters; giving it the full pane put its colour swatch a
              thousand pixels from the field it belongs to. */}
          <div className="flex max-w-md items-end gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="persona-name">Name</Label>
              <Input
                id="persona-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Code Reviewer"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="persona-color">Colour</Label>
              <input
                id="persona-color"
                type="color"
                value={avatarColor}
                onChange={(event) => setAvatarColor(event.target.value)}
                className="border-input h-8 w-12 cursor-pointer rounded-lg border bg-transparent p-1"
              />
            </div>
          </div>

          <FieldGrid>
            <Field label="Backend" hint="Codex streams live tool progress; Claude cannot.">
              <SegmentedControl
                options={BACKEND_OPTIONS}
                value={backend}
                onChange={(next) => {
                  setBackend(next)
                  // A model belongs to one backend, so carrying the old
                  // choice across would fail every turn. Clearing to the
                  // default fails at edit time instead, which is a much
                  // better place to find out.
                  setModel(null)
                }}
                aria-label="Backend"
              />
            </Field>

            <Field label="Model" hint="Availability depends on your account, not just the backend.">
              <Select
                value={model ?? DEFAULT_MODEL}
                onValueChange={(value) => setModel(value === DEFAULT_MODEL ? null : String(value))}
                items={modelItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>

          {/* Spans, and caps itself: this is the one control in the pane that
              is long-form prose, and a full-width textarea on a wide window is
              a worse place to write than the narrow column it replaced. */}
          <FieldGridSpan>
            <Field label="System prompt" htmlFor="persona-prompt">
              <Textarea
                id="persona-prompt"
                rows={5}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="You are a meticulous code reviewer…"
              />
            </Field>
          </FieldGridSpan>
        </section>

        <Section
          title="Permissions"
          description="Two independent axes: what this persona can touch on disk, and what it can do on GitHub."
        >
          <FieldGrid>
            <Field label="Sandbox">
              <SegmentedControl
                options={SANDBOX_OPTIONS}
                value={sandbox}
                onChange={setSandbox}
                aria-label="Sandbox level"
              />
              <ScopeChip axis="sandbox" value={sandbox} className="self-start" />
            </Field>
            <Field label="GitHub scope">
              <SegmentedControl
                options={GITHUB_SCOPE_OPTIONS}
                value={githubScope}
                onChange={setGithubScope}
                aria-label="GitHub scope"
              />
              <ScopeChip axis="github" value={githubScope} className="self-start" />
            </Field>
          </FieldGrid>
        </Section>

        <Section
          title="Skills"
          description="Reusable instructions injected into every session this persona starts."
        >
          {/* Three across on a wide pane. Each entry is a name and one line of
              description, so a single column left this list running down the
              middle of the window no matter how much room there was. */}
          <FieldGrid columns={3} className="gap-1.5">
            {allSkills.map((skill) => (
              <CheckRow
                key={skill.id}
                checked={skillIds.includes(skill.id)}
                onToggle={() => toggleSkill(skill.id)}
                title={skill.name}
                description={skill.description}
              />
            ))}
          </FieldGrid>
        </Section>

        <Section title="Bound contacts">
          {boundContacts.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Not bound to a repo yet. Create a contact to put this persona to work.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {boundContacts.map((contact) => (
                <li
                  key={contact.id}
                  className="border-border flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <span className="truncate font-mono text-xs">{contact.repoPath}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-meta">
                    {contact.backendSessionId ?? 'no session yet'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PaneBody>

      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${persona.name}”?`}
        // Main refuses outright while contacts are bound, so this branch is a
        // heads-up rather than the real gate — the authoritative check and its
        // message come back from the service.
        description={
          boundContacts.length === 0
            ? 'This removes the persona and its instructions. Skills it attaches are untouched.'
            : `${boundContacts.length} contact${boundContacts.length === 1 ? ' is' : 's are'} still bound to it, so this will be refused.`
        }
        onConfirm={() => remove(persona.id, () => setSelectedId(null))}
      />
    </div>
  )
}

export function PersonaDetailPanel(): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedPersonaId)
  const { data: personaTemplates = [] } = usePersonas()
  const { data: allSkills = [] } = useSkills()
  const { data: contacts = [] } = useContacts()
  const persona = personaTemplates.find((p) => p.id === selectedId)

  if (!persona) {
    return (
      <EmptyPane
        icon={Users2}
        title="No persona selected"
        description="A persona is a system prompt, a set of skills, and a permission scope. Pick one to edit it."
      />
    )
  }

  // Keyed on the persona id so switching selection remounts the form. The
  // previous revision initialised state from props once and never re-synced,
  // so editing one persona then opening another showed the first one's values.
  return (
    <PersonaForm
      key={persona.id}
      persona={persona}
      allSkills={allSkills}
      boundContacts={contacts.filter((c) => c.personaTemplateId === persona.id)}
    />
  )
}
