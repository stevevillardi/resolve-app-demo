import { nativeTheme } from 'electron'
import { getAppState, setAppState } from './app-state'
import { themePreferenceSchema, type ThemePreference } from '../../shared/domain'

/**
 * The user's theme choice, and the one place it reaches Electron.
 *
 * Main needs this, which is why it is not renderer-only state: BrowserWindow's
 * `backgroundColor` is painted before the bundle loads, and deriving it from
 * the OS theme meant someone running the app dark on a light system watched it
 * flash white on every launch. Setting `nativeTheme.themeSource` makes
 * `shouldUseDarkColors` answer for the *user's* choice instead, so the existing
 * background logic becomes correct without knowing this module exists.
 */
export function getThemePreference(): ThemePreference {
  const stored = themePreferenceSchema.safeParse(getAppState('theme_preference'))
  // Absent (or nonsense from a hand-edited row) means follow the OS.
  return stored.success ? stored.data : 'system'
}

export function setThemePreference(preference: ThemePreference): ThemePreference {
  setAppState('theme_preference', preference)
  applyThemePreference(preference)
  return preference
}

/** Pushes the stored choice into Electron. Call once at startup, then on change. */
export function applyThemePreference(preference = getThemePreference()): void {
  nativeTheme.themeSource = preference
}
