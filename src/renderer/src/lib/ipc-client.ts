import type { IpcProcedureName, IpcInput, IpcOutput } from '../../../shared/ipc-contract'

export function callProcedure<K extends IpcProcedureName>(
  name: K,
  input: IpcInput<K>
): Promise<IpcOutput<K>> {
  return window.api.invoke(name, input)
}
