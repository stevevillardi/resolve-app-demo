import { ipcMain } from 'electron'
import {
  ipcContract,
  type IpcProcedureName,
  type IpcInput,
  type IpcOutput
} from '../../shared/ipc-contract'

const IPC_CHANNEL = 'ipc-invoke'

const handlers = new Map<IpcProcedureName, (input: unknown) => Promise<unknown> | unknown>()

export function registerProcedure<K extends IpcProcedureName>(
  name: K,
  handler: (input: IpcInput<K>) => Promise<IpcOutput<K>> | IpcOutput<K>
): void {
  handlers.set(name, handler as (input: unknown) => Promise<unknown> | unknown)
}

/** Wires the single generic invoke channel up once, dispatching by procedure name. */
export function initIpc(): void {
  ipcMain.handle(IPC_CHANNEL, async (_event, name: IpcProcedureName, rawInput: unknown) => {
    const contractEntry = ipcContract[name]
    if (!contractEntry) {
      throw new Error(`Unknown IPC procedure: ${String(name)}`)
    }

    const handler = handlers.get(name)
    if (!handler) {
      throw new Error(`No handler registered for IPC procedure: ${String(name)}`)
    }

    const input = contractEntry.input.parse(rawInput)
    const result = await handler(input)
    return contractEntry.output.parse(result)
  })
}
