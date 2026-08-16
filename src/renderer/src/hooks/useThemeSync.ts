import { useEffect } from 'react'
import { applyThemeClass, subscribeToSystemTheme } from '@/lib/theme'
import { useUiStore } from '@/store/useUiStore'

/**
 * Keeps <html>'s theme class in sync with the store.
 *
 * The initial stamp happens in main.tsx before render (see lib/theme.ts), so
 * this only handles later changes: the user picking a preference, or the OS
 * flipping while the preference is 'system'.
 */
export function useThemeSync(): void {
  const themePreference = useUiStore((state) => state.themePreference)

  useEffect(() => {
    applyThemeClass(themePreference)
    if (themePreference !== 'system') return undefined
    return subscribeToSystemTheme(() => applyThemeClass('system'))
  }, [themePreference])
}
