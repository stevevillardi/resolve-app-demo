import { useState } from 'react'
import { Check, FolderGit2, Search } from 'lucide-react'
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
import { EmptyState } from '@/components/common/EmptyState'
import { personaTemplates } from '@/mocks'
import type { MockRepo } from '@/mocks/repos'
import { mockRepos } from '@/mocks'

interface NewContactFlowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type RepoListState = 'loading' | 'empty' | 'error' | { repos: MockRepo[] }

type Step = 'persona' | 'repo' | 'confirm'

export function NewContactFlow({ open, onOpenChange }: NewContactFlowProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('persona')
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  // Real API-backed loading/empty/error states land in Phase 6 — this is the
  // shape the repo picker will keep once the data source is swapped.
  const [repoListState] = useState<RepoListState>({ repos: mockRepos })

  const persona = personaTemplates.find((p) => p.id === personaId)
  const repo =
    repoListState !== 'loading' && repoListState !== 'empty' && repoListState !== 'error'
      ? repoListState.repos.find((r) => r.id === repoId)
      : undefined

  const reset = (): void => {
    setStep('persona')
    setPersonaId(null)
    setRepoId(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            {step === 'persona' && 'Pick a persona template.'}
            {step === 'repo' && 'Bind it to a repo.'}
            {step === 'confirm' && 'Confirm and create.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'persona' && (
          <div className="flex flex-col gap-1">
            {personaTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setPersonaId(template.id)}
                className={`hover:bg-accent flex items-center gap-2.5 rounded-md px-2 py-2 text-left ${personaId === template.id ? 'bg-accent' : ''}`}
              >
                <AvatarColorSwatch name={template.name} color={template.avatarColor} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{template.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {template.systemPrompt}
                  </span>
                </span>
                {personaId === template.id && <Check className="size-4 shrink-0" />}
              </button>
            ))}
          </div>
        )}

        {step === 'repo' && (
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {repoListState === 'loading' && <EmptyState loading title="Loading repositories…" />}
            {repoListState === 'empty' && (
              <EmptyState
                icon={Search}
                title="No repositories found"
                description="Connect GitHub to see your repos."
              />
            )}
            {repoListState === 'error' && (
              <EmptyState
                title="Couldn't load repositories"
                description="Check your connection and try again."
              />
            )}
            {typeof repoListState === 'object' &&
              repoListState.repos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRepoId(r.id)}
                  className={`hover:bg-accent flex items-center gap-2.5 rounded-md px-2 py-2 text-left ${repoId === r.id ? 'bg-accent' : ''}`}
                >
                  <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">{r.fullName}</span>
                  {!r.clonedLocally && <span className="text-muted-foreground text-xs">clone</span>}
                  {repoId === r.id && <Check className="size-4 shrink-0" />}
                </button>
              ))}
          </div>
        )}

        {step === 'confirm' && persona && repo && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <AvatarColorSwatch name={persona.name} color={persona.avatarColor} />
              <div>
                <p className="text-sm font-medium">
                  {persona.name} · {repo.fullName.split('/').pop()}
                </p>
                <p className="text-muted-foreground text-xs">{repo.fullName}</p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
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
          {step === 'confirm' && (
            <Button
              onClick={() => {
                onOpenChange(false)
                reset()
              }}
            >
              Create contact
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
