import { useEffect, useState } from 'react'
import { Check, CloudDownload, FolderGit2, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { Github } from '@/components/github/GithubMark'
import { useAuthStatus } from '@/hooks/useAuth'
import { useUiStore } from '@/store/useUiStore'
import { cn } from '@/lib/utils'
import { mockRepos, personaTemplates } from '@/mocks'
import type { MockRepo } from '@/mocks/repos'

interface NewContactFlowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type RepoListState = 'loading' | 'empty' | 'error' | { repos: MockRepo[] }

const STEPS = ['persona', 'repo', 'confirm'] as const
type Step = (typeof STEPS)[number]

const STEP_COPY: Record<Step, { title: string; description: string }> = {
  persona: { title: 'Pick a persona', description: 'Which template should this contact use?' },
  repo: { title: 'Bind a repo', description: 'The persona only ever works inside this repo.' },
  confirm: { title: 'Confirm', description: 'Check the scope before creating the contact.' }
}

function StepDots({ current }: { current: Step }): React.JSX.Element {
  const index = STEPS.indexOf(current)
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      {STEPS.map((step, stepIndex) => (
        <span
          key={step}
          aria-hidden
          className={cn(
            'h-1 rounded-full transition-all',
            stepIndex === index ? 'bg-primary w-5' : 'bg-border w-1.5'
          )}
        />
      ))}
    </div>
  )
}

export function NewContactFlow({ open, onOpenChange }: NewContactFlowProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('persona')
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  // Real API-backed loading/empty/error states land in Phase 6 — this is the
  // shape the repo picker will keep once the data source is swapped.
  const [repoListState] = useState<RepoListState>({ repos: mockRepos })
  const { data: authStatus } = useAuthStatus()
  const githubConnected = Boolean(authStatus?.github.connected)
  const setDialog = useUiStore((state) => state.setDialog)

  // Reset on close rather than on open, so the dialog's exit animation doesn't
  // play over a half-cleared form.
  useEffect(() => {
    if (open) return
    const timer = window.setTimeout(() => {
      setStep('persona')
      setPersonaId(null)
      setRepoId(null)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [open])

  const persona = personaTemplates.find((p) => p.id === personaId)
  const repo =
    typeof repoListState === 'object' ? repoListState.repos.find((r) => r.id === repoId) : undefined

  const rowClass = (selected: boolean): string =>
    cn(
      'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
      'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
      selected ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{STEP_COPY[step].title}</DialogTitle>
          <DialogDescription>{STEP_COPY[step].description}</DialogDescription>
        </DialogHeader>

        {step === 'persona' && (
          <div className="flex flex-col gap-1.5">
            {personaTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setPersonaId(template.id)}
                className={rowClass(personaId === template.id)}
              >
                <AvatarColorSwatch name={template.name} color={template.avatarColor} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{template.name}</span>
                    <BackendBadge backend={template.backend} />
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <ScopeChip axis="sandbox" value={template.sandbox} />
                    <ScopeChip axis="github" value={template.githubScope} />
                  </span>
                </span>
                {personaId === template.id && <Check className="size-4 shrink-0" />}
              </button>
            ))}
          </div>
        )}

        {step === 'repo' && !githubConnected && (
          // Phase 3 gate: the picker lists real GitHub repos from Phase 6
          // onwards, so without a token there is nothing to show. Offer the
          // fix inline rather than presenting an empty list as a dead end.
          <EmptyState
            compact
            icon={Search}
            title="Connect GitHub to browse repos"
            description="Persona Router lists your repositories once GitHub is connected."
            action={
              <Button size="sm" className="gap-2" onClick={() => setDialog('github')}>
                <Github />
                Connect GitHub
              </Button>
            }
          />
        )}

        {step === 'repo' && githubConnected && (
          <div className="scrollbar-subtle flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {repoListState === 'loading' && (
              <EmptyState compact loading title="Loading repositories…" />
            )}
            {repoListState === 'empty' && (
              <EmptyState
                compact
                icon={Search}
                title="No repositories found"
                description="Connect GitHub to browse your repos."
              />
            )}
            {repoListState === 'error' && (
              <EmptyState
                compact
                title="Couldn't load repositories"
                description="Check your connection and try again."
              />
            )}
            {typeof repoListState === 'object' &&
              repoListState.repos.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setRepoId(option.id)}
                  className={rowClass(repoId === option.id)}
                >
                  <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {option.fullName}
                  </span>
                  {!option.clonedLocally && (
                    <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]">
                      <CloudDownload className="size-3" />
                      clone
                    </span>
                  )}
                  {repoId === option.id && <Check className="size-4 shrink-0" />}
                </button>
              ))}
          </div>
        )}

        {step === 'confirm' && persona && repo && (
          <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2.5">
              <AvatarColorSwatch name={persona.name} color={persona.avatarColor} size="lg" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{persona.name}</p>
                <p className="text-muted-foreground truncate font-mono text-xs">{repo.fullName}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <BackendBadge backend={persona.backend} />
              <ScopeChip axis="sandbox" value={persona.sandbox} />
              <ScopeChip axis="github" value={persona.githubScope} />
            </div>
            {!repo.clonedLocally && (
              <p className="text-muted-foreground text-xs">
                This repo isn&apos;t cloned locally yet — it will be cloned before the first
                message.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <StepDots current={step} />
          <div className="flex items-center gap-2">
            {step !== 'persona' && (
              <Button
                variant="outline"
                onClick={() => setStep(step === 'confirm' ? 'repo' : 'persona')}
              >
                Back
              </Button>
            )}
            {step === 'persona' && (
              <Button disabled={!personaId} onClick={() => setStep('repo')}>
                Continue
              </Button>
            )}
            {step === 'repo' && (
              <Button disabled={!repoId} onClick={() => setStep('confirm')}>
                Continue
              </Button>
            )}
            {step === 'confirm' && <Button onClick={() => onOpenChange(false)}>Create</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
