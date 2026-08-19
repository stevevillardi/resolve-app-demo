import { useEffect } from 'react'
import { applyThemeClass, subscribeToSystemTheme } from '@/lib/theme'
import { callProcedure } from '@/lib/ipc-client'
import { useUiStore } from '@/store/useUiStore'

/**
 * Keeps <html>'s theme class in sync with the store, and the store in sync with
 * main.
 *
 * The initial stamp happens in main.tsx before render (see lib/theme.ts) from
 * the renderer's persisted copy, which is a cache — app_state is the source of
 * truth, because main paints the window background from it. This reconciles the
 * two once, which matters when the last write came from a different build:
 * renderer storage is scoped to the page origin, so a dev run (http://) and a
 * packaged run (file://) keep separate caches over one shared app_state.
 *
 * Called once, from AppShell.
 */
export function useThemeSync(): void {
  const themePreference = useUiStore((state) => state.themePreference)
  const setThemePreference = useUiStore((state) => state.setThemePreference)

  useEffect(() => {
    let cancelled = false
    void callProcedure('theme.get', undefined).then(({ preference }) => {
      if (!cancelled) setThemePreference(preference)
    })
    return () => {
      cancelled = true
    }
  }, [setThemePreference])

  useEffect(() => {
    applyThemeClass(themePreference)
    if (themePreference !== 'system') return undefined
    return subscribeToSystemTheme(() => applyThemeClass('system'))
  }, [themePreference])
}
