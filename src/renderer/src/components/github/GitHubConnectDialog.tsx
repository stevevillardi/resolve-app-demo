import { CheckCircle2, Loader2 } from 'lucide-react'
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
 * Real OAuth device flow (Phase 3). The four visual states are the same ones
 * the Phase 2 shell defined; they're now derived from main-process flow state
 * rather than passed in as props.
 */
export function GitHubConnectDialog({
  open,
  onOpenChange
}: GitHubConnectDialogProps): React.JSX.Element {
  const { data: status } = useAuthStatus()
  const flow = useGitHubDeviceFlow()
  const { disconnect, isPending: disconnecting } = useDisconnectGitHub()

  const github = status?.github
  const connected = Boolean(github?.connected)
  const configured = github?.configured ?? true
  const awaiting = flow.state.status === 'awaiting_authorization'
  const starting = flow.state.status === 'starting' || flow.isStarting

  const close = (): void => {
    // Abandoning the dialog abandons the flow — otherwise a stale code keeps
    // polling in the background and "succeeds" long after the user moved on.
    if (!connected && (awaiting || starting)) flow.cancel()
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

        {!connected && !awaiting && !starting && (
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
            <li>· Browse and bind repositories instead of typing paths</li>
            <li>· Let personas with an open_pr scope raise pull requests</li>
            <li>· The token is stored in the OS keychain, never in the database</li>
          </ul>
        )}

        {!connected && awaiting && (
          <DeviceCodeDisplay
            userCode={flow.state.userCode}
            verificationUri={flow.state.verificationUri}
            instruction="Enter this code on GitHub:"
          />
        )}

        {!connected && starting && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none" />
            <p className="text-muted-foreground text-sm">Requesting a device code…</p>
          </div>
        )}

        {connected && (
          <div className="border-border flex items-center gap-2.5 rounded-lg border p-3 text-sm">
            <CheckCircle2 className="text-scope-elevated size-4 shrink-0" />
            <span>
              Connected as{' '}
              <span className="font-mono font-medium">{github?.login ?? 'GitHub'}</span>
            </span>
          </div>
        )}

        {!configured && (
          <p className="text-destructive text-sm text-pretty">
            No GitHub client ID is configured. Set MAIN_VITE_GITHUB_CLIENT_ID in .env — see
            .env.example.
          </p>
        )}

        {flow.state.status === 'error' && flow.state.error && (
          <p className="text-destructive text-sm text-pretty">{flow.state.error}</p>
        )}

        <DialogFooter>
          {!connected && !awaiting && !starting && (
            <Button onClick={flow.start} disabled={!configured} className="gap-2">
              <Github />
              Connect with GitHub
            </Button>
          )}
          {!connected && (awaiting || starting) && (
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
          )}
          {connected && (
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
