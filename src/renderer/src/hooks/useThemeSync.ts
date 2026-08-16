import { useEffect } from 'react'
import { useUiStore } from '@/store/useUiStore'

export function useThemeSync(): void {
  const themePreference = useUiStore((state) => state.themePreference)

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const applyClass = (isDark: boolean): void => {
      root.classList.toggle('dark', isDark)
      root.classList.toggle('light', !isDark)
    }

    if (themePreference === 'system') {
      applyClass(media.matches)
      const onChange = (event: MediaQueryListEvent): void => applyClass(event.matches)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }

    applyClass(themePreference === 'dark')
    return undefined
  }, [themePreference])
}
