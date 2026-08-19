import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import type { AppDatabase } from '../db/create'

/**
 * The reason this lives in main at all: the window's pre-paint background is
 * derived from nativeTheme, so the stored choice has to reach Electron. A
 * preference that round-trips through the database but never sets themeSource
 * would still flash the wrong colour on launch, and nothing else would notice.
 */
let db: AppDatabase
const nativeTheme = { themeSource: 'system' as string }

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({
  get nativeTheme() {
    return nativeTheme
  }
}))

const { applyThemePreference, getThemePreference, setThemePreference } = await import('./theme')
const { setAppState } = await import('./app-state')

beforeEach(() => {
  db = createTestDb()
  nativeTheme.themeSource = 'system'
})

describe('getThemePreference', () => {
  it('defaults to following the OS when nothing is stored', () => {
    expect(getThemePreference()).toBe('system')
  })

  it('reads back what was stored', () => {
    setThemePreference('dark')
    expect(getThemePreference()).toBe('dark')
  })

  it('falls back to system rather than trusting an unknown value', () => {
    // The column is free text; a hand-edited or downgraded row must not put
    // an unusable value into nativeTheme.themeSource.
    setAppState('theme_preference', 'solarized')
    expect(getThemePreference()).toBe('system')
  })
})

describe('reaching Electron', () => {
  it('sets themeSource when the preference changes', () => {
    setThemePreference('dark')
    expect(nativeTheme.themeSource).toBe('dark')
  })

  it('applies the stored preference at startup', () => {
    setAppState('theme_preference', 'light')
    nativeTheme.themeSource = 'system'
    applyThemePreference()
    expect(nativeTheme.themeSource).toBe('light')
  })

  it('applies system for an unset preference, not whatever was there before', () => {
    nativeTheme.themeSource = 'dark'
    applyThemePreference()
    expect(nativeTheme.themeSource).toBe('system')
  })
})
