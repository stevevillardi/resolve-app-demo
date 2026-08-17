import type { IpcProcedureName, IpcInput, IpcOutput } from '../../../shared/ipc-contract'
import type { AgentEvent } from '../../../shared/agent'
import type { MenuActionId } from '../../../shared/menu'
import type { NavigateTarget } from '../../../shared/navigation'

export function callProcedure<K extends IpcProcedureName>(
  name: K,
  input: IpcInput<K>
): Promise<IpcOutput<K>> {
  return window.api.invoke(name, input)
}

/**
 * Subscribes to one in-flight turn's event stream. Returns an unsubscribe, so
 * it drops straight into a useEffect.
 *
 * Passthroughs, like callProcedure — the demultiplexing happens in preload,
 * because that is the side that owns the channel.
 */
export function onAgentEvent(runId: string, callback: (event: AgentEvent) => void): () => void {
  return window.api.onAgentEvent(runId, callback)
}

export function onRunsChanged(callback: () => void): () => void {
  return window.api.onRunsChanged(callback)
}

export function onUsageChanged(callback: () => void): () => void {
  return window.api.onUsageChanged(callback)
}

export function onRoutinesChanged(callback: () => void): () => void {
  return window.api.onRoutinesChanged(callback)
}

export function onMessagesChanged(callback: () => void): () => void {
  return window.api.onMessagesChanged(callback)
}

export function onMenuAction(callback: (action: MenuActionId) => void): () => void {
  return window.api.onMenuAction(callback)
}

export function onNavigate(callback: (target: NavigateTarget) => void): () => void {
  return window.api.onNavigate(callback)
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
