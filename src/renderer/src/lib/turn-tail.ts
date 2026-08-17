/**
 * When does a thread end in a question nobody answered?
 *
 * A failed turn is not a stored fact — the error lives in the in-flight
 * stream and dies with it (see types/message.ts) — so after a reload or a
 * crash the only durable evidence is the shape of the thread itself: a user
 * message with no reply and no run in flight. These rules compute that, and
 * the views hang the "interrupted, retry?" notice on the result.
 *
 * Pure and in lib/ for the usual reason: the renderer Vitest project matches
 * `*.test.ts` only, and a rule this load-bearing needs tests.
 */

interface TailRow {
  role?: string
  type?: string
}

/**
 * True when the last row is the user's and nothing is answering it.
 *
 * `hasLiveTurn` must come from the run store *and* the active-runs query:
 * the store covers the synchronous window right after a send (begin() fires
 * before any refetch), and the query covers a renderer reload while main is
 * still mid-turn — the store is empty then, but the turn is not dead.
 */
export function hasUnansweredTail(thread: TailRow[], hasLiveTurn: boolean): boolean {
  if (hasLiveTurn || thread.length === 0) return false
  const last = thread[thread.length - 1]
  return last.role === 'user' || last.type === 'user_mention'
}

interface PreviewRow {
  contactId: string
  role: string
  timestamp: number
}

/**
 * The member contact a group-thread retry should target, or null.
 *
 * A `user_mention` row records no contactId — it comes from the user — and
 * its content has the @token stripped, so the mentioned member cannot be
 * read back off the row. What *is* durable is that the mentioned contact's
 * own thread got the same user message: whichever member's latest 1:1
 * message is an unanswered user row is the one this mention went to. Live
 * members are excluded so a still-streaming mention never offers a retry.
 */
export function groupRetryTarget(
  thread: TailRow[],
  previews: PreviewRow[],
  memberIds: string[],
  liveContactIds: string[]
): string | null {
  if (thread.length === 0 || thread[thread.length - 1].type !== 'user_mention') return null

  const members = new Set(memberIds)
  const live = new Set(liveContactIds)
  const candidates = previews
    .filter(
      (preview) =>
        preview.role === 'user' && members.has(preview.contactId) && !live.has(preview.contactId)
    )
    .sort((a, b) => b.timestamp - a.timestamp)

  return candidates[0]?.contactId ?? null
}
