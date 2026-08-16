import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { UsageBadge } from '@/components/usage/UsageBadge'
import { skills as allSkills } from '@/mocks'
import { usageForContact } from '@/lib/usage'
import { usageEvents, contacts } from '@/mocks'
import type { GithubScope, PersonaBackend, PersonaTemplate, SandboxLevel } from '@/types'

interface PersonaDetailPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  persona?: PersonaTemplate
}

const BACKEND_OPTIONS: { value: PersonaBackend; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' }
]

const SANDBOX_OPTIONS: { value: SandboxLevel; label: string }[] = [
  { value: 'read_only', label: 'Read only' },
  { value: 'workspace_write', label: 'Workspace write' },
  { value: 'full_access', label: 'Full access' }
]

const GITHUB_SCOPE_OPTIONS: { value: GithubScope; label: string }[] = [
  { value: 'read_only', label: 'Read only' },
  { value: 'open_pr', label: 'Open PR' },
  { value: 'full_access', label: 'Full access' }
]

export function PersonaDetailPanel({
  open,
  onOpenChange,
  persona
}: PersonaDetailPanelProps): React.JSX.Element {
  const [name, setName] = useState(persona?.name ?? '')
  const [avatarColor, setAvatarColor] = useState(persona?.avatarColor ?? '#4c4ddc')
  const [backend, setBackend] = useState<PersonaBackend>(persona?.backend ?? 'claude')
  const [systemPrompt, setSystemPrompt] = useState(persona?.systemPrompt ?? '')
  const [sandbox, setSandbox] = useState<SandboxLevel>(persona?.sandbox ?? 'read_only')
  const [githubScope, setGithubScope] = useState<GithubScope>(persona?.githubScope ?? 'read_only')
  const [skillIds, setSkillIds] = useState<string[]>(persona?.skillIds ?? [])

  const toggleSkill = (skillId: string): void => {
    setSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    )
  }

  const boundContacts = persona ? contacts.filter((c) => c.personaTemplateId === persona.id) : []
  const totalUsage = boundContacts.reduce(
    (acc, contact) => {
      const summary = usageForContact(usageEvents, contact.id)
      return {
        totalCostUsd: (acc.totalCostUsd ?? 0) + (summary.totalCostUsd ?? 0),
        totalInputTokens: acc.totalInputTokens + summary.totalInputTokens,
        totalOutputTokens: acc.totalOutputTokens + summary.totalOutputTokens
      }
    },
    { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0 }
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{persona ? 'Edit persona' : 'New persona'}</SheetTitle>
          <SheetDescription>
            Reusable template bound to a repo when creating a contact.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex items-center gap-3">
            <AvatarColorSwatch name={name || 'New Persona'} color={avatarColor} size="lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="persona-name">
                Name
              </label>
              <Input
                id="persona-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Code Reviewer"
              />
            </div>
            <input
              type="color"
              aria-label="Avatar color"
              value={avatarColor}
              onChange={(e) => setAvatarColor(e.target.value)}
              className="border-input size-8 shrink-0 cursor-pointer rounded-md border p-0.5"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Backend</span>
            <SegmentedControl options={BACKEND_OPTIONS} value={backend} onChange={setBackend} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="persona-prompt">
              System prompt
            </label>
            <Textarea
              id="persona-prompt"
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a meticulous code reviewer…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Skills</span>
            <div className="flex flex-col gap-1.5">
              {allSkills.map((skill) => (
                <label key={skill.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={skillIds.includes(skill.id)}
                    onChange={() => toggleSkill(skill.id)}
                  />
                  <span>
                    <span className="font-medium">{skill.name}</span>
                    <span className="text-muted-foreground block text-xs">{skill.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Sandbox</span>
            <SegmentedControl options={SANDBOX_OPTIONS} value={sandbox} onChange={setSandbox} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">GitHub scope</span>
            <SegmentedControl
              options={GITHUB_SCOPE_OPTIONS}
              value={githubScope}
              onChange={setGithubScope}
            />
          </div>

          {persona && (
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-muted-foreground text-xs">Usage across bound contacts</span>
              <UsageBadge summary={totalUsage} />
            </div>
          )}
        </div>
        <SheetFooter>
          <Button onClick={() => onOpenChange(false)}>Save persona</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
