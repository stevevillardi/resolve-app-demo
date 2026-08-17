import { app, session } from 'electron'
import { registerProcedure } from '../registerProcedure'
import { beginQuit } from '../../lifecycle'
import { clearAppData } from '../../services/reset'

/**
 * The first dev.* procedure. clearAppData() is the tested half (reset.ts);
 * this adds what only a running app can do — clearing renderer localStorage
 * and relaunching. The relaunch is deferred a beat so the IPC response can
 * leave the building first; the renderer is about to die either way, but a
 * rejected invoke would flash an error dialog over the restart.
 */
registerProcedure('dev.resetApp', async () => {
  await clearAppData()
  await session.defaultSession.clearStorageData({ storages: ['localstorage'] })

  setTimeout(() => {
    beginQuit()
    app.relaunch()
    app.quit()
  }, 150)

  return { ok: true }
})
