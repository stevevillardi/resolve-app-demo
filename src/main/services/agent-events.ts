import { BrowserWindow } from 'electron'
import {
  AGENT_EVENT_CHANNEL,
  agentStreamMessageSchema,
  type AgentEvent,
  type AgentStreamMessage
} from '../../shared/agent'

/**
 * The main→renderer half of the IPC layer (Phase 6).
 *
 * Everything else in this app answers a question the renderer asked. A turn
 * doesn't: it produces events for as long as the model keeps talking, so main
 * has to push. This module is the only place that does.
 *
 * It lives here rather than in src/main/adapters/ for the same reason
 * resolveCodexBinary() does: the adapters may not import `electron`, and that
 * rule is what lets scripts/probe-adapters.ts drive a real backend outside
 * Electron. The adapters yield events; this decides where they go.
 */

/**
 * Resolved per send, never cached.
 *
 * setupIpc() runs before createWindow() in src/main/index.ts, so there is no
 * window to capture at registration time — and on macOS the app outlives its
 * window, which `activate` then re-creates. A module-level reference would be
 * stale in both directions.
 */
function targetWindow(): BrowserWindow | null {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  return window ?? null
}

function send(message: AgentStreamMessage): void {
  const window = targetWindow()
  if (!window) return

  // Validated on the way out, matching registerProcedure()'s treatment of
  // outputs. A malformed push would otherwise surface as a renderer-side type
  // error far from the code that produced it.
  window.webContents.send(AGENT_EVENT_CHANNEL, agentStreamMessageSchema.parse(message))
}

/**
 * Forwards one normalized event for an in-flight turn.
 *
 * Dropping events when no window exists is deliberate and safe: a turn's
 * durable result is written to `messages` and `usage_events` by the messaging
 * service regardless, and a renderer that missed the stream refetches on mount.
 * The stream is a live view, never the record.
 */
export function emitAgentEvent(runId: string, event: AgentEvent): void {
  send({ kind: 'event', runId, event })
}

/**
 * Main-side listeners for the same signal the renderer gets — the tray's
 * running-turn line lives in main and has no window to receive a push.
 * A registry rather than a direct import of tray.ts, which would close an
 * import cycle (tray → messaging → this file).
 */
const runsChangedListeners = new Set<() => void>()

export function onRunsChangedInMain(listener: () => void): () => void {
  runsChangedListeners.add(listener)
  return () => runsChangedListeners.delete(listener)
}

/** Signals that the set of in-flight runs changed, so `runs.list` is stale. */
export function emitRunsChanged(): void {
  send({ kind: 'runs-changed' })
  for (const listener of runsChangedListeners) listener()
}

/**
 * Signals that a usage row was written, so `usage.list` is stale.
 *
 * Emitted from recordUsage rather than from the turn loop, because that is the
 * one point every source passes through. A scheduled routine has no renderer
 * subscribed to its runId, and a summary turn's usage is recorded from
 * compaction after the run is already over — under a runId- or runs-based
 * signal both would leave the spend view stale while somebody watched it.
 */
export function emitUsageChanged(): void {
  send({ kind: 'usage-changed' })
}
