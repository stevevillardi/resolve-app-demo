import { initIpc } from './registerProcedure'
import './procedures/ping'
import './procedures/auth'
import './procedures/codex'
import './procedures/github'
import './procedures/shell'
import './procedures/data'
import './procedures/messaging'

/** Import every procedure module for its registration side effect, then wire the channel. */
export function setupIpc(): void {
  initIpc()
}
