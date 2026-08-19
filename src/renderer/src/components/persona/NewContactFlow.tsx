import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CloudDownload,
  FolderGit2,
  FolderOpen,
  Plus,
  Search
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { CheckRow } from '@/components/common/CheckRow'
import { ListRow } from '@/components/common/ListRow'
import { Field } from '@/components/common/Field'
import { Input } from '@/components/ui/input'
import { ISOLATION_OPTIONS } from '@/lib/isolation'
import { Github } from '@/components/github/GithubMark'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { useAuthStatus, useVerifyGitHubNow } from '@/hooks/useAuth'
import { usePersonas } from '@/hooks/usePersonas'
import { useContacts, useCreateContact, useRecreateContact } from '@/hooks/useConversations'
import { useChooseDirectory, useCloneRepo, useRepos } from '@/hooks/useRepos'
import { useChooseWorkspaceRoot, useWorkspaceRoot } from '@/hooks/useSettings'
import { useUiStore } from '@/store/useUiStore'
import { ipcErrorMessage } from '@/lib/ipc-client'
import { repoName } from '@/lib/format'
import { NON_REPO_NOTE, repoBindingProblem } from '@/lib/repo-binding'
import { filterRepos, isPossiblyTruncated } from '@/lib/repo-filter'
import { filterPersonas, PERSONA_FILTER_THRESHOLD } from '@/lib/persona-filter'
import { QuickPersonaDialog } from './QuickPersonaDialog'
import { REPO_FETCH_LIMIT } from '../../../../shared/repos'
import { cn } from '@/lib/utils'
import { defaultIsolation } from '../../../../shared/domain'
import type { Contact, Isolation } from '@/types'
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
 * The name a contact gets when nobody types one (blueprint §4's example shape).
 *
 * A function rather than an inline template because the confirm step's field
 * and `handleCreate` both need it, and a second copy is how a placeholder comes
 * to advertise a name the contact does not end up with.
 */
function derivedName(personaName: string, path: string): string {
  return `${personaName} · ${repoName(path)}`
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
  const [source, setSource] = useState<Source>('github')
  const [repoId, setRepoId] = useState<string | null>(null)
  const [localRepo, setLocalRepo] = useState<BoundRepo | null>(null)
  // Null until the user decides, so the step can show the default without having
  // silently made the choice on their behalf.
  const [isolation, setIsolation] = useState<Isolation | null>(null)

  const { data: personaTemplates = [] } = usePersonas()
  const { data: authStatus } = useAuthStatus()
  const { data: contacts = [] } = useContacts()
  const recreateContactId = useUiStore((state) => state.recreateContactId)
  const setRecreateContactId = useUiStore((state) => state.setRecreateContactId)
  /** The contact being recreated, when this open is a guided recreate. */
  const recreateFrom = recreateContactId
    ? (contacts.find((contact) => contact.id === recreateContactId) ?? null)
    : null
  const { recreate, error: recreateError } = useRecreateContact()
  // Keeping the thread is the point of the flow now, so it is the default.
  const [bringHistory, setBringHistory] = useState(true)

  /**
   * Prefill for a recreate, adjusted during render (the ListPanel search-reset
   * pattern) so the prefilled form never flashes empty first. `isGitRepo` is
   * derived conservatively: only an exclusive contact can sit on a non-git
   * folder — creation forces that — so anything else is certainly git, and
   * assuming non-git for exclusive merely narrows the isolation options.
   */
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null)
  if (open && recreateFrom && prefilledFrom !== recreateFrom.id) {
    setPrefilledFrom(recreateFrom.id)
    setPersonaId(recreateFrom.personaTemplateId)
    setSource('local')
    setLocalRepo({
      path: recreateFrom.repoPath,
      name: repoName(recreateFrom.repoPath),
      isGitRepo: recreateFrom.isolation !== 'exclusive'
    })
    setIsolation(recreateFrom.isolation)
  }
  const githubConnected = Boolean(authStatus?.github.connected)
  const setDialog = useUiStore((state) => state.setDialog)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)

  // Only fetched once the user is actually on the GitHub step — it is a network
  // round trip that a local-folder binding never needs.
  const repos = useRepos(open && step === 'repo' && source === 'github' && githubConnected)
  // A failed listing is often the first thing that notices a revoked token, and
  // it would be absurd to show "couldn't load your repositories" here while the
  // rail two inches away still shows a healthy dot. Re-checks once, on the edge
  // into failure — not on every render of the error state.
  const verifyGitHub = useVerifyGitHubNow()
  useEffect(() => {
    if (repos.isError) verifyGitHub()
  }, [repos.isError, verifyGitHub])

  const [repoQuery, setRepoQuery] = useState('')
  const visibleRepos = filterRepos(repos.data ?? [], repoQuery)

  const [personaQuery, setPersonaQuery] = useState('')
  const visiblePersonas = filterPersonas(personaTemplates, personaQuery)
  const [creatingPersona, setCreatingPersona] = useState(false)

  /**
   * The contact's name, editable on the confirm step (§G4).
   *
   * Null means "follow the derived name", so the field keeps tracking the
   * persona and repository while the user is still choosing them and stops the
   * moment they type. Seeding a string on mount instead would freeze the name
   * at whatever the first persona was, and going back a step to change the
   * persona would silently leave the old one's name behind.
   */
  const [displayName, setDisplayName] = useState<string | null>(null)

  const { choose, isPending: choosing } = useChooseDirectory()
  const { clone, isPending: cloning, error: cloneError } = useCloneRepo()
  const { create, isPending: creating, error: createError } = useCreateContact()
  // The first clone needs a workspace root, and main will open a native folder
  // dialog for one mid-clone if it has to — invisible behind a button that says
  // "Cloning…" (Phase 11, F2). Known-unset is asked for up front instead, with
  // its own label; the mid-clone ask in cloneToWorkspace stays as the fallback
  // for the brief window where the root query hasn't resolved yet.
  const workspaceRoot = useWorkspaceRoot()
  const { chooseAsync: chooseCloneRoot, isPending: choosingRoot } = useChooseWorkspaceRoot()

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
      setRepoQuery('')
      setPersonaQuery('')
      setDisplayName(null)
      setCreatingPersona(false)
      setPrefilledFrom(null)
      setBringHistory(true)
      setRecreateContactId(null)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [open, setRecreateContactId])

  const persona = personaTemplates.find((p) => p.id === personaId)
  const repo = repos.data?.find((r) => r.id === repoId)
  const chosenPath = source === 'local' ? localRepo?.path : repo?.localPath
  const chosenLabel = source === 'local' ? localRepo?.path : repo?.fullName
  const hasRepo = source === 'local' ? Boolean(localRepo) : Boolean(repo)
  const busy = cloning || creating || choosingRoot

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

    const bind = (path: string): void => {
      const draft = {
        personaTemplateId: persona.id,
        repoPath: path,
        // What the user typed, or blueprint §4's example shape — "Code Reviewer
        // · my-app" — when they left it alone. `derivedName` is the same
        // expression the confirm step shows, so the field is never a preview of
        // something other than what gets created.
        displayName: displayName?.trim() || derivedName(persona.name, path),
        isolation: chosenIsolation
      }
      // Land the user in the thread they just made rather than back on
      // whatever was selected before.
      const landOn = (contact: Contact): void => {
        setSelectedConversation({ kind: 'contact', id: contact.id })
        onOpenChange(false)
      }

      // One call, not create-then-delete: main re-points the old contact's
      // messages at the new one in between, and a failure partway used to
      // leave either two contacts or a deleted conversation. A dirty worktree
      // still refuses, which keeps the original intact rather than half-moved.
      if (recreateFrom) {
        return recreate({ fromId: recreateFrom.id, draft, bringHistory }, landOn)
      }
      create(draft, landOn)
    }

    if (chosenPath) return bind(chosenPath)
    if (source === 'github' && repo) {
      const startClone = (): void =>
        clone({ fullName: repo.fullName, cloneUrl: repo.cloneUrl }, (cloned) => bind(cloned.path))
      if (workspaceRoot.data?.path === null) {
        // A cancel is an answer: stay on the confirm step with nothing changed.
        void chooseCloneRoot().then((path) => {
          if (path) startClone()
        })
        return
      }
      startClone()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{STEP_COPY[step].title}</DialogTitle>
          <DialogDescription>{STEP_COPY[step].description}</DialogDescription>
        </DialogHeader>

        {step === 'persona' && (
          <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
            {/*
              Only once the list is long enough to be worth searching. A fresh
              profile has the three seeded personas, so this is furniture until
              someone opens the starter library or writes their own — see
              PERSONA_FILTER_THRESHOLD.
            */}
            {personaTemplates.length >= PERSONA_FILTER_THRESHOLD && (
              <InputGroup>
                <InputGroupAddon>
                  <Search className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="Filter personas"
                  value={personaQuery}
                  onChange={(event) => setPersonaQuery(event.target.value)}
                />
              </InputGroup>
            )}
            {visiblePersonas.length === 0 && (
              <EmptyState
                compact
                icon={Search}
                title={`Nothing matches “${personaQuery.trim()}”`}
                description="Try the name, the backend, or the scope."
              />
            )}
            {visiblePersonas.map((template) => (
              <ListRow
                key={template.id}
                active={personaId === template.id}
                onSelect={() => setPersonaId(template.id)}
                align="center"
                bordered
                leading={
                  <AvatarColorSwatch
                    name={template.name}
                    color={template.avatarColor}
                    seed={template.avatarSeed}
                  />
                }
                trailing={
                  personaId === template.id ? <Check className="size-4 shrink-0" /> : undefined
                }
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-row font-medium">{template.name}</span>
                  <BackendBadge backend={template.backend} />
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <ScopeChip axis="sandbox" value={template.sandbox} />
                  <ScopeChip axis="github" value={template.githubScope} />
                </span>
              </ListRow>
            ))}
            {/*
              The way out of "none of these". Without it the answer to the very
              first question the app asks was to cancel, go to Personas, work
              out that a new persona means editing a blank draft, save, and
              start again from ⌘N.
            */}
            <Button
              variant="outline"
              className="mt-1 gap-2 self-start"
              onClick={() => setCreatingPersona(true)}
            >
              <Plus className="size-4" />
              New persona…
            </Button>
          </div>
        )}

        {step === 'repo' && (
          <div className="flex flex-col gap-3">
            <SegmentedControl
              options={SOURCE_OPTIONS}
              value={source}
              onChange={setSource}
              aria-label="Repo source"
              className="self-start"
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
                description="Switchboard lists your repositories once GitHub is connected."
                action={
                  <Button size="sm" className="gap-2" onClick={() => setDialog('github')}>
                    <Github />
                    Connect GitHub
                  </Button>
                }
              />
            )}

            {source === 'github' && githubConnected && repos.isSuccess && repos.data.length > 0 && (
              <InputGroup className="bg-background dark:bg-background border-border h-8 rounded-md">
                <InputGroupAddon className="pl-2">
                  <Search className="text-muted-foreground size-3.5" />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  value={repoQuery}
                  onChange={(event) => setRepoQuery(event.target.value)}
                  placeholder="Filter repositories"
                  aria-label="Filter repositories"
                  className="h-8 text-xs [&::-webkit-search-cancel-button]:appearance-none"
                />
              </InputGroup>
            )}

            {source === 'github' && githubConnected && (
              <div className="scrollbar-subtle flex max-h-96 flex-col gap-1.5 overflow-y-auto">
                {repos.isPending && <EmptyState compact loading title="Loading repositories…" />}
                {/*
                  Main's own words, not a paraphrase. It distinguishes a
                  rejected token from a rate limit from a network failure and
                  says what to do about each — "check your connection and try
                  again" was wrong for two of the three and useless for all of
                  them. A stored token that has been revoked still reports
                  `connected: true`, because that only means a token exists, so
                  this message is the only place the user finds out.
                */}
                {repos.isError && (
                  <EmptyState
                    compact
                    icon={AlertTriangle}
                    title="Couldn't load repositories"
                    description={ipcErrorMessage(repos.error)}
                    action={
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void repos.refetch()}>
                          Try again
                        </Button>
                        <Button size="sm" className="gap-2" onClick={() => setDialog('github')}>
                          <Github />
                          Reconnect
                        </Button>
                      </div>
                    }
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
                {repos.isSuccess && repos.data.length > 0 && visibleRepos.length === 0 && (
                  <EmptyState
                    compact
                    icon={Search}
                    title={`Nothing matches “${repoQuery.trim()}”`}
                    // Names the cap, because "nothing matches" and "nothing
                    // matches in the ones we fetched" are different facts and
                    // only one of them is a reason to give up.
                    description={
                      isPossiblyTruncated(repos.data)
                        ? `Only the ${REPO_FETCH_LIMIT.toLocaleString()} most recently pushed repositories are listed. If yours is older, clone it and bind the folder instead.`
                        : 'Try the owner or the repository name.'
                    }
                  />
                )}
                {visibleRepos.map((option: RepoOption) => (
                  <ListRow
                    key={option.id}
                    active={repoId === option.id}
                    onSelect={() => setRepoId(option.id)}
                    align="center"
                    bordered
                    leading={<FolderGit2 className="text-muted-foreground size-4 shrink-0" />}
                    trailing={
                      <span className="flex shrink-0 items-center gap-1.5">
                        {!option.localPath && (
                          <span className="text-muted-foreground flex items-center gap-1 text-meta">
                            <CloudDownload className="size-3" />
                            clone
                          </span>
                        )}
                        {repoId === option.id && <Check className="size-4" />}
                      </span>
                    }
                  >
                    <span className="block truncate font-mono text-xs">{option.fullName}</span>
                  </ListRow>
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
                <ListRow
                  key={option.value}
                  active={chosenIsolation === option.value}
                  onSelect={() => setIsolation(option.value)}
                  disabled={unavailable}
                  bordered
                  trailing={
                    chosenIsolation === option.value ? (
                      <Check className="mt-0.5 size-4 shrink-0" />
                    ) : undefined
                  }
                >
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
                </ListRow>
              )
            })}
          </div>
        )}

        {step === 'confirm' && persona && hasRepo && (
          <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2.5">
              <AvatarColorSwatch
                name={persona.name}
                color={persona.avatarColor}
                seed={persona.avatarSeed}
                size="lg"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{persona.name}</p>
                <p className="text-muted-foreground truncate font-mono text-xs">{chosenLabel}</p>
              </div>
            </div>
            {/*
              Nameable at creation (§G4). It was derived and unaskable, so the
              only way to name a contact was to make it, find it, and rename it
              — and the derived name is mostly invisible anyway, since the
              conversation list shows the persona's. That matters most for the
              case this flow makes easy: two contacts on the same persona and
              the same repository, previously identical on screen.
            */}
            <Field label="Name" htmlFor="contact-display-name">
              <Input
                id="contact-display-name"
                value={displayName ?? ''}
                placeholder={chosenPath ? derivedName(persona.name, chosenPath) : persona.name}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
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
            {recreateFrom && (
              <CheckRow
                checked={bringHistory}
                onToggle={() => setBringHistory((current) => !current)}
                title={`Bring the conversation from “${recreateFrom.displayName}”`}
                description="Every message moves across. The new contact's session has not seen any of it, so a session divider marks where its memory starts. Untick to start empty."
              />
            )}
            {!chosenPath && (
              <p className="text-muted-foreground text-xs">
                This repo isn&apos;t on this machine yet — creating the contact will clone it first.
                {workspaceRoot.data?.path === null &&
                  ' You’ll be asked where cloned repositories should go.'}
              </p>
            )}
            {(cloneError ?? createError ?? recreateError) && (
              <p className="text-destructive text-xs">
                {cloneError ?? createError ?? recreateError}
              </p>
            )}
          </div>
        )}

        {/*
          A second dialog rather than a step: creating a persona is a detour
          from this flow, not part of it, and inserting it into STEPS would make
          the progress dots claim a five-step process for everyone.
        */}
        <QuickPersonaDialog
          open={creatingPersona}
          onClose={() => setCreatingPersona(false)}
          onCreated={(created) => {
            // Selected, and the filter cleared — the new persona may well not
            // match whatever was typed to establish it did not already exist.
            setPersonaId(created.id)
            setPersonaQuery('')
          }}
        />

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
                {choosingRoot
                  ? 'Choosing a folder…'
                  : cloning
                    ? 'Cloning…'
                    : creating
                      ? 'Creating…'
                      : 'Create'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
