import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DeviceCodeDisplay } from '@/components/common/DeviceCodeDisplay'
import { useAuthStatus, useDisconnectGitHub, useGitHubDeviceFlow } from '@/hooks/useAuth'
import { Github } from './GithubMark'

interface GitHubConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Real OAuth device flow. The four visual states are derived from
 * main-process flow state rather than passed in as props.
 */
export function GitHubConnectDialog({
  open,
  onOpenChange
}: GitHubConnectDialogProps): React.JSX.Element {
  const { data: status } = useAuthStatus()
  const flow = useGitHubDeviceFlow()
  const { disconnect, isPending: disconnecting } = useDisconnectGitHub()

  const github = status?.github
  /**
   * `connected` means a token is stored, which is not the same as it working.
   * Branching on it alone would hide the Connect button behind a green
   * "Connected as …" the moment a token is revoked — leaving Disconnect as the
   * only way to reach the flow that would have fixed it. Every branch below
   * that offers the flow keys on `healthy` instead.
   */
  const rejected = Boolean(github?.connected) && github?.tokenState === 'rejected'
  const locked = Boolean(github?.connected) && github?.tokenState === 'locked'
  const healthy = Boolean(github?.connected) && !rejected && !locked
  const configured = github?.configured ?? true
  const awaiting = flow.state.status === 'awaiting_authorization'
  const starting = flow.state.status === 'starting' || flow.isStarting

  const close = (): void => {
    // Abandoning the dialog abandons the flow — otherwise a stale code keeps
    // polling in the background and "succeeds" long after the user moved on.
    if (!healthy && (awaiting || starting)) flow.cancel()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github />
            Connect GitHub
          </DialogTitle>
          <DialogDescription>
            Used to list your repos when creating a contact, and to open pull requests on a
            persona&apos;s behalf.
          </DialogDescription>
        </DialogHeader>

        {!healthy && !rejected && !awaiting && !starting && (
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
            <li>· Browse and bind repositories instead of typing paths</li>
            <li>· Let personas with an open_pr scope raise pull requests</li>
            <li>· The token is stored in the OS keychain, never in the database</li>
          </ul>
        )}

        {!healthy && awaiting && (
          <DeviceCodeDisplay
            userCode={flow.state.userCode}
            verificationUri={flow.state.verificationUri}
            instruction="Enter this code on GitHub:"
            {...(flow.state.expiresAt !== undefined ? { expiresAt: flow.state.expiresAt } : {})}
          />
        )}

        {!healthy && starting && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none" />
            <p className="text-muted-foreground text-sm">Requesting a device code…</p>
          </div>
        )}

        {healthy && (
          <div className="border-border flex items-center gap-2.5 rounded-lg border p-3 text-sm">
            <CheckCircle2 className="text-scope-elevated size-4 shrink-0" />
            <span>
              Connected as{' '}
              <span className="font-mono font-medium">{github?.login ?? 'GitHub'}</span>
            </span>
          </div>
        )}

        {/* Names the account, because which one was connected is the first
            thing you need to know when deciding whether the revocation was
            deliberate. */}
        {rejected && !awaiting && !starting && (
          <div className="border-destructive/40 bg-destructive/5 flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
            <span>
              GitHub rejected the stored token
              {github?.login ? (
                <>
                  {' '}
                  for <span className="font-mono font-medium">{github.login}</span>
                </>
              ) : null}
              . It was revoked or has expired. Connecting again replaces it — nothing else about
              your contacts or personas changes.
            </span>
          </div>
        )}

        {/* Not a revocation and not GitHub's doing: the ciphertext outlived
            the build that wrote it. Reconnecting just re-saves the credential
            under the current binary. */}
        {locked && !awaiting && !starting && (
          <div className="border-scope-elevated/40 bg-scope-elevated/5 flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <AlertTriangle className="text-scope-elevated mt-0.5 size-4 shrink-0" />
            <span>
              The stored token
              {github?.login ? (
                <>
                  {' '}
                  for <span className="font-mono font-medium">{github.login}</span>
                </>
              ) : null}{' '}
              can&apos;t be unlocked by this build of the app — the binary changed, and the OS
              keychain ties the credential to it. Nothing was revoked; connect again once to re-save
              it.
            </span>
          </div>
        )}

        {!configured && (
          <p className="text-destructive text-sm text-pretty">
            GitHub sign-in isn’t available in this build of Switchboard.
          </p>
        )}

        {flow.state.status === 'error' && flow.state.error && (
          <p className="text-destructive text-sm text-pretty">{flow.state.error}</p>
        )}

        <DialogFooter>
          {!healthy && !awaiting && !starting && (
            <Button onClick={flow.start} disabled={!configured} className="gap-2">
              <Github />
              {rejected || locked ? 'Reconnect GitHub' : 'Connect with GitHub'}
            </Button>
          )}
          {!healthy && (awaiting || starting) && (
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
          )}
          {healthy && (
            <>
              <Button variant="ghost" onClick={disconnect} disabled={disconnecting}>
                Disconnect
              </Button>
              <Button variant="outline" onClick={close}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
