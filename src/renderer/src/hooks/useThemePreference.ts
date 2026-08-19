import { callProcedure } from '@/lib/ipc-client'
import { useUiStore } from '@/store/useUiStore'
import type { ThemePreference } from '@/lib/theme'

/**
 * The theme choice, written through to main.
 *
 * app_state is the source of truth because main needs the value too — it paints
 * the window background from it before the bundle loads. The renderer keeps its
 * own persisted copy purely as a *first-paint cache*: main.tsx stamps the theme
 * class synchronously before render, and an async IPC round trip there would
 * show the wrong theme for a frame. useThemeSync() reconciles the cache against
 * main once the app is up.
 */
export function useThemePreference(): {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
} {
  const preference = useUiStore((state) => state.themePreference)
  const setCached = useUiStore((state) => state.setThemePreference)

  return {
    preference,
    setPreference: (next) => {
      // Cache first so the repaint is immediate; the write is what makes it
      // survive, and what lets main colour the next launch's window correctly.
      setCached(next)
      void callProcedure('theme.set', { preference: next })
    }
  }
}
