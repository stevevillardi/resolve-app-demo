import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { installEditableFieldMenu } from './context-menu'
import { initDb } from './db'
import { setupIpc } from './ipc'
import { beginQuit, isQuitting } from './lifecycle'
import { nodeCronEngine } from './services/cron-engine'
import { pruneOrphanedWorktrees } from './services/worktrees'
import { startScheduler, stopScheduler } from './services/scheduler'
import { seedIfNeeded } from './services/seed'
import { createTray, destroyTray, hasTray, refreshTrayMenu } from './tray'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
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
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.stevevillardi.persona-router')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDb()
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
  // because not depending on one is the entire point of the phase.
  startScheduler(nodeCronEngine(), refreshTrayMenu)
  createTray(showMainWindow)

  createWindow()

  app.on('activate', function () {
    showMainWindow()
  })
})

/**
 * Brings the window back, whether it was hidden or never created.
 *
 * The window count is no longer the test it used to be: a hidden window is
 * still a window, so `getAllWindows().length === 0` is false after a close and
 * the dock icon would do nothing at all.
 */
function showMainWindow(): void {
  const existing = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
  if (!existing) {
    createWindow()
    return
  }
  existing.show()
  existing.focus()
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
