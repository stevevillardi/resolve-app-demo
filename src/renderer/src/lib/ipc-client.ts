import type { IpcProcedureName, IpcInput, IpcOutput } from '../../../shared/ipc-contract'

export function callProcedure<K extends IpcProcedureName>(
  name: K,
  input: IpcInput<K>
): Promise<IpcOutput<K>> {
  return window.api.invoke(name, input)
}

/**
 * The user-facing half of an IPC rejection.
 *
 * Electron wraps anything a handler throws, so a service's carefully written
 * message ("Can't delete this persona — 2 contacts still bound…") arrives as
 * `Error invoking remote method 'ipc-invoke': Error: Can't delete this…`.
 * Showing that verbatim in the UI leaks the transport at the user. This peels
 * the wrapper off and leaves the message the service actually wrote.
 */
export function ipcErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (!(error instanceof Error)) return fallback
  const unwrapped = error.message.replace(/^Error invoking remote method '[^']*':\s*/, '')
  // Handlers throw `Error`, so the remaining prefix is that class name.
  return unwrapped.replace(/^(?:[A-Za-z]*Error):\s*/, '').trim() || fallback
}
