import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { IpcProcedureName } from '../shared/ipc-contract'

const IPC_CHANNEL = 'ipc-invoke'

// Generic bridge for the hand-rolled typed IPC layer (src/shared/ipc-contract.ts).
// Renderer never gets one bespoke bridge method per procedure — everything goes
// through this single invoke, validated against the shared contract on both ends.
const api = {
  invoke: (name: IpcProcedureName, input: unknown) => ipcRenderer.invoke(IPC_CHANNEL, name, input)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
