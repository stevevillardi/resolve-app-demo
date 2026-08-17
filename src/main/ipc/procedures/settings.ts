import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'fs'
import { registerProcedure } from '../registerProcedure'
import { notificationsEnabled } from '../../notifications'
import {
  deleteAppState,
  getAppState,
  getAppStateNumber,
  setAppStateFlag,
  setAppStateNumber
} from '../../services/app-state'
import { chooseWorkspaceRoot } from '../../services/repos'

registerProcedure('workspace.getRoot', () => {
  const path = getAppState('workspace_root')
  return { path, exists: path !== null && existsSync(path) }
})

registerProcedure('workspace.chooseRoot', async () => ({ path: await chooseWorkspaceRoot() }))

registerProcedure('notifications.get', () => ({ enabled: notificationsEnabled() }))

registerProcedure('notifications.set', ({ enabled }) => {
  setAppStateFlag('notifications_enabled', enabled)
  return { enabled }
})

registerProcedure('budget.get', () => ({
  monthlyBudgetUsd: getAppStateNumber('monthly_budget_usd')
}))

registerProcedure('budget.set', ({ monthlyBudgetUsd }) => {
  // Null clears the row rather than storing "null": absence is the no-budget
  // state everywhere else this key is read.
  if (monthlyBudgetUsd === null) deleteAppState('monthly_budget_usd')
  else setAppStateNumber('monthly_budget_usd', monthlyBudgetUsd)
  return { monthlyBudgetUsd }
})

registerProcedure('appInfo.get', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dev: is.dev
}))
