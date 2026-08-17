import type { MenuItemConstructorOptions } from 'electron'
import type { MenuActionId } from '../shared/menu'

/**
 * The application menu, as data (Phase 17).
 *
 * Same split as tray-menu.ts: this file decides what the menu says and index.ts
 * decides what Electron does about it, so the structure — which items exist on
 * which platform, which are dev-only, which accelerators they carry — is
 * testable without a running app.
 *
 * Why a custom menu at all: with none, Electron installs its stock menu, whose
 * every item says "Electron". A custom template fixes each item label and adds
 * the app's own verbs. The one thing it cannot fix is the *bold app-menu title*
 * in development — macOS reads that from the running bundle's Info.plist, which
 * in dev is node_modules/electron's. The packaged app (electron-builder's
 * productName) reads "Switchboard" everywhere.
 */

export interface AppMenuTemplateOptions {
  platform: NodeJS.Platform
  isDev: boolean
}

/** A menu item as data: either an Electron role, or an app action id. */
export interface AppMenuItem {
  role?: MenuItemConstructorOptions['role']
  type?: 'separator'
  label?: string
  accelerator?: string
  action?: MenuActionId | 'open-docs'
  submenu?: AppMenuItem[]
}

export function buildAppMenuTemplate({ platform, isDev }: AppMenuTemplateOptions): AppMenuItem[] {
  const darwin = platform === 'darwin'

  const settingsItem: AppMenuItem = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    action: 'open-settings'
  }

  const appMenu: AppMenuItem = {
    label: 'Switchboard',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      settingsItem,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }

  const fileMenu: AppMenuItem = {
    label: 'File',
    submenu: [
      { label: 'New Contact…', accelerator: 'CmdOrCtrl+N', action: 'new-contact' },
      // Settings belongs to the app menu on macOS and to File everywhere else.
      ...(darwin ? [] : [{ type: 'separator' as const }, settingsItem]),
      { type: 'separator' },
      ...(darwin ? [{ role: 'close' as const }] : [{ role: 'quit' as const }])
    ]
  }

  const editMenu: AppMenuItem = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  }

  const viewMenu: AppMenuItem = {
    label: 'View',
    submenu: [
      { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', action: 'command-palette' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      // Dev-only, matching what electron-toolkit's watchWindowShortcuts already
      // binds — present in the menu so the shortcuts are discoverable, absent
      // from a packaged build where they'd only be a support hazard.
      ...(isDev
        ? [
            { type: 'separator' as const },
            { role: 'reload' as const },
            { role: 'toggleDevTools' as const }
          ]
        : [])
    ]
  }

  const windowMenu: AppMenuItem = darwin
    ? {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      }
    : { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }

  const helpMenu: AppMenuItem = {
    label: 'Help',
    submenu: [{ label: 'Switchboard Help', action: 'open-docs' }]
  }

  return [...(darwin ? [appMenu] : []), fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
}
