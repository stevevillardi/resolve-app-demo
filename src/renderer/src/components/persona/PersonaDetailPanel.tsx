import { useState } from 'react'
import { Check, FolderGit2, Trash2, Users2, Dices } from 'lucide-react'
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
import { ClaudeMark, CodexMark } from '@/components/brand/BrandMarks'
import { CheckRow } from '@/components/common/CheckRow'
import { ListRow } from '@/components/common/ListRow'
import { FieldGrid, FieldGridSpan } from '@/components/common/FieldGrid'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { mcpReach, mcpServerChoices, toggleMcpServer } from '@/lib/capability-view'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { PaneHeader } from '@/components/common/PaneHeader'
import { PaneBody } from '@/components/common/PaneBody'
import { Field } from '@/components/common/Field'
import { Section } from '@/components/common/Section'
import { repoName } from '@/lib/format'
import { useContacts } from '@/hooks/useConversations'
import { useDeletePersona, usePersonas, useUpdatePersona } from '@/hooks/usePersonas'
import { useModels } from '@/hooks/useModels'
import { useSkills } from '@/hooks/useSkills'
import { useUiStore } from '@/store/useUiStore'
import { cn } from '@/lib/utils'
import type {
  Contact,
  GithubScope,
  PersonaBackend,
  PersonaTemplate,
  SandboxLevel,
  Skill
} from '@/types'

/** Stands in for `model: null` — Select can't carry null as a value. */
/** The seed palette (chart colours + the optional tier's hues). */
const PALETTE_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#8a63d2',
  '#0f9bab',
  '#c14953'
] as const

/**
 * A random hue at fixed saturation/lightness, so the die never rolls a colour
 * the initials/bot tint can't survive — full-random RGB lands on near-white
 * and near-black often enough to matter.
 */
function randomAvatarColor(): string {
  const h = Math.floor(Math.random() * 360)
  const s = 0.62
  const l = 0.5
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

const DEFAULT_MODEL = '__default__'

// The only segmented control in the app whose options name a *thing* rather
// than a level, which is why it is the only one carrying icons.
const BACKEND_OPTIONS = [
  { value: 'claude', label: 'Claude', icon: ClaudeMark },
  { value: 'codex', label: 'Codex', icon: CodexMark }
] as const satisfies readonly { value: PersonaBackend; label: string; icon: unknown }[]

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
  const [mcpServerIds, setMcpServerIds] = useState<string[]>(persona.mcpServerIds)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const setSelectedId = useUiStore((state) => state.setSelectedPersonaId)
  const setSection = useUiStore((state) => state.setSection)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)

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
    skillIds,
    // Named explicitly, not left to the spread above. `...persona` round-trips
    // the stored value, so omitting it here would let the checklist change on
    // screen while `dirty` stayed false and Save stayed disabled.
    mcpServerIds
  }
  const dirty = JSON.stringify(edited) !== JSON.stringify(persona)

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <PaneHeader
        leading={
          <AvatarColorSwatch
            name={name || persona.name}
            color={avatarColor}
            seed={persona.id}
            size="sm"
          />
        }
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
              <div className="flex items-center gap-1.5">
                {/* The seed palette, one click each — it is CVD-validated as a
                    set, and reaching it should not require a colour picker.
                    The native input stays for anything off-palette, and the
                    die rolls a random tasteful hue. The bot in the header
                    re-tints live either way. */}
                {PALETTE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Use ${color}`}
                    onClick={() => setAvatarColor(color)}
                    className={cn(
                      'size-5 rounded-md border transition-transform hover:scale-110',
                      avatarColor.toLowerCase() === color
                        ? 'border-foreground'
                        : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Random colour"
                  onClick={() => setAvatarColor(randomAvatarColor())}
                >
                  <Dices className="size-4" />
                </Button>
                <input
                  id="persona-color"
                  type="color"
                  value={avatarColor}
                  onChange={(event) => setAvatarColor(event.target.value)}
                  className="border-input h-8 w-12 cursor-pointer rounded-lg border bg-transparent p-1"
                />
              </div>
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
          description="Three independent axes: what this persona can touch on disk, what it can do on GitHub, and whether it can reach anything off this machine at all."
        >
          <FieldGrid>
            <Field label="Sandbox">
              <SegmentedControl
                options={SANDBOX_OPTIONS}
                value={sandbox}
                onChange={(value) => {
                  setSandbox(value)
                  // full_access bypasses the tools that enforce a narrower
                  // GitHub scope, so main refuses the pair — mirror that here
                  // rather than letting Save be the first thing that says so.
                  if (value === 'full_access') setGithubScope('full_access')
                }}
                aria-label="Sandbox level"
              />
              <ScopeChip axis="sandbox" value={sandbox} className="self-start" />
            </Field>
            <Field label="GitHub scope">
              {sandbox === 'full_access' ? (
                /* Not a disabled control: there is no choice to make. With a
                   full sandbox neither the MCP tool filter nor the shell guard
                   runs, so any narrower scope would be a label, not a limit. */
                <p className="text-muted-foreground text-xs text-pretty">
                  Full sandbox access implies full GitHub scope — nothing narrower is enforceable
                  there.
                </p>
              ) : (
                <SegmentedControl
                  options={GITHUB_SCOPE_OPTIONS}
                  value={githubScope}
                  onChange={setGithubScope}
                  aria-label="GitHub scope"
                />
              )}
              <ScopeChip axis="github" value={githubScope} className="self-start" />
            </Field>
          </FieldGrid>

          {/*
            The third axis. Not a SegmentedControl like the two above, because
            this one is a set rather than a level — a persona holds some servers
            or none, and the registry is closed (see src/shared/mcp.ts).

            "Tools" rather than "Skills" in the copy, deliberately. A Skill in
            this app is injected prose; what a server provides is an executable
            capability the model invokes. The two share a word elsewhere in the
            product and this screen must not blur them.
          */}
          <Field label="Tools">
            <div className="flex flex-col gap-2">
              {mcpServerChoices(mcpServerIds).map((server) => (
                <CheckRow
                  key={server.id}
                  checked={server.granted}
                  onToggle={() => setMcpServerIds((prev) => toggleMcpServer(prev, server.id))}
                  title={server.label}
                  description={
                    <>
                      {server.description}{' '}
                      {/*
                        Says what actually narrows it. Ticking this grants
                        nothing the GitHub scope above does not already allow,
                        and without this the checkbox reads as the whole
                        decision.
                      */}
                      <span className="text-muted-foreground/80">
                        Limited by this persona’s {server.governedBy}.
                      </span>
                    </>
                  }
                />
              ))}
            </div>
            <ScopeChip axis="mcp" value={mcpReach(mcpServerIds)} className="self-start" />
          </Field>
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
            /*
              Was a full absolute repo path against a raw `backendSessionId` —
              a 36-character opaque id that answers no question anyone has, next
              to 80 characters of path saying what its last segment says. Now:
              where it works, how it is isolated, and a way to actually go
              there, which is what you wanted when you read the list.
            */
            <FieldGrid columns={3} className="gap-1.5">
              {boundContacts.map((contact) => (
                <ListRow
                  key={contact.id}
                  active={false}
                  align="center"
                  bordered
                  leading={<FolderGit2 className="text-muted-foreground size-4 shrink-0" />}
                  onSelect={() => {
                    setSelectedConversation({ kind: 'contact', id: contact.id })
                    setSection('chats')
                  }}
                  trailing={
                    <span className="text-muted-foreground shrink-0 text-meta">
                      {contact.isolation === 'worktree' ? 'own checkout' : 'your checkout'}
                    </span>
                  }
                >
                  <span className="block truncate text-row" title={contact.repoPath}>
                    {repoName(contact.repoPath)}
                  </span>
                </ListRow>
              ))}
            </FieldGrid>
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
        {...(boundContacts.length > 0
          ? {
              // The doc-16 side-by-side read: the skill dialog names what a
              // delete touches, so this one names what blocks it.
              consequence: (
                <ul className="flex flex-col gap-0.5">
                  {boundContacts.map((contact) => (
                    <li key={contact.id} className="truncate">
                      {contact.displayName}
                    </li>
                  ))}
                </ul>
              )
            }
          : {})}
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
