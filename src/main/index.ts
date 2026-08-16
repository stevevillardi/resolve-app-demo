import { app, shell, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDb } from './db'
import { setupIpc } from './ipc'
import { seedIfNeeded } from './services/seed'

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

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
