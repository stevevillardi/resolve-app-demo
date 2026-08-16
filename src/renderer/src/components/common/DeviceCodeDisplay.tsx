import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openExternal } from '@/hooks/useAuth'

interface DeviceCodeDisplayProps {
  userCode?: string
  verificationUri?: string
  /** Overrides the default "Enter this code on GitHub:"-style lead-in. */
  instruction?: string
}

/**
 * GitHub and Codex both authenticate by showing a one-time code to type into a
 * browser, so they share this block rather than each dialog reimplementing the
 * copy-button/monospace-code/verification-link trio.
 */
export function DeviceCodeDisplay({
  userCode,
  verificationUri,
  instruction = 'Enter this code after opening the link:'
}: DeviceCodeDisplayProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <p className="text-muted-foreground text-sm">{instruction}</p>
      {/* Large and monospaced because the user has to read it out
          character by character into another window. */}
      <div className="bg-muted flex items-center gap-2 rounded-lg py-2 pr-2 pl-4">
        <span className="font-mono text-2xl font-semibold tracking-[0.2em] tabular-nums">
          {userCode ?? '········'}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!userCode}
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={() => {
            if (!userCode) return
            void navigator.clipboard.writeText(userCode).then(() => setCopied(true))
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      {verificationUri && (
        // A button, not an <a>: the renderer has no ambient browser, so opening
        // the URL is an explicit allowlisted main-process action.
        <Button
          variant="link"
          size="sm"
          className="h-auto gap-1 p-0"
          onClick={() => openExternal(verificationUri)}
        >
          {verificationUri}
          <ExternalLink className="size-3" />
        </Button>
      )}
    </div>
  )
}
