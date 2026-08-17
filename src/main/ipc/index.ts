import { initIpc } from './registerProcedure'
import './procedures/ping'
import './procedures/auth'
import './procedures/codex'
import './procedures/github'
import './procedures/shell'
import './procedures/data'
import './procedures/messaging'
import './procedures/repos'
import './procedures/routines'
import './procedures/seed'
import './procedures/settings'
import './procedures/branches'

/** Import every procedure module for its registration side effect, then wire the channel. */
export function setupIpc(): void {
  initIpc()
}
