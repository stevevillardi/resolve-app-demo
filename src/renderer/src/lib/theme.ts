export type ThemePreference = 'system' | 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') return prefersDark() ? 'dark' : 'light'
  return preference
}

/**
 * Stamps the resolved theme onto <html>.
 *
 * Called once from module scope in main.tsx before createRoot().render(), so
 * the first paint is already correct. An inline <script> in index.html would
 * be the usual place for this, but the renderer's CSP is `script-src 'self'`
 * and weakening it for a class toggle is a bad trade.
 */
export function applyThemeClass(preference: ThemePreference): void {
  const isDark = resolveTheme(preference) === 'dark'
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
  root.classList.toggle('light', !isDark)
  // Drives the UA-rendered form controls and scrollbar gutters.
  root.style.colorScheme = isDark ? 'dark' : 'light'
}

export function subscribeToSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
