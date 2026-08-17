import { Menu, type BrowserWindow } from 'electron'

/**
 * Native Cut/Copy/Paste on editable fields — the one context menu that must be
 * the OS's rather than the renderer's, because paste needs the real clipboard
 * and the standard roles get spellcheck-adjacent behaviour for free.
 *
 * Gated strictly on `params.isEditable`: everywhere else the renderer owns
 * right-click (Base UI context menus on rows and bubbles), and Electron emits
 * this event even when the page handled the DOM `contextmenu` itself — so a
 * broader gate here would pop a second, native menu on top of the renderer's.
 */
export function installEditableFieldMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return

    Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    ]).popup({ window })
  })
}
