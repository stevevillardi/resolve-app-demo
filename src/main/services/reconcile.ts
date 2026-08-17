import { eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toolCalls } from '../db/schema'

/**
 * Boot reconciliation (review §B6): the quit path deliberately does not wait
 * for in-flight turns — the turn dies with the process — and a crash asks
 * nobody. Either way the database keeps whatever the turn had written by
 * then, including tool_calls rows still marked `running`.
 *
 * At process start the run registry is empty by construction, so every
 * `running` row is a turn that died mid-call — the exact contract the table's
 * schema comment documents. Sweeping them to `failed` makes the record
 * truthful before anything reads it; the renderer keeps its own
 * running→interrupted mapping for turns that die while the app stays open.
 *
 * Synchronous and called before setupIpc(): it is one cheap statement, and
 * running it first means the renderer's first tool-call read already sees
 * reconciled rows rather than repainting a lie.
 */
export function sweepInterruptedToolCalls(): number {
  return initDb()
    .update(toolCalls)
    .set({ status: 'failed' })
    .where(eq(toolCalls.status, 'running'))
    .run().changes
}
