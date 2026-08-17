import { describe, expect, it } from 'vitest'
import { buildAppMenuTemplate, type AppMenuItem } from './app-menu'

/**
 * The menu as data, per the tray-menu split: what exists on which platform,
 * which items are dev-only, and which accelerators the app claims. index.ts
 * only maps this onto Electron, so structure proven here is structure shipped.
 */

function flatten(items: AppMenuItem[]): AppMenuItem[] {
  return items.flatMap((item) => [item, ...(item.submenu ? flatten(item.submenu) : [])])
}

describe('buildAppMenuTemplate', () => {
  it('leads with the app menu on macOS and not elsewhere', () => {
    const darwin = buildAppMenuTemplate({ platform: 'darwin', isDev: false })
    expect(darwin[0].label).toBe('Persona Router')
    expect(darwin[0].submenu?.some((item) => item.role === 'about')).toBe(true)
    expect(darwin[0].submenu?.some((item) => item.role === 'quit')).toBe(true)

    const linux = buildAppMenuTemplate({ platform: 'linux', isDev: false })
    expect(linux[0].label).toBe('File')
  })

  it('puts Settings in the app menu on macOS and under File elsewhere', () => {
    const darwin = buildAppMenuTemplate({ platform: 'darwin', isDev: false })
    const darwinApp = darwin[0].submenu ?? []
    const darwinFile = darwin.find((menu) => menu.label === 'File')?.submenu ?? []
    expect(darwinApp.some((item) => item.action === 'open-settings')).toBe(true)
    expect(darwinFile.some((item) => item.action === 'open-settings')).toBe(false)

    const win = buildAppMenuTemplate({ platform: 'win32', isDev: false })
    const winFile = win.find((menu) => menu.label === 'File')?.submenu ?? []
    expect(winFile.some((item) => item.action === 'open-settings')).toBe(true)
    // No app menu on win32, so quit has to live somewhere reachable.
    expect(winFile.some((item) => item.role === 'quit')).toBe(true)
  })

  it('claims the app accelerators once each', () => {
    const all = flatten(buildAppMenuTemplate({ platform: 'darwin', isDev: false }))
    const accelerators = all.map((item) => item.accelerator).filter(Boolean)
    // ⌘N new contact, ⌘, settings, ⌘K palette — and no duplicates, which is
    // what silently breaks whichever binding registered second.
    expect(accelerators).toContain('CmdOrCtrl+N')
    expect(accelerators).toContain('CmdOrCtrl+,')
    expect(accelerators).toContain('CmdOrCtrl+K')
    expect(new Set(accelerators).size).toBe(accelerators.length)
  })

  it('shows Reload and DevTools only in development', () => {
    const dev = flatten(buildAppMenuTemplate({ platform: 'darwin', isDev: true }))
    const packaged = flatten(buildAppMenuTemplate({ platform: 'darwin', isDev: false }))
    expect(dev.some((item) => item.role === 'toggleDevTools')).toBe(true)
    expect(packaged.some((item) => item.role === 'toggleDevTools')).toBe(false)
    expect(packaged.some((item) => item.role === 'reload')).toBe(false)
  })

  it('offers help as an app action, not a dead label', () => {
    const all = flatten(buildAppMenuTemplate({ platform: 'darwin', isDev: false }))
    expect(all.some((item) => item.action === 'open-docs')).toBe(true)
  })

  it('keeps every edit role a text field depends on', () => {
    // Cut/copy/paste through the menu (and their accelerators) only exist if
    // the roles are present — Electron does not bind them for you without a
    // menu, which is how ⌘C in an input silently breaks.
    const edit = buildAppMenuTemplate({ platform: 'darwin', isDev: false }).find(
      (menu) => menu.label === 'Edit'
    )
    const roles = (edit?.submenu ?? []).map((item) => item.role)
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(roles).toContain(role)
    }
  })
})
