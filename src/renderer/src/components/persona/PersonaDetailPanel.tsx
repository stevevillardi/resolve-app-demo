import { useState } from 'react'
import { Check, Users2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { UsageBadge } from '@/components/usage/UsageBadge'
import { usageForContacts } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { contacts, personaTemplates, skills as allSkills, usageEvents } from '@/mocks'
import { useUiStore } from '@/store/useUiStore'
import type { GithubScope, PersonaBackend, PersonaTemplate, SandboxLevel } from '@/types'

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

function Field({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}

function PersonaForm({ persona }: { persona: PersonaTemplate }): React.JSX.Element {
  const [name, setName] = useState(persona.name)
  const [avatarColor, setAvatarColor] = useState(persona.avatarColor)
  const [backend, setBackend] = useState<PersonaBackend>(persona.backend)
  const [systemPrompt, setSystemPrompt] = useState(persona.systemPrompt)
  const [sandbox, setSandbox] = useState<SandboxLevel>(persona.sandbox)
  const [githubScope, setGithubScope] = useState<GithubScope>(persona.githubScope)
  const [skillIds, setSkillIds] = useState<string[]>(persona.skillIds)

  const toggleSkill = (skillId: string): void => {
    setSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    )
  }

  const boundContacts = contacts.filter((c) => c.personaTemplateId === persona.id)
  const usage = usageForContacts(
    usageEvents,
    boundContacts.map((c) => c.id)
  )

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <header className="border-border drag-region flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
        <AvatarColorSwatch name={name || persona.name} color={avatarColor} size="sm" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {name || 'Untitled persona'}
        </h1>
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          <BackendBadge backend={backend} />
          <UsageBadge summary={usage} />
          <Button size="sm">Save</Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 p-5">
          <section className="flex flex-col gap-4">
            <div className="flex items-end gap-3">
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

            <Field label="Backend" hint="Codex streams live tool progress; Claude cannot.">
              <SegmentedControl
                options={BACKEND_OPTIONS}
                value={backend}
                onChange={setBackend}
                aria-label="Backend"
                className="w-56"
              />
            </Field>

            <Field label="System prompt" htmlFor="persona-prompt">
              <Textarea
                id="persona-prompt"
                rows={5}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="You are a meticulous code reviewer…"
              />
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Permissions</h2>
              <p className="text-muted-foreground text-xs">
                Two independent axes: what this persona can touch on disk, and what it can do on
                GitHub.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Skills</h2>
              <p className="text-muted-foreground text-xs">
                Reusable instructions injected into every session this persona starts.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              {allSkills.map((skill) => {
                const checked = skillIds.includes(skill.id)
                return (
                  <button
                    key={skill.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleSkill(skill.id)}
                    className={cn(
                      'border-border flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                      'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
                      checked ? 'bg-accent border-accent' : 'hover:bg-accent/40'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-input'
                      )}
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{skill.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {skill.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Bound contacts</h2>
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
                    <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                      {contact.backendSessionId ?? 'no session yet'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

export function PersonaDetailPanel(): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedPersonaId)
  const persona = personaTemplates.find((p) => p.id === selectedId)

  if (!persona) {
    return (
      <div className="bg-background flex h-full flex-col">
        <div className="drag-region h-12 shrink-0" />
        <EmptyState
          icon={Users2}
          title="No persona selected"
          description="A persona is a system prompt, a set of skills, and a permission scope. Pick one to edit it."
        />
      </div>
    )
  }

  // Keyed on the persona id so switching selection remounts the form. The
  // previous revision initialised state from props once and never re-synced,
  // so editing one persona then opening another showed the first one's values.
  return <PersonaForm key={persona.id} persona={persona} />
}
