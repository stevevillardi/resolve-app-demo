import { describe, expect, it } from 'vitest'
import {
  altKey,
  firstSteps,
  guideConcepts,
  modifierKey,
  nextStep,
  shortcutHints,
  type GuideProgress
} from './guide'
import { NAV_ITEMS } from './nav-items'
import { MENU_ACCELERATORS } from '../../../shared/menu'

/**
 * The guide's three claims.
 *
 * That the checklist reflects the profile rather than remembering a click —
 * which is what makes deleting every contact put the first step back; that
 * adding a section to the rail cannot leave it without an explanation; and
 * that the keys it prints are the ones the application menu actually binds.
 *
 * The last of those is checked against `MENU_ACCELERATORS` rather than against
 * `app-menu.ts` itself: the renderer may not import from `src/main`, which is
 * exactly why the accelerators moved to shared/ instead of staying literals in
 * a file this side of the boundary cannot see. `app-menu.test.ts` holds the
 * other half — that the menu really registers them, once each.
 */

/** A profile that has done nothing, with GitHub available to connect. */
function fresh(overrides: Partial<GuideProgress> = {}): GuideProgress {
  return {
    contacts: 0,
    turns: 0,
    routines: 0,
    githubConnected: false,
    githubConfigurable: true,
    ...overrides
  }
}

describe('guideConcepts', () => {
  it('explains every section the rail can reach', () => {
    const explained = new Set(guideConcepts().map((concept) => concept.section))
    const reachable = NAV_ITEMS.map((item) => item.section).filter((section) => section !== 'home')

    expect(explained.size).toBe(reachable.length)
    for (const section of reachable) expect(explained.has(section)).toBe(true)
  })

  it('leaves Home out — it is the screen doing the explaining', () => {
    expect(guideConcepts().some((concept) => concept.section === ('home' as never))).toBe(false)
  })

  it('walks the rail in its own order, so the guide and the rail agree', () => {
    expect(guideConcepts().map((concept) => concept.section)).toEqual(
      NAV_ITEMS.filter((item) => item.section !== 'home').map((item) => item.section)
    )
  })

  it('carries the rail’s own labels and icons rather than a second copy', () => {
    for (const concept of guideConcepts()) {
      const item = NAV_ITEMS.find((candidate) => candidate.section === concept.section)
      expect(concept.label).toBe(item?.label)
      expect(concept.icon).toBe(item?.icon)
      expect(concept.blurb.length).toBeGreaterThan(0)
    }
  })
})

describe('firstSteps', () => {
  it('starts with nothing done on a fresh profile', () => {
    const steps = firstSteps(fresh())
    expect(steps.map((step) => step.id)).toEqual(['contact', 'message', 'github', 'routine'])
    expect(steps.every((step) => !step.done)).toBe(true)
  })

  it('ticks each step off the state that produced it', () => {
    const steps = firstSteps(fresh({ contacts: 2, turns: 7, routines: 1, githubConnected: true }))
    expect(steps.every((step) => step.done)).toBe(true)
  })

  // The point of reading live counts rather than remembering a click: a profile
  // that had contacts and lost them is a profile that needs the first step back.
  it('un-ticks a step when the thing it produced is gone', () => {
    const had = firstSteps(fresh({ contacts: 1 }))
    expect(had.find((step) => step.id === 'contact')?.done).toBe(true)

    const deleted = firstSteps(fresh({ contacts: 0 }))
    expect(deleted.find((step) => step.id === 'contact')?.done).toBe(false)
  })

  it('drops the GitHub step entirely when the flow cannot start', () => {
    const steps = firstSteps(fresh({ githubConfigurable: false }))
    expect(steps.map((step) => step.id)).toEqual(['contact', 'message', 'routine'])
  })

  it('keeps the GitHub step where it belongs in the order, not appended', () => {
    expect(
      firstSteps(fresh())
        .map((step) => step.id)
        .indexOf('github')
    ).toBe(2)
  })
})

describe('nextStep', () => {
  it('is the first outstanding one, not the first in the list', () => {
    const steps = firstSteps(fresh({ contacts: 1, turns: 3 }))
    expect(nextStep(steps)?.id).toBe('github')
  })

  it('skips a done step in the middle', () => {
    const steps = firstSteps(fresh({ contacts: 1, githubConnected: true }))
    expect(nextStep(steps)?.id).toBe('message')
  })

  it('is null once every step is done', () => {
    const steps = firstSteps(fresh({ contacts: 1, turns: 1, routines: 1, githubConnected: true }))
    expect(nextStep(steps)).toBeNull()
  })
})

describe('shortcutHints', () => {
  it('writes the modifier the way the platform does', () => {
    expect(modifierKey('darwin')).toBe('⌘')
    expect(modifierKey('win32')).toBe('Ctrl+')
    expect(modifierKey('linux')).toBe('Ctrl+')
  })

  it('writes the alt key the way the platform does', () => {
    expect(altKey('darwin')).toBe('⌥')
    expect(altKey('win32')).toBe('Alt+')
    expect(altKey('linux')).toBe('Alt+')
  })

  // appInfo.get is a query, so the first frame renders without an answer.
  it('assumes macOS while the platform is still unknown', () => {
    expect(modifierKey(undefined)).toBe('⌘')
    expect(altKey(undefined)).toBe('⌥')
  })

  it('lists every binding the app claims, once each', () => {
    const keys = shortcutHints('darwin').map((hint) => hint.keys)
    expect(keys).toEqual(['⌘K', '⌘N', '⌥↑ ⌥↓', '⌘L', '⌘B', '⌘,', '/'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('advertises every accelerator the application menu claims, on both platforms', () => {
    for (const [platform, mod] of [
      ['darwin', '⌘'],
      ['win32', 'Ctrl+']
    ] as const) {
      const advertised = new Set(shortcutHints(platform).map((hint) => hint.keys))
      for (const accelerator of Object.values(MENU_ACCELERATORS)) {
        expect(advertised.has(accelerator.replace('CmdOrCtrl+', mod))).toBe(true)
      }
    }
  })

  // The rewrite is a substring replace, so a key whose *name* contained the
  // prefix would be mangled. None do, and this is what says so out loud.
  //
  // ⌥↑/⌥↓ is here for a second reason: it is the one hint carrying a modifier
  // the *menu* never sees, so nothing in `MENU_ACCELERATORS` would catch it
  // being left as a macOS glyph on Windows. That is precisely how it was first
  // written.
  it('rewrites only the modifier, never the key', () => {
    expect(shortcutHints('win32').map((hint) => hint.keys)).toEqual([
      'Ctrl+K',
      'Ctrl+N',
      'Alt+↑ Alt+↓',
      'Ctrl+L',
      'Ctrl+B',
      'Ctrl+,',
      '/'
    ])
  })

  it('does not modify the unmodified ones', () => {
    expect(shortcutHints('win32').map((hint) => hint.keys)).toContain('/')
  })

  it('says what each one does', () => {
    for (const hint of shortcutHints('darwin')) expect(hint.label.length).toBeGreaterThan(0)
  })
})
