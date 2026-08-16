import { useEffect, useState } from 'react'
import { Check, CloudDownload, FolderGit2, FolderOpen, Search } from 'lucide-react'
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
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { useAuthStatus } from '@/hooks/useAuth'
import { usePersonas } from '@/hooks/usePersonas'
import { useCreateContact } from '@/hooks/useConversations'
import { useChooseDirectory, useCloneRepo, useRepos } from '@/hooks/useRepos'
import { useUiStore } from '@/store/useUiStore'
import { repoName } from '@/lib/format'
import { NON_REPO_NOTE, repoBindingProblem } from '@/lib/repo-binding'
import { cn } from '@/lib/utils'
import { defaultIsolation } from '../../../../shared/domain'
import type { Isolation } from '@/types'
import type { BoundRepo, RepoOption } from '../../../../shared/ipc-contract'

interface NewContactFlowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Where the repo came from. Blueprint §9.1 describes the GitHub route, which is
 * the one that makes the app feel like it knows your work — but a local folder
 * is a first-class alternative rather than a fallback, because it removes both
 * ways the GitHub route can fail before anything interesting happens (no token,
 * or a clone that doesn't complete).
 */
type Source = 'github' | 'local'

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'local', label: 'Local folder' }
]

const STEPS = ['persona', 'repo', 'isolation', 'confirm'] as const
type Step = (typeof STEPS)[number]

const STEP_COPY: Record<Step, { title: string; description: string }> = {
  persona: { title: 'Pick a persona', description: 'Which template should this contact use?' },
  repo: { title: 'Bind a repo', description: 'The persona only ever works inside this repo.' },
  // After the repo rather than before it, because the choice is only meaningful
  // once we know whether the binding is a git repo at all.
  isolation: {
    title: 'Where it works',
    description: 'Your own checkout, or one of its own.'
  },
  confirm: { title: 'Confirm', description: 'Check the scope before creating the contact.' }
}

/**
 * The three modes, in the order they are worth considering.
 *
 * Written out here rather than derived, because each one's cost is the thing
 * that decides it and none of those costs are inferable from the name.
 */
const ISOLATION_OPTIONS: {
  value: Isolation
  label: string
  description: string
  /** Needs a git repo to be possible at all. */
  needsGit: boolean
}[] = [
  {
    value: 'worktree',
    label: 'Its own checkout',
    description:
      'Works on its own branch in a separate directory, so it never waits for another persona and never touches your files. It starts from the last commit — your uncommitted work and node_modules are not there.',
    needsGit: true
  },
  {
    value: 'shared',
    label: 'Your checkout',
    description:
      'Works directly in the repo, seeing your uncommitted changes and everything already installed. Writers take turns here: one runs at a time.',
    needsGit: false
  },
  {
    value: 'exclusive',
    label: 'Your checkout, alone',
    description:
      'The same directory, but held for the whole turn so nothing else can read it mid-write. For work that needs the repo to itself.',
    needsGit: false
  }
]

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
  const [source, setSource] = useState<Source>('github')
  const [repoId, setRepoId] = useState<string | null>(null)
  const [localRepo, setLocalRepo] = useState<BoundRepo | null>(null)
  // Null until the user decides, so the step can show the default without having
  // silently made the choice on their behalf.
  const [isolation, setIsolation] = useState<Isolation | null>(null)

  const { data: personaTemplates = [] } = usePersonas()
  const { data: authStatus } = useAuthStatus()
  const githubConnected = Boolean(authStatus?.github.connected)
  const setDialog = useUiStore((state) => state.setDialog)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)

  // Only fetched once the user is actually on the GitHub step — it is a network
  // round trip that a local-folder binding never needs.
  const repos = useRepos(open && step === 'repo' && source === 'github' && githubConnected)
  const { choose, isPending: choosing } = useChooseDirectory()
  const { clone, isPending: cloning, error: cloneError } = useCloneRepo()
  const { create, isPending: creating, error: createError } = useCreateContact()

  // Reset on close rather than on open, so the dialog's exit animation doesn't
  // play over a half-cleared form.
  useEffect(() => {
    if (open) return
    const timer = window.setTimeout(() => {
      setStep('persona')
      setPersonaId(null)
      setRepoId(null)
      setLocalRepo(null)
      setIsolation(null)
      setSource('github')
    }, 200)
    return () => window.clearTimeout(timer)
  }, [open])

  const persona = personaTemplates.find((p) => p.id === personaId)
  const repo = repos.data?.find((r) => r.id === repoId)
  const chosenPath = source === 'local' ? localRepo?.path : repo?.localPath
  const chosenLabel = source === 'local' ? localRepo?.path : repo?.fullName
  const hasRepo = source === 'local' ? Boolean(localRepo) : Boolean(repo)
  const busy = cloning || creating

  // Caught at bind time rather than at the first send — see repoBindingProblem.
  const bindingProblem =
    source === 'local' && localRepo
      ? repoBindingProblem(persona?.backend, persona?.name, localRepo.isGitRepo)
      : null

  // A GitHub repo is a git repo by definition; only a hand-picked folder can
  // fail to be one, and a folder that isn't cannot have a worktree at all.
  const isGitRepo = source === 'local' ? Boolean(localRepo?.isGitRepo) : true
  const suggestedIsolation: Isolation = !isGitRepo
    ? 'exclusive'
    : persona
      ? defaultIsolation(persona.sandbox)
      : 'shared'
  const chosenIsolation = isolation ?? suggestedIsolation

  /** Binds the contact, cloning first when the repo is only on GitHub so far. */
  const handleCreate = (): void => {
    if (!persona) return

    const bind = (path: string): void =>
      create(
        {
          personaTemplateId: persona.id,
          repoPath: path,
          // Blueprint §4's example shape — "Code Reviewer · my-app".
          displayName: `${persona.name} · ${repoName(path)}`,
          isolation: chosenIsolation
        },
        (contact) => {
          // Land the user in the thread they just created rather than back on
          // whatever was selected before.
          setSelectedConversation({ kind: 'contact', id: contact.id })
          onOpenChange(false)
        }
      )

    if (chosenPath) return bind(chosenPath)
    if (source === 'github' && repo) {
      clone({ fullName: repo.fullName, cloneUrl: repo.cloneUrl }, (cloned) => bind(cloned.path))
    }
  }

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
                    <span className="truncate text-row font-medium">{template.name}</span>
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

        {step === 'repo' && (
          <div className="flex flex-col gap-3">
            <SegmentedControl
              options={SOURCE_OPTIONS}
              value={source}
              onChange={setSource}
              aria-label="Repo source"
              className="w-56"
            />

            {source === 'local' && (
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="gap-2" onClick={() => choose(setLocalRepo)}>
                  <FolderOpen className="size-4" />
                  {choosing ? 'Choosing…' : 'Choose a folder…'}
                </Button>
                {localRepo && (
                  <div className="border-border flex items-center gap-2 rounded-lg border px-2.5 py-2">
                    <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {localRepo.path}
                    </span>
                    <Check className="size-4 shrink-0" />
                  </div>
                )}
                {localRepo && !localRepo.isGitRepo && (
                  // On Claude this is a note: an agent can read and edit a
                  // plain directory, it just has no branch to open a PR from.
                  // On Codex it is a hard stop.
                  <p
                    className={
                      bindingProblem ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
                    }
                  >
                    {bindingProblem?.message ?? NON_REPO_NOTE}
                  </p>
                )}
              </div>
            )}

            {source === 'github' && !githubConnected && (
              // Without a token there is nothing to list, so offer the fix
              // inline rather than presenting an empty list as a dead end.
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

            {source === 'github' && githubConnected && (
              <div className="scrollbar-subtle flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {repos.isPending && <EmptyState compact loading title="Loading repositories…" />}
                {repos.isError && (
                  <EmptyState
                    compact
                    title="Couldn't load repositories"
                    description="Check your connection and try again."
                  />
                )}
                {repos.isSuccess && repos.data.length === 0 && (
                  <EmptyState
                    compact
                    icon={Search}
                    title="No repositories found"
                    description="This account has no repositories we can see."
                  />
                )}
                {repos.data?.map((option: RepoOption) => (
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
                    {!option.localPath && (
                      <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-meta">
                        <CloudDownload className="size-3" />
                        clone
                      </span>
                    )}
                    {repoId === option.id && <Check className="size-4 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'isolation' && persona && (
          <div className="flex flex-col gap-2">
            {ISOLATION_OPTIONS.map((option) => {
              const unavailable = option.needsGit && !isGitRepo
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={unavailable}
                  onClick={() => setIsolation(option.value)}
                  className={cn(
                    rowClass(chosenIsolation === option.value),
                    'items-start disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {option.label}
                      {option.value === suggestedIsolation && !unavailable && (
                        <span className="text-muted-foreground text-meta font-normal">
                          Recommended
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {unavailable
                        ? 'Needs a git repository — this folder isn’t one.'
                        : option.description}
                    </p>
                  </div>
                  {chosenIsolation === option.value && <Check className="mt-0.5 size-4 shrink-0" />}
                </button>
              )
            })}
          </div>
        )}

        {step === 'confirm' && persona && hasRepo && (
          <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2.5">
              <AvatarColorSwatch name={persona.name} color={persona.avatarColor} size="lg" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{persona.name}</p>
                <p className="text-muted-foreground truncate font-mono text-xs">{chosenLabel}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <BackendBadge backend={persona.backend} />
              <ScopeChip axis="sandbox" value={persona.sandbox} />
              <ScopeChip axis="github" value={persona.githubScope} />
            </div>
            <p className="text-muted-foreground text-xs">
              {chosenIsolation === 'worktree'
                ? 'Works on its own branch, in its own checkout.'
                : chosenIsolation === 'exclusive'
                  ? 'Works in your checkout, holding it for the whole turn.'
                  : 'Works in your checkout, alongside everyone else.'}
            </p>
            {!chosenPath && (
              <p className="text-muted-foreground text-xs">
                This repo isn&apos;t on this machine yet — creating the contact will clone it first.
              </p>
            )}
            {(cloneError ?? createError) && (
              <p className="text-destructive text-xs">{cloneError ?? createError}</p>
            )}
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <StepDots current={step} />
          <div className="flex items-center gap-2">
            {step !== 'persona' && (
              // An index walk rather than a ternary chain, so inserting a step
              // is one line in STEPS instead of a correction here as well.
              <Button variant="outline" onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1])}>
                Back
              </Button>
            )}
            {step === 'persona' && (
              <Button disabled={!personaId} onClick={() => setStep('repo')}>
                Continue
              </Button>
            )}
            {step === 'repo' && (
              <Button
                disabled={!hasRepo || Boolean(bindingProblem)}
                onClick={() => setStep('isolation')}
              >
                Continue
              </Button>
            )}
            {step === 'isolation' && <Button onClick={() => setStep('confirm')}>Continue</Button>}
            {step === 'confirm' && (
              <Button disabled={busy} onClick={handleCreate}>
                {cloning ? 'Cloning…' : creating ? 'Creating…' : 'Create'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
