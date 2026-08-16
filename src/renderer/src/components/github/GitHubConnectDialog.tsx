import { useEffect, useState } from 'react'
import { Check, CheckCircle2, Copy, ExternalLink, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Github } from './GithubMark'

export type GitHubConnectStatus =
  'not_connected' | 'awaiting_authorization' | 'polling' | 'connected'

interface GitHubConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: GitHubConnectStatus
  userCode?: string
  verificationUrl?: string
  accountLogin?: string
  onConnect?: () => void
}

// Fully static shell (Phase 2) — no real device-flow polling or IPC calls.
// Phase 3 (docs/plan/03-app-auth.md) wires `status`/callbacks to real OAuth
// device-flow state; the 4 states below are the full contract it needs.
export function GitHubConnectDialog({
  open,
  onOpenChange,
  status,
  userCode = 'WXYZ-1234',
  verificationUrl = 'https://github.com/login/device',
  accountLogin = 'octocat',
  onConnect
}: GitHubConnectDialogProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

        {status === 'not_connected' && (
          <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
            <li>· Browse and bind repositories instead of typing paths</li>
            <li>· Let personas with an open_pr scope raise pull requests</li>
            <li>· The token is stored in the OS keychain, never in the database</li>
          </ul>
        )}

        {status === 'awaiting_authorization' && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <p className="text-muted-foreground text-sm">Enter this code on GitHub:</p>
            {/* Large and monospaced because the user has to read it out
                character by character into another window. */}
            <div className="bg-muted flex items-center gap-2 rounded-lg py-2 pr-2 pl-4">
              <span className="font-mono text-2xl font-semibold tracking-[0.2em] tabular-nums">
                {userCode}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={copied ? 'Copied' : 'Copy code'}
                onClick={() => {
                  void navigator.clipboard.writeText(userCode).then(() => setCopied(true))
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <a
              href={verificationUrl}
              className="text-primary inline-flex items-center gap-1 text-sm underline underline-offset-2"
            >
              {verificationUrl}
              <ExternalLink className="size-3" />
            </a>
          </div>
        )}

        {status === 'polling' && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none" />
            <p className="text-muted-foreground text-sm">Waiting for authorization…</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="border-border flex items-center gap-2.5 rounded-lg border p-3 text-sm">
            <CheckCircle2 className="text-scope-elevated size-4 shrink-0" />
            <span>
              Connected as <span className="font-mono font-medium">{accountLogin}</span>
            </span>
          </div>
        )}

        <DialogFooter>
          {status === 'not_connected' && (
            <Button onClick={onConnect} className="gap-2">
              <Github />
              Connect with GitHub
            </Button>
          )}
          {(status === 'awaiting_authorization' || status === 'polling') && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          {status === 'connected' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
