import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field } from '@/components/common/Field'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { useCreatePersona } from '@/hooks/usePersonas'
import { useModels } from '@/hooks/useModels'
import { askBeforeWritesSupported } from '../../../../shared/domain'
import type { GithubScope, PersonaBackend, PersonaTemplate, SandboxLevel } from '@/types'

/**
 * Making a persona without leaving the new-contact flow.
 *
 * Without this the flow's first step is a list with no way to add to it, so a
 * user who does not want any of the seeded three has to cancel, go to Personas,
 * discover that "new persona" means creating a blank draft and editing it,
 * save, then start the contact again from ⌘N. Four steps of detour to answer
 * the first question the app asks.
 *
 * Deliberately *not* the full editor. Skills, MCP servers and the model's finer
 * settings all belong there and none of them are needed to make a valid
 * persona; duplicating that panel into a dialog would produce two forms to keep
 * in step, and the second one would lose. This asks for the five fields
 * `personaTemplateDraftSchema` requires and hands off — the created persona is
 * selected in the flow, and the full editor is a rail away for the rest.
 */

const BACKEND_OPTIONS: { value: PersonaBackend; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' }
]

// The same wording the persona editor uses, so a persona made here and one made
// there are described identically.
const SANDBOX_OPTIONS: { value: SandboxLevel; label: string }[] = [
  { value: 'read_only', label: 'Read only' },
  { value: 'ask_writes', label: 'Ask to write' },
  { value: 'workspace_write', label: 'Write' },
  { value: 'full_access', label: 'Full' }
]

const SCOPE_OPTIONS: { value: GithubScope; label: string }[] = [
  { value: 'read_only', label: 'Read only' },
  { value: 'open_pr', label: 'Open PR' },
  { value: 'full_access', label: 'Full' }
]

const DEFAULT_MODEL = '__default__'

export function QuickPersonaDialog({
  open,
  onCreated,
  onClose
}: {
  open: boolean
  onCreated: (persona: PersonaTemplate) => void
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [backend, setBackend] = useState<PersonaBackend>('claude')
  const [model, setModel] = useState<string | null>(null)
  const [sandbox, setSandbox] = useState<SandboxLevel>('read_only')
  const [githubScope, setGithubScope] = useState<GithubScope>('read_only')
  const [systemPrompt, setSystemPrompt] = useState('')

  const models = useModels(backend)
  const { create, isPending, error } = useCreatePersona()

  /**
   * `requireScopePairing` refuses full sandbox access alongside a narrower
   * GitHub scope, because full access bypasses the tools that would enforce the
   * narrower one.
   *
   * Made unrepresentable rather than validated: choosing full disk access
   * raises the scope with it, and while it is set the scope control offers only
   * the one value that pairs with it. A form that lets a combination be
   * assembled and then refuses it teaches the rule by failure, and this rule is
   * about permissions — the worst place for a user to learn by being told no.
   * Lowering the sandbox again leaves the scope where they put it, since only
   * this direction is constrained.
   */
  const chooseSandbox = (next: SandboxLevel): void => {
    setSandbox(next)
    if (next === 'full_access') setGithubScope('full_access')
  }

  // Same unrepresentability rule for the ask posture: Codex cannot pause a
  // turn for an answer (askBeforeWritesSupported), so on that backend the
  // option is not offered rather than offered and refused — and switching to
  // Codex with it selected falls back to read_only, the nearest posture that
  // keeps the "nothing writes without me" promise.
  const sandboxOptions = askBeforeWritesSupported(backend)
    ? SANDBOX_OPTIONS
    : SANDBOX_OPTIONS.filter((option) => option.value !== 'ask_writes')

  const scopeOptions =
    sandbox === 'full_access'
      ? SCOPE_OPTIONS.filter((option) => option.value === 'full_access')
      : SCOPE_OPTIONS

  const trimmed = name.trim()
  const prompt = systemPrompt.trim()

  const submit = (): void =>
    create(
      {
        name: trimmed,
        // Not asked for. A colour picker is a decision about nothing at the
        // moment someone is trying to answer a different question, and the
        // editor has one — this is the same default `ListPanel`'s blank draft
        // uses, so a persona made either way starts the same.
        avatarColor: '#2a78d6',
        backend,
        model,
        systemPrompt: prompt,
        skillIds: [],
        mcpServerIds: [],
        sandbox,
        githubScope
      },
      (persona) => {
        onCreated(persona)
        onClose()
      }
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New persona</DialogTitle>
          <DialogDescription>
            Enough to start with. Skills, connected tools and the rest are in the Personas section,
            and this persona can be edited there at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <Field label="Name" htmlFor="quick-persona-name">
            <Input
              id="quick-persona-name"
              value={name}
              autoFocus
              placeholder="Code Reviewer"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label="Runs on" htmlFor="quick-persona-backend">
            <SegmentedControl
              options={BACKEND_OPTIONS}
              value={backend}
              onChange={(next) => {
                setBackend(next)
                // The model lists do not overlap, so a model chosen for one
                // backend is not a valid choice for the other.
                setModel(null)
                if (!askBeforeWritesSupported(next) && sandbox === 'ask_writes') {
                  setSandbox('read_only')
                }
              }}
              aria-label="Backend"
              className="self-start"
            />
          </Field>

          <Field label="Model" htmlFor="quick-persona-model">
            <select
              id="quick-persona-model"
              className="border-input bg-background h-9 w-full rounded-md border px-2 font-mono text-sm"
              value={model ?? DEFAULT_MODEL}
              onChange={(event) =>
                setModel(event.target.value === DEFAULT_MODEL ? null : event.target.value)
              }
            >
              {/* Null is a real choice — "whatever the backend picks" — and it
                  is the one a persona should start on. */}
              <option value={DEFAULT_MODEL}>Backend default</option>
              {models.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="What it may do on disk"
            htmlFor="quick-persona-sandbox"
            hint="A contact bound to this persona works only inside its own repository."
          >
            <SegmentedControl
              options={sandboxOptions}
              value={sandbox}
              onChange={chooseSandbox}
              aria-label="Sandbox"
              className="self-start"
            />
          </Field>

          <Field
            label="What it may do on GitHub"
            htmlFor="quick-persona-scope"
            {...(sandbox === 'full_access'
              ? {
                  hint: 'Full access to your files also grants full access on GitHub — a narrower GitHub setting could not be enforced alongside it.'
                }
              : {})}
          >
            <SegmentedControl
              options={scopeOptions}
              value={githubScope}
              onChange={setGithubScope}
              aria-label="GitHub scope"
              className="self-start"
            />
          </Field>

          <Field label="Instructions" htmlFor="quick-persona-prompt">
            <Textarea
              id="quick-persona-prompt"
              value={systemPrompt}
              rows={5}
              placeholder="Review changes carefully. Explain what you found and why it matters; do not change anything unless asked."
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </Field>
        </div>

        {error && <p className="text-destructive text-row">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!trimmed || !prompt || isPending} onClick={submit}>
            {isPending ? 'Creating…' : 'Create persona'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
