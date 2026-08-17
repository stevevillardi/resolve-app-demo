import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow'
import { SplashScreen } from '@/components/launch/SplashScreen'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStatus } from '@/hooks/useAuth'

/**
 * How long the splash stays up regardless of how fast the auth check settles.
 * A warm start resolves in tens of milliseconds, and a splash that appears and
 * vanishes inside one frame reads as a glitch — worse than not having one.
 */
const SPLASH_MINIMUM_MS = 650
/** Must match the fade duration in SplashScreen so it unmounts after fading. */
const SPLASH_FADE_MS = 300

/**
 * The launch flow: splash → onboarding (first run) or the shell (returning).
 * This is the only place that decides which of the three is on screen.
 */
function App(): React.JSX.Element {
  const { data: status, isPending, isError, error, refetch } = useAuthStatus()
  const [floorElapsed, setFloorElapsed] = useState(false)
  const [splashMounted, setSplashMounted] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setFloorElapsed(true), SPLASH_MINIMUM_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const settled = !isPending || isError
  const splashLeaving = settled && floorElapsed && !isError

  // Unmount only after the fade has run, so the splash doesn't cut away.
  useEffect(() => {
    if (!splashLeaving) return undefined
    const timer = window.setTimeout(() => setSplashMounted(false), SPLASH_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [splashLeaving])

  return (
    <>
      {/* Rendered underneath the splash so it has already painted by the time
          the splash fades out — otherwise the fade reveals an empty window. */}
      {settled && !isError && (status?.onboardingCompleted ? <AppShell /> : <OnboardingFlow />)}

      {splashMounted && (
        <SplashScreen
          leaving={splashLeaving}
          error={
            isError
              ? `${error instanceof Error ? error.message : 'The app could not read its authentication state.'}`
              : undefined
          }
          onRetry={isError ? () => void refetch() : undefined}
        />
      )}

      <Toaster />
    </>
  )
}

export default App
