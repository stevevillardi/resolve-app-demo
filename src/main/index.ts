import {
  app,
  shell,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { buildAppMenuTemplate, type AppMenuItem } from './app-menu'
import { installEditableFieldMenu } from './context-menu'
import { initDb } from './db'
import { setupIpc } from './ipc'
import { beginQuit, isQuitting } from './lifecycle'
import { getMainWindow, setWindowFactory, showMainWindow } from './main-window'
import {
  emitRoutinesChanged,
  onMessagesChangedInMain,
  onRunsChangedInMain
} from './services/agent-events'
import { refreshDockBadge } from './dock-badge'
import { nodeCronEngine } from './services/cron-engine'
import { demoRequested, stageDemoProfile } from './services/demo-profile'
import { sweepInterruptedToolCalls } from './services/reconcile'
import { pruneOrphanedWorktrees } from './services/worktrees'
import { startScheduler, stopScheduler } from './services/scheduler'
import { seedIfNeeded } from './services/seed'
import { createTray, destroyTray, hasTray, refreshTrayMenu } from './tray'
import { DOCS_URL, MENU_ACTION_CHANNEL, type MenuActionId } from '../shared/menu'

// The display name, fixed before anything reads app.name — but userData is
// pinned to its pre-rename value FIRST, because setName() moves what
// getPath('userData') resolves to and the database already lives under the old
// path (package.json `name` in dev, productName in a packaged build). Without
// the pin, renaming the app would silently orphan every existing profile.
// In dev the bold macOS app-menu title still says "Electron" regardless —
// macOS reads the running bundle's Info.plist; see app-menu.ts.
app.setPath('userData', app.getPath('userData'))
app.setName('Switchboard')

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    // The shell is three panes wide (nav rail + conversation list + thread).
    // Below this the list panel can no longer hold a readable row.
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    // Painted behind the renderer so the window doesn't flash white while the
    // bundle loads. Matches --background: light #ffffff, dark #000000.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    // Hide the macOS title bar and let the nav rail own that space, with the
    // traffic lights inset into it. The renderer marks its own drag regions
    // (see the .drag-region / .no-drag utilities in assets/main.css).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 13, y: 18 } }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Keep the pre-paint background in step if the OS theme flips while running,
  // so a reload never flashes the wrong colour.
  nativeTheme.on('updated', () => {
    if (mainWindow.isDestroyed()) return
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff')
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  installEditableFieldMenu(mainWindow)

  // Hide rather than close, so the app stays resident and its routines keep
  // firing with no window on screen (blueprint §15E). Reopening is then instant
  // — no renderer reboot, no splash, no auth.getStatus round trip — and the
  // window is destroyed only when the app is genuinely quitting.
  mainWindow.on('close', (event) => {
    if (isQuitting()) return
    // No tray means no way back in and no way out — hiding then would leave the
    // app running with no window and no icon, quittable only from Activity
    // Monitor. Let it close normally instead and lose the residency.
    if (!hasTray()) return
    event.preventDefault()
    mainWindow.hide()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.stevevillardi.switchboard')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Before anything that can call showMainWindow(): the factory is what lets a
  // destroyed window be re-created without main-window.ts importing this file.
  setWindowFactory(createWindow)

  initDb()
  // Dev only, and only when asked for (`npm run demo`): rebuild the profile
  // as the staged showcase before anything reads it. Awaited because every
  // step below — the sweep, the seed marker, the renderer's first queries —
  // must see the staged rows, not rows being torn out from under them.
  if (is.dev && demoRequested()) {
    await stageDemoProfile()
  }
  // Synchronous and before setupIpc(): every tool_calls row still 'running'
  // is a turn the last process took down with it (the run registry starts
  // empty), and reconciling first means the renderer's first read already
  // sees the truth instead of repainting it.
  sweepInterruptedToolCalls()
  // Before setupIpc, so the renderer's first skills.list can never race an
  // empty library and render the "no skills" empty state on a fresh install.
  seedIfNeeded()
  setupIpc()

  // Not awaited: a stale worktree registration costs nothing until something
  // tries to use it, and blocking the window on one git process per repo would
  // trade a real delay for a tidiness nobody is waiting on.
  void pruneOrphanedWorktrees()

  // Before the tray, so its first menu has real next-run times rather than an
  // empty list it would have to be told about later — and before the window,
  // because not depending on one is the entire point of the phase. The callback
  // wakes both audiences a routine has: the tray in main, the renderer's
  // routine rows over the push channel.
  startScheduler(nodeCronEngine(), () => {
    refreshTrayMenu()
    emitRoutinesChanged()
  })
  createTray(showMainWindow)
  // The tray's "N turns running" line goes stale exactly when the run set
  // changes, which is also the only time it is worth redrawing.
  onRunsChangedInMain(refreshTrayMenu)
  // The dock badge, same pattern: recomputed on every message write or
  // mark-read, and once at startup so a badge earned while quit reappears.
  onMessagesChangedInMain(refreshDockBadge)
  refreshDockBadge()

  installApplicationMenu()

  // Dev only: the dock otherwise shows Electron's own icon, since the running
  // bundle is node_modules/electron. A packaged build carries build/icon.icns.
  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(icon))
  }

  createWindow()

  app.on('activate', function () {
    showMainWindow()
  })
})

/**
 * Maps the pure template (app-menu.ts) onto Electron and installs it.
 *
 * App actions travel to the renderer over MENU_ACTION_CHANNEL — the state they
 * open (the new-contact flow, settings, the palette) lives there. The window
 * is shown first: with tray residency the app can be focused while its window
 * is hidden, and a menu action that lands in a hidden window looks like a
 * menu that does nothing.
 */
function installApplicationMenu(): void {
  const sendAction = (action: MenuActionId): void => {
    showMainWindow()
    getMainWindow()?.webContents.send(MENU_ACTION_CHANNEL, action)
  }

  const toMenuItem = (item: AppMenuItem): MenuItemConstructorOptions => {
    const action = item.action
    return {
      ...(item.type ? { type: item.type } : {}),
      ...(item.role ? { role: item.role } : {}),
      ...(item.label ? { label: item.label } : {}),
      ...(item.accelerator ? { accelerator: item.accelerator } : {}),
      ...(action
        ? {
            click: () =>
              action === 'open-docs' ? void shell.openExternal(DOCS_URL) : sendAction(action)
          }
        : {}),
      ...(item.submenu ? { submenu: item.submenu.map(toMenuItem) } : {})
    }
  }

  const template = buildAppMenuTemplate({ platform: process.platform, isDev: is.dev })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template.map(toMenuItem)))
}

/**
 * Both Cmd-Q and the tray's Quit arrive here through `app.quit()`, which is
 * what lets the `close` handler above tell a quit from a window close without
 * either being a special case.
 *
 * An in-flight routine is not waited for. Blocking the quit on a turn that can
 * legitimately run for twenty minutes would make Cmd-Q appear to hang; the turn
 * dies with the process, exactly as it already does when a user quits partway
 * through typing to a persona.
 */
app.on('before-quit', () => {
  beginQuit()
  stopScheduler()
  destroyTray()
})

// Largely moot now that closing hides instead of destroying — hiding is not
// closing, so this rarely fires. Kept as the safety net for a platform or a
// path where the window really is destroyed, and still deliberately not
// quitting on macOS, where the tray is the way back.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
