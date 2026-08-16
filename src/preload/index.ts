import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { IpcProcedureName } from '../shared/ipc-contract'
import { AGENT_EVENT_CHANNEL, type AgentEvent, type AgentStreamMessage } from '../shared/agent'

const IPC_CHANNEL = 'ipc-invoke'

/**
 * Subscribes to one channel and hands back an unsubscribe.
 *
 * The IpcRendererEvent is dropped rather than forwarded: it carries `sender`,
 * which would hand the renderer a live handle back into main and undo the point
 * of contextIsolation. Callers get the payload and nothing else.
 */
function subscribe(onMessage: (message: AgentStreamMessage) => void): () => void {
  const listener = (_event: IpcRendererEvent, message: AgentStreamMessage): void =>
    onMessage(message)
  ipcRenderer.on(AGENT_EVENT_CHANNEL, listener)
  return () => ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, listener)
}

// Generic bridge for the hand-rolled typed IPC layer (src/shared/ipc-contract.ts).
// Renderer never gets one bespoke bridge method per procedure — everything goes
// through this single invoke, validated against the shared contract on both ends.
// `onAgentEvent`/`onRunsChanged` are the push half (Phase 6): one channel again,
// demultiplexed here so the renderer subscribes per run without ipcRenderer.
const api = {
  invoke: (name: IpcProcedureName, input: unknown) => ipcRenderer.invoke(IPC_CHANNEL, name, input),

  onAgentEvent: (runId: string, callback: (event: AgentEvent) => void): (() => void) =>
    subscribe((message) => {
      if (message.kind === 'event' && message.runId === runId) callback(message.event)
    }),

  onRunsChanged: (callback: () => void): (() => void) =>
    subscribe((message) => {
      if (message.kind === 'runs-changed') callback()
    }),

  onUsageChanged: (callback: () => void): (() => void) =>
    subscribe((message) => {
      if (message.kind === 'usage-changed') callback()
    })
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
