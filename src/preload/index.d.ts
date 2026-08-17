import { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcProcedureName, IpcInput, IpcOutput } from '../shared/ipc-contract'
import type { AgentEvent } from '../shared/agent'
import type { MenuActionId } from '../shared/menu'

interface Api {
  invoke: <K extends IpcProcedureName>(name: K, input: IpcInput<K>) => Promise<IpcOutput<K>>
  /** Streams one in-flight turn's events. Returns an unsubscribe. */
  onAgentEvent: (runId: string, callback: (event: AgentEvent) => void) => () => void
  /** Fires when the set of in-flight runs changes. Returns an unsubscribe. */
  onRunsChanged: (callback: () => void) => () => void
  /** Fires when a usage row is written, whatever ran. Returns an unsubscribe. */
  onUsageChanged: (callback: () => void) => () => void
  /** Fires when an application-menu app action is chosen. Returns an unsubscribe. */
  onMenuAction: (callback: (action: MenuActionId) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
