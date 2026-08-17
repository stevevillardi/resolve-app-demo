import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { registerProcedure } from '../registerProcedure'
import { getAppState } from '../../services/app-state'
import { chooseWorkspaceRoot } from '../../services/repos'

registerProcedure('workspace.getRoot', () => {
  const path = getAppState('workspace_root')
  return { path, exists: path !== null && existsSync(path) }
})

registerProcedure('workspace.chooseRoot', async () => ({ path: await chooseWorkspaceRoot() }))

registerProcedure('appInfo.get', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dev: is.dev
}))
