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
import icon from '@/assets/icon.png'
import { ApiKeyField } from './ApiKeyField'
import { AuthStepCard } from './AuthStepCard'

/**
 * First-run setup (blueprint §15A + §9). All three backends are shown at once
 * rather than as a forced wizard: they're independent, none is required to
 * reach the app, and seeing the whole scope up front beats discovering a third
 * step after finishing the second.
 *
 * Nothing here blocks. "Skip for now" is a first-class exit — features that
 * need a given backend gate themselves later instead.
 */
export function OnboardingFlow(): React.JSX.Element {
  const { data: status } = useAuthStatus()
  const { complete, isPending: completing } = useCompleteOnboarding()

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

  return (
    <div className="drag-region bg-background fixed inset-0 z-40 overflow-y-auto">
      <div className="no-drag mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-6 px-6 py-14">
        <header className="drag-region flex flex-col items-center gap-3 text-center">
          <img src={icon} alt="" className="size-14 rounded-[22%] shadow-sm" draggable={false} />
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Welcome to Persona Router</h1>
            <p className="text-muted-foreground text-sm text-pretty">
              Connect the backends your personas will run on. You can do any of this later.
            </p>
          </div>
        </header>

        {status && !status.secretStorageAvailable && (
          <p className="border-destructive/40 text-destructive flex items-start gap-2 rounded-lg border p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Your OS has no available keychain, so credentials can&apos;t be stored securely.
              Persona Router will not save them in plaintext — set up a system keyring and restart.
            </span>
          </p>
        )}

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
                    />
                    <Button variant="ghost" size="sm" onClick={codex.cancel} className="self-start">
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

        <div className="flex flex-col items-center gap-2">
          <Button size="lg" onClick={complete} disabled={completing} className="w-full">
            {completing && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
            {anyConnected ? 'Continue to Persona Router' : 'Skip for now'}
          </Button>
          {!anyConnected && (
            <p className="text-muted-foreground text-xs">
              You can connect these any time from the sidebar.
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
