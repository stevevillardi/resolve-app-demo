import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { ClaudeMark, CodexMark } from '@/components/brand/BrandMarks'
import { Button } from '@/components/ui/button'
import { DeviceCodeDisplay } from '@/components/common/DeviceCodeDisplay'
import { Github } from '@/components/github/GithubMark'
import {
  useAuthRecoveryOnFocus,
  useAuthStatus,
  useCodexLogin,
  useCompleteOnboarding,
  useGitHubDeviceFlow,
  useRefreshAuth,
  useSetAnthropicApiKey,
  useSetOpenAiApiKey
} from '@/hooks/useAuth'
import { SwitchboardIcon } from '@/components/brand/SwitchboardIcon'
import { useApplyStarterSelection, useSeedCatalog } from '@/hooks/useSeed'
import { ApiKeyField } from './ApiKeyField'
import { AuthStepCard } from './AuthStepCard'
import { PersonaCatalogGrid, SkillCatalogList } from './StarterCatalogPicker'

/**
 * First-run setup (blueprint §15A + §9, extended in Phase 17). Three steps:
 * connect backends, choose starting personas, choose starting Skills. The auth
 * step still shows all three providers at once rather than one per screen —
 * they're independent and none is required.
 *
 * Nothing here blocks. "Skip for now" is a first-class exit from the first
 * step: the recommended starter set is already installed by startup seeding,
 * so a skipper gets exactly what every install before this phase got. The
 * pickers refine that set; they never gate it.
 */
type Step = 'auth' | 'personas' | 'skills'
const STEPS: Step[] = ['auth', 'personas', 'skills']

export function OnboardingFlow(): React.JSX.Element {
  const { data: status } = useAuthStatus()
  const { complete, isPending: completing } = useCompleteOnboarding()
  const { data: catalog } = useSeedCatalog()
  const { apply, isPending: applying, error: applyError } = useApplyStarterSelection()

  const [step, setStep] = useState<Step>('auth')
  /**
   * Sparse overrides on top of the catalog's defaults (recommended or already
   * installed → on), rather than a Set initialised from the async catalog —
   * this way there is no initialisation race and Back/forward keeps choices.
   */
  const [personaOverrides, setPersonaOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [skillOverrides, setSkillOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())

  const github = useGitHubDeviceFlow()
  const codex = useCodexLogin()
  const anthropicKey = useSetAnthropicApiKey()
  const openAiKey = useSetOpenAiApiKey()
  const [showCodexKey, setShowCodexKey] = useState(false)

  // A probe that failed at launch (a cold binary can outlive its timeout) heals
  // itself when the user comes back to the window, or on the explicit Retry.
  useAuthRecoveryOnFocus()
  const { refresh, isPending: refreshing } = useRefreshAuth()

  const claudeStatus = status?.claude
  const codexStatus = status?.codex
  const githubStatus = status?.github

  const anyConnected =
    Boolean(claudeStatus?.authenticated) ||
    Boolean(codexStatus?.authenticated) ||
    Boolean(githubStatus?.connected)

  const personaSelected = (id: string): boolean => {
    const entry = catalog?.personas.find((p) => p.entry.id === id)
    return personaOverrides.get(id) ?? Boolean(entry && (entry.recommended || entry.installed))
  }
  const skillSelected = (id: string): boolean => {
    const entry = catalog?.skills.find((s) => s.entry.id === id)
    return skillOverrides.get(id) ?? Boolean(entry && (entry.recommended || entry.installed))
  }
  const togglePersona = (id: string): void =>
    setPersonaOverrides(new Map(personaOverrides).set(id, !personaSelected(id)))
  const toggleSkill = (id: string): void =>
    setSkillOverrides(new Map(skillOverrides).set(id, !skillSelected(id)))

  /** skill id → name of the first chosen persona that attaches it. */
  const requiredBy = new Map<string, string>()
  for (const { entry } of catalog?.personas ?? []) {
    if (!personaSelected(entry.id)) continue
    for (const skillId of entry.skillIds) {
      if (!requiredBy.has(skillId)) requiredBy.set(skillId, entry.name)
    }
  }

  const finish = (): void => {
    // No catalog (a read failure) degrades to plain completion — the
    // recommended set is already installed, so nothing is lost but the picks.
    if (!catalog) {
      complete()
      return
    }
    apply(
      catalog.personas.map(({ entry }) => entry.id).filter(personaSelected),
      catalog.skills
        .map(({ entry }) => entry.id)
        .filter((id) => skillSelected(id) || requiredBy.has(id)),
      complete
    )
  }

  const subtitle: Record<Step, string> = {
    auth: 'Connect the backends your personas will run on. You can do any of this later.',
    personas:
      'Pick your starting personas. Each is a system prompt, Skills, and a permission scope you can edit later.',
    skills: 'Pick your starting Skills — reusable instruction text any persona can attach.'
  }

  return (
    <div className="drag-region bg-background fixed inset-0 z-40 overflow-y-auto">
      <div
        className={`no-drag @container/pane mx-auto flex min-h-full w-full flex-col justify-center gap-6 px-6 py-14 ${step === 'auth' ? 'max-w-xl' : 'max-w-2xl'}`}
      >
        <header className="drag-region flex flex-col items-center gap-3 text-center">
          <SwitchboardIcon className="size-14 rounded-[22%] shadow-sm" />
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Welcome to Switchboard</h1>
            <p className="text-muted-foreground text-sm text-pretty">{subtitle[step]}</p>
          </div>
          {/* Where you are, not something to click — navigation is the two
              buttons below, and three dots are legible without labels. */}
          <div className="no-drag flex items-center gap-1.5" aria-hidden>
            {STEPS.map((candidate) => (
              <span
                key={candidate}
                className={`size-1.5 rounded-full transition-colors ${candidate === step ? 'bg-primary' : 'bg-border'}`}
              />
            ))}
          </div>
        </header>

        {step === 'auth' && status && !status.secretStorageAvailable && (
          <p className="border-destructive/40 text-destructive flex items-start gap-2 rounded-lg border p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Your OS has no available keychain, so credentials can&apos;t be stored securely.
              Switchboard will not save them in plaintext — set up a system keyring and restart.
            </span>
          </p>
        )}

        {step === 'personas' &&
          (catalog ? (
            <PersonaCatalogGrid
              catalog={catalog}
              isSelected={personaSelected}
              onToggle={togglePersona}
            />
          ) : (
            <PendingRow label="Loading the starter catalog…" />
          ))}

        {step === 'skills' && catalog && (
          <SkillCatalogList
            catalog={catalog}
            isSelected={skillSelected}
            onToggle={toggleSkill}
            requiredBy={requiredBy}
          />
        )}

        {step === 'auth' && (
          <div className="flex flex-col gap-3">
            {/* --- Claude ---------------------------------------------------- */}
            <AuthStepCard
              icon={ClaudeMark}
              title="Claude"
              description="Reuses your Claude Code login if you already have one."
              connected={Boolean(claudeStatus?.authenticated)}
              connectedLabel={describeClaude(claudeStatus)}
            >
              {!claudeStatus ? (
                <PendingRow label="Checking for existing Claude authentication…" />
              ) : (
                !claudeStatus.authenticated && (
                  <div className="flex flex-col gap-2">
                    {claudeStatus.error && (
                      <ProbeFailedNote
                        message={claudeStatus.error}
                        onRetry={refresh}
                        isRetrying={refreshing}
                      />
                    )}
                    <ApiKeyField
                      label="Anthropic API key"
                      placeholder="sk-ant-…"
                      isPending={anthropicKey.isPending}
                      error={anthropicKey.error}
                      onSubmit={anthropicKey.submit}
                    />
                  </div>
                )
              )}
            </AuthStepCard>

            {/* --- Codex ----------------------------------------------------- */}
            <AuthStepCard
              icon={CodexMark}
              title="Codex"
              description="Reuses your Codex login, or sign in with ChatGPT."
              connected={Boolean(codexStatus?.authenticated)}
              connectedLabel={
                codexStatus?.source === 'api_key'
                  ? 'Connected with an API key'
                  : 'Signed in with ChatGPT'
              }
            >
              {codexStatus && !codexStatus.authenticated && (
                <div className="flex flex-col gap-3">
                  {codexStatus.error && (
                    <ProbeFailedNote
                      message={codexStatus.error}
                      onRetry={refresh}
                      isRetrying={refreshing}
                    />
                  )}

                  {codex.state.status === 'awaiting_authorization' ? (
                    <>
                      <DeviceCodeDisplay
                        userCode={codex.state.userCode}
                        verificationUri={codex.state.verificationUri}
                        {...(codex.state.expiresAt !== undefined
                          ? { expiresAt: codex.state.expiresAt }
                          : {})}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={codex.cancel}
                        className="self-start"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : codex.state.status === 'starting' || codex.isStarting ? (
                    <PendingRow label="Starting Codex sign-in…" />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={codex.start}>
                        Sign in with ChatGPT
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCodexKey((shown) => !shown)}
                      >
                        Use an API key
                      </Button>
                    </div>
                  )}

                  {codex.state.status === 'error' && codex.state.error && (
                    <ErrorNote message={codex.state.error} />
                  )}

                  {showCodexKey && codex.state.status !== 'awaiting_authorization' && (
                    <ApiKeyField
                      label="OpenAI API key"
                      placeholder="sk-…"
                      isPending={openAiKey.isPending}
                      error={openAiKey.error}
                      onSubmit={openAiKey.submit}
                    />
                  )}
                </div>
              )}
            </AuthStepCard>

            {/* --- GitHub ---------------------------------------------------- */}
            <AuthStepCard
              icon={Github}
              title="GitHub"
              description="Browse your repos when creating a contact, and open PRs later."
              connected={Boolean(githubStatus?.connected)}
              connectedLabel={
                githubStatus?.login ? `Connected as ${githubStatus.login}` : 'Connected'
              }
            >
              {githubStatus && !githubStatus.connected && (
                <div className="flex flex-col gap-3">
                  {!githubStatus.configured ? (
                    <ErrorNote message="No GitHub client ID is configured. Set MAIN_VITE_GITHUB_CLIENT_ID in .env — see .env.example." />
                  ) : github.state.status === 'awaiting_authorization' ? (
                    <>
                      <DeviceCodeDisplay
                        userCode={github.state.userCode}
                        verificationUri={github.state.verificationUri}
                        instruction="Enter this code on GitHub:"
                        {...(github.state.expiresAt !== undefined
                          ? { expiresAt: github.state.expiresAt }
                          : {})}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={github.cancel}
                        className="self-start"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : github.state.status === 'starting' || github.isStarting ? (
                    <PendingRow label="Requesting a device code…" />
                  ) : (
                    <Button size="sm" onClick={github.start} className="gap-2 self-start">
                      <Github />
                      Connect with GitHub
                    </Button>
                  )}

                  {github.state.status === 'error' && github.state.error && (
                    <ErrorNote message={github.state.error} />
                  )}
                </div>
              )}
            </AuthStepCard>
          </div>
        )}

        <div className="flex flex-col items-center gap-2">
          {applyError && step === 'skills' && <ErrorNote message={applyError} />}
          {step === 'auth' ? (
            <>
              <Button size="lg" onClick={() => setStep('personas')} className="w-full">
                {anyConnected ? 'Continue' : 'Continue without connecting'}
              </Button>
              {/* The recommended starter set is installed either way, so
                  skipping loses nothing but the picking. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={complete}
                disabled={completing}
                className="text-muted-foreground"
              >
                {completing && (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                )}
                Skip setup for now
              </Button>
            </>
          ) : (
            <div className="flex w-full items-center gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setStep(step === 'skills' ? 'personas' : 'auth')}
                disabled={applying || completing}
              >
                Back
              </Button>
              {step === 'personas' ? (
                <Button size="lg" onClick={() => setStep('skills')} className="flex-1">
                  Continue
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={finish}
                  disabled={applying || completing}
                  className="flex-1"
                >
                  {(applying || completing) && (
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                  )}
                  Finish setup
                </Button>
              )}
            </div>
          )}
          {step === 'auth' && !anyConnected && (
            <p className="text-muted-foreground text-xs">
              You can connect these any time from Settings.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function describeClaude(claude: { source: string | null; email?: string } | undefined): string {
  if (!claude) return 'Connected'
  if (claude.email) return `Signed in as ${claude.email}`
  return claude.source === 'api_key' ? 'Connected with an API key' : 'Using your Claude Code login'
}

function PendingRow({ label }: { label: string }): React.JSX.Element {
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
      {label}
    </p>
  )
}

function ErrorNote({ message }: { message: string }): React.JSX.Element {
  return <p className="text-destructive text-sm text-pretty">{message}</p>
}

/**
 * A status-probe failure, as opposed to being cleanly logged out. The two must
 * not look alike: this one means "we don't know", so it carries the retry that
 * would answer the question, not a prompt to reconnect credentials that are
 * probably fine.
 */
function ProbeFailedNote({
  message,
  onRetry,
  isRetrying
}: {
  message: string
  onRetry: () => void
  isRetrying: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <ErrorNote message={message} />
      <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
        {isRetrying && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />}
        Check again
      </Button>
    </div>
  )
}
