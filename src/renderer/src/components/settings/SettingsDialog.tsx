import { useState } from 'react'
import {
  Bell,
  CircleDollarSign,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  KeyRound,
  LibraryBig,
  Loader2,
  Monitor,
  Moon,
  Sun
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ClaudeMark, CodexMark } from '@/components/brand/BrandMarks'
import { Github } from '@/components/github/GithubMark'
import { ApiKeyField } from '@/components/onboarding/ApiKeyField'
import { AuthStepCard } from '@/components/onboarding/AuthStepCard'
import { DeviceCodeDisplay } from '@/components/common/DeviceCodeDisplay'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { StarterLibraryDialog } from '@/components/onboarding/StarterLibraryDialog'
import {
  openExternal,
  useAuthStatus,
  useClearAnthropicKey,
  useClearOpenAiKey,
  useCodexLogin,
  useRefreshAuth,
  useSetAnthropicApiKey,
  useSetOpenAiApiKey
} from '@/hooks/useAuth'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  useAppInfo,
  useBudget,
  useChooseWorkspaceRoot,
  useNotificationSettings,
  useResetApp,
  useWorkspaceRoot
} from '@/hooks/useSettings'
import { useUiStore, type ThemePreference } from '@/store/useUiStore'
import { DOCS_URL } from '../../../../shared/menu'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
] as const

/**
 * The settings surface (Phase 17). Before this, everything here was either
 * reachable only during onboarding (Claude/Codex auth — keys could never be
 * changed or removed afterwards), set implicitly with no way to see it
 * (workspace root, written on first clone), or scattered (theme in the rail
 * footer, GitHub in its own dialog).
 *
 * A dialog rather than a nav section on purpose: settings are cross-cutting
 * and small, and a Section would pay the master-detail and PANEL-record tax
 * for four screens of forms. Entry points: the rail footer's gear, ⌘, and the
 * application menu.
 */
export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <SettingsContent />}
    </Dialog>
  )
}

function SettingsContent(): React.JSX.Element {
  const { data: status } = useAuthStatus()
  const setDialog = useUiStore((state) => state.setDialog)
  const themePreference = useUiStore((state) => state.themePreference)
  const setThemePreference = useUiStore((state) => state.setThemePreference)

  const anthropicKey = useSetAnthropicApiKey()
  const openAiKey = useSetOpenAiApiKey()
  const clearAnthropic = useClearAnthropicKey()
  const clearOpenAi = useClearOpenAiKey()
  const codexLogin = useCodexLogin()
  const { refresh, isPending: refreshing } = useRefreshAuth()

  const { data: workspace } = useWorkspaceRoot()
  const { choose, isPending: choosing } = useChooseWorkspaceRoot()
  const notifications = useNotificationSettings()
  const { data: appInfo } = useAppInfo()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const { reset, isPending: resetting } = useResetApp()
  const [showCodexKey, setShowCodexKey] = useState(false)

  const claude = status?.claude
  const codex = status?.codex
  const github = status?.github

  return (
    <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Accounts, workspace, and appearance. Personas and their permissions live in their own
          sections.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 py-1">
        {/* --- Accounts ------------------------------------------------- */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Accounts</SectionLabel>

          <AuthStepCard
            icon={ClaudeMark}
            title="Claude"
            description="Reuses your Claude Code login if you already have one."
            connected={Boolean(claude?.authenticated)}
            connectedLabel={describeClaude(claude)}
          >
            {claude?.authenticated && claude.source === 'api_key' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAnthropic.clear}
                disabled={clearAnthropic.isPending}
                className="gap-1.5"
              >
                <KeyRound className="size-3.5" />
                Remove API key
              </Button>
            ) : (
              !claude?.authenticated && (
                <ApiKeyField
                  label="Anthropic API key"
                  placeholder="sk-ant-…"
                  isPending={anthropicKey.isPending}
                  error={anthropicKey.error}
                  onSubmit={anthropicKey.submit}
                />
              )
            )}
          </AuthStepCard>

          <AuthStepCard
            icon={CodexMark}
            title="Codex"
            description="Reuses your Codex login, or sign in with ChatGPT."
            connected={Boolean(codex?.authenticated)}
            connectedLabel={
              codex?.source === 'api_key' ? 'Connected with an API key' : 'Signed in with ChatGPT'
            }
          >
            {codex?.authenticated ? (
              codex.source === 'api_key' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearOpenAi.clear}
                  disabled={clearOpenAi.isPending}
                  className="gap-1.5"
                >
                  <KeyRound className="size-3.5" />
                  Remove API key
                </Button>
              )
            ) : (
              <div className="flex flex-col gap-3">
                {codex?.error && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-destructive text-sm text-pretty">{codex.error}</p>
                    <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
                      Check again
                    </Button>
                  </div>
                )}
                {codexLogin.state.status === 'awaiting_authorization' ? (
                  <>
                    <DeviceCodeDisplay
                      userCode={codexLogin.state.userCode}
                      verificationUri={codexLogin.state.verificationUri}
                      {...(codexLogin.state.expiresAt !== undefined
                        ? { expiresAt: codexLogin.state.expiresAt }
                        : {})}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={codexLogin.cancel}
                      className="self-start"
                    >
                      Cancel
                    </Button>
                  </>
                ) : codexLogin.state.status === 'starting' || codexLogin.isStarting ? (
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                    Starting Codex sign-in…
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={codexLogin.start}>
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
                {showCodexKey && codexLogin.state.status !== 'awaiting_authorization' && (
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

          <AuthStepCard
            icon={Github}
            title="GitHub"
            description="Browse your repos when creating a contact, and open PRs."
            connected={Boolean(github?.connected)}
            connectedLabel={github?.login ? `Connected as ${github.login}` : 'Connected'}
          >
            {/* Connect, reconnect and disconnect already live in the GitHub
                dialog with its device flow — one door, not two. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialog('github')}
              className="self-start"
            >
              Manage connection…
            </Button>
          </AuthStepCard>
        </section>

        {/* --- Workspace ------------------------------------------------ */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Workspace</SectionLabel>
          <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-4">
            <FolderOpen className="text-muted-foreground size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-title font-medium">Where clones land</p>
              <p
                className="text-muted-foreground truncate font-mono text-xs"
                title={workspace?.path ?? undefined}
              >
                {workspace?.path
                  ? workspace.exists
                    ? workspace.path
                    : `${workspace.path} — missing on disk`
                  : 'Not set — you’ll be asked on the first clone.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={choose} disabled={choosing}>
              Change…
            </Button>
            <p className="text-muted-foreground w-full text-xs text-pretty">
              Changing this affects future clones only; existing contacts keep their repositories
              where they are.
            </p>
          </div>
        </section>

        {/* --- Notifications -------------------------------------------- */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Notifications</SectionLabel>
          <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-4">
            <Bell className="text-muted-foreground size-5 shrink-0" />
            <p className="text-muted-foreground min-w-0 flex-1 text-sm text-pretty">
              A routine finishing, a reply landing while you’re elsewhere, a budget crossing — as
              system notifications. Clicking one opens the conversation.
            </p>
            <Switch
              checked={notifications.enabled}
              onCheckedChange={notifications.setEnabled}
              aria-label="OS notifications"
            />
          </div>
        </section>

        {/* --- Budgets -------------------------------------------------- */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Budgets</SectionLabel>
          <BudgetRow />
        </section>

        {/* --- Appearance ----------------------------------------------- */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Appearance</SectionLabel>
          <SegmentedControl
            options={THEME_OPTIONS}
            value={themePreference}
            onChange={(value) => setThemePreference(value as ThemePreference)}
            aria-label="Theme"
          />
        </section>

        {/* --- Library -------------------------------------------------- */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>Starter library</SectionLabel>
          <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-4">
            <LibraryBig className="text-muted-foreground size-5 shrink-0" />
            <p className="text-muted-foreground min-w-0 flex-1 text-sm text-pretty">
              The built-in personas and Skills, addable and removable any time.
            </p>
            <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
              Browse…
            </Button>
          </div>
        </section>

        {/* --- Developer ------------------------------------------------ */}
        {appInfo?.dev && (
          <section className="flex flex-col gap-2.5">
            <SectionLabel>Developer</SectionLabel>
            <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-4">
              <FlaskConical className="text-muted-foreground size-5 shrink-0" />
              <p className="text-muted-foreground min-w-0 flex-1 text-sm text-pretty">
                Wipe everything and relaunch as a fresh install — for testing onboarding and
                seeding.
              </p>
              <Button variant="outline" size="sm" onClick={() => setConfirmingReset(true)}>
                Reset app…
              </Button>
            </div>
          </section>
        )}

        {/* --- About ---------------------------------------------------- */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel>About</SectionLabel>
          <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
            <span>
              Switchboard{' '}
              <span className="text-foreground font-mono tabular-nums">{appInfo?.version}</span>
            </span>
            <span className="font-mono">{appInfo?.platform}</span>
            <button
              type="button"
              onClick={() => openExternal(DOCS_URL)}
              className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              Documentation
              <ExternalLink className="size-3" />
            </button>
          </div>
        </section>
      </div>

      <StarterLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />

      {confirmingReset && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && setConfirmingReset(false)}
          closeOnConfirm={false}
          busy={resetting}
          title="Reset Switchboard to a fresh install?"
          description="The app relaunches straight into onboarding, exactly like a first run."
          consequence={
            <>
              <p className="mb-1 font-medium">Deleted:</p>
              <ul className="flex flex-col gap-0.5">
                <li>Every contact, conversation, routine, and usage record</li>
                <li>All personas and Skills (the starter catalog re-seeds)</li>
                <li>Stored credentials (GitHub token, API keys)</li>
                <li>Agent worktrees and their persona/* branches</li>
                <li>UI preferences</li>
              </ul>
              <p className="mt-2">
                Kept: your Claude Code and Codex logins, and every cloned repository on disk.
              </p>
            </>
          }
          confirmLabel={resetting ? 'Resetting…' : 'Reset and relaunch'}
          onConfirm={reset}
        />
      )}
    </DialogContent>
  )
}

/**
 * The app-level monthly threshold. Alerts only, and the copy says so — a
 * number field labelled "budget" invites the assumption that something gets
 * cut off, and nothing here ever stops running. Committed on blur/Enter so a
 * half-typed figure never round-trips.
 */
function BudgetRow(): React.JSX.Element {
  const { monthlyBudgetUsd, setBudget } = useBudget()
  const [draft, setDraft] = useState<string | null>(null)

  const shown = draft ?? (monthlyBudgetUsd === null ? '' : String(monthlyBudgetUsd))

  const commit = (): void => {
    if (draft === null) return
    const trimmed = draft.trim()
    const value = Number(trimmed)
    if (trimmed === '') setBudget(null)
    else if (Number.isFinite(value) && value > 0) setBudget(value)
    setDraft(null)
  }

  return (
    <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-4">
      <CircleDollarSign className="text-muted-foreground size-5 shrink-0" />
      <p className="text-muted-foreground min-w-0 flex-1 text-sm text-pretty">
        A soft monthly threshold across everything the app runs. Crossing it notifies and shows a
        note on Home — alerts only, nothing stops running. Routines can carry their own threshold in
        their editor.
      </p>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-sm">$</span>
        <Input
          className="w-24 text-right font-mono tabular-nums"
          inputMode="decimal"
          placeholder="none"
          aria-label="Monthly budget in US dollars"
          value={shown}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
        <span className="text-muted-foreground text-sm">/ month</span>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-muted-foreground text-meta font-medium tracking-wide uppercase">
      {children}
    </p>
  )
}

function describeClaude(claude: { source: string | null; email?: string } | undefined): string {
  if (!claude) return 'Connected'
  if (claude.email) return `Signed in as ${claude.email}`
  return claude.source === 'api_key' ? 'Connected with an API key' : 'Using your Claude Code login'
}
