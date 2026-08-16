import { initIpc } from './registerProcedure'
import './procedures/ping'

/** Import every procedure module for its registration side effect, then wire the channel. */
export function setupIpc(): void {
  initIpc()
}
