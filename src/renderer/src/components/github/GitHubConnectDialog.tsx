import { useState } from 'react'
import { CheckCircle2, GitFork, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type GitHubConnectStatus =
  'not_connected' | 'awaiting_authorization' | 'polling' | 'connected'

interface GitHubConnectDialogProps {
  status: GitHubConnectStatus
  userCode?: string
  verificationUrl?: string
  accountLogin?: string
  onConnect?: () => void
  trigger: React.ReactElement
}

// Fully static shell (Phase 2) — no real device-flow polling or IPC calls.
// Phase 3 (docs/plan/03-app-auth.md) wires `status`/callbacks to real OAuth
// device-flow state; the 4 states below are the full contract it needs.
export function GitHubConnectDialog({
  status,
  userCode = 'WXYZ-1234',
  verificationUrl = 'https://github.com/login/device',
  accountLogin = 'octocat',
  onConnect,
  trigger
}: GitHubConnectDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="size-4" />
            Connect GitHub
          </DialogTitle>
          <DialogDescription>
            Used to bind repos to contacts and open pull requests on their behalf.
          </DialogDescription>
        </DialogHeader>

        {status === 'not_connected' && (
          <p className="text-muted-foreground text-sm">
            Not connected yet. Connecting authorizes device access via GitHub&apos;s OAuth device
            flow.
          </p>
        )}

        {status === 'awaiting_authorization' && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="text-muted-foreground text-sm">Enter this code at {verificationUrl}:</p>
            <p className="font-mono text-2xl font-semibold tracking-widest">{userCode}</p>
          </div>
        )}

        {status === 'polling' && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
            <p className="text-muted-foreground text-sm">Waiting for authorization…</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="flex items-center gap-2 py-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Connected as <span className="font-medium">{accountLogin}</span>
          </div>
        )}

        <DialogFooter>
          {status === 'not_connected' && <Button onClick={onConnect}>Connect with GitHub</Button>}
          {status === 'connected' && (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
