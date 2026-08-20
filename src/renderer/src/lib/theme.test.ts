import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemeClass, prefersDark, resolveTheme, subscribeToSystemTheme } from './theme'

/**
 * Theme resolution runs before first paint (main.tsx calls applyThemeClass at
 * module scope), so getting it wrong shows up as a white flash on every launch
 * for a dark-mode user.
 */

let systemPrefersDark = false
const listeners = new Set<() => void>()

beforeEach(() => {
  systemPrefersDark = false
  listeners.clear()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') && systemPrefersDark,
    addEventListener: (_e: string, cb: () => void) => void listeners.add(cb),
    removeEventListener: (_e: string, cb: () => void) => void listeners.delete(cb)
  }))
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersDark', () => {
  it('reflects the system setting', () => {
    expect(prefersDark()).toBe(false)
    systemPrefersDark = true
    expect(prefersDark()).toBe(true)
  })
})

describe('resolveTheme', () => {
  it('honours an explicit preference regardless of the system', () => {
    systemPrefersDark = true
    expect(resolveTheme('light')).toBe('light')
    systemPrefersDark = false
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('follows the system when set to system', () => {
    expect(resolveTheme('system')).toBe('light')
    systemPrefersDark = true
    expect(resolveTheme('system')).toBe('dark')
  })
})

describe('applyThemeClass', () => {
  it('stamps dark and clears light', () => {
    applyThemeClass('dark')
    const root = document.documentElement
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
  })

  it('stamps light and clears dark', () => {
    applyThemeClass('dark')
    applyThemeClass('light')
    const root = document.documentElement
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('never leaves both classes set when toggling', () => {
    for (const preference of ['dark', 'light', 'system', 'dark'] as const) {
      applyThemeClass(preference)
      const { classList } = document.documentElement
      expect(classList.contains('dark') && classList.contains('light')).toBe(false)
    }
  })

  it('sets colorScheme so UA controls and scrollbars match', () => {
    applyThemeClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    applyThemeClass('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('resolves system through to the OS setting', () => {
    systemPrefersDark = true
    applyThemeClass('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('subscribeToSystemTheme', () => {
  it('invokes the callback when the OS theme flips', () => {
    const onChange = vi.fn()
    subscribeToSystemTheme(onChange)
    listeners.forEach((listener) => listener())
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('unsubscribes cleanly', () => {
    const onChange = vi.fn()
    subscribeToSystemTheme(onChange)()
    expect(listeners.size).toBe(0)
    listeners.forEach((listener) => listener())
    expect(onChange).not.toHaveBeenCalled()
  })
})
