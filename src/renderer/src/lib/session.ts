/**
 * Where the model's memory ends, read off the thread.
 *
 * A Switchboard thread is endless by design; the backend session underneath it
 * is not. It gets replaced when the resume key dies and the app heals it, when
 * a Contact is rebound to another persona, when its persona changes backend,
 * and — from Phase 22 — whenever the user asks for a fresh one. Until now every
 * one of those was silent: the persona simply stopped remembering the messages
 * above, with nothing on screen to say so, and the review named that as the
 * forever-thread's core dishonesty.
 *
 * Pure and here rather than in the component because the renderer Vitest
 * project matches `*.test.ts` only. The rule below is small, and every part of
 * it is a decision about what the app is entitled to claim.
 */

/**
 * The indices a session divider goes above.
 *
 * The rule, and each clause is load-bearing:
 *
 * - **A null id inherits.** It means "not recorded" — every row written before
 *   migration 0018, and any turn that died before the backend named a session.
 *   Treating null as its own session would draw a boundary at every gap in the
 *   record, so an upgraded profile would open to a wall of dividers describing
 *   sessions nobody can prove ever ended.
 * - **Only a change between two *known* ids counts.** That is the one thing the
 *   app can actually demonstrate.
 * - **Index 0 is never a boundary.** The top of a thread is where a session
 *   starts by definition; saying so would be noise on every conversation.
 *
 * Returns a Set because the caller is walking the thread in order anyway, and
 * a lookup per row keeps the render loop O(n).
 */
export function sessionBoundaries(rows: { sessionId?: string | null }[]): Set<number> {
  const boundaries = new Set<number>()
  let previous: string | null = null

  rows.forEach((row, index) => {
    const current = row.sessionId ?? null
    if (current === null) return
    if (previous !== null && previous !== current && index > 0) boundaries.add(index)
    previous = current
  })

  return boundaries
}

/**
 * Whether the *next* message will start a session the thread has not seen.
 *
 * The durable trace of a fresh session is the cleared resume key itself, so
 * this needs no schema and no marker row: a Contact with messages and no
 * session id is one whose next turn starts over. It is what makes the fresh
 * session action visible immediately, rather than only after the user has spent
 * money proving it happened.
 *
 * False for an empty thread — there is nothing above for the model to have
 * forgotten, so the notice would be describing nothing.
 */
export function awaitingFreshSession(
  backendSessionId: string | null,
  messageCount: number
): boolean {
  return backendSessionId === null && messageCount > 0
}
