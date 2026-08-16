import { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcProcedureName, IpcInput, IpcOutput } from '../shared/ipc-contract'

interface Api {
  invoke: <K extends IpcProcedureName>(name: K, input: IpcInput<K>) => Promise<IpcOutput<K>>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
