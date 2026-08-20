import { randomUUID } from 'crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { initDb } from '../db'
import { toGroup, toGroupMessage } from '../db/mappers'
import { emitMessagesChanged } from './agent-events'
import { groupMessages, groups } from '../db/schema'
import type { Group, GroupMessage, GroupMessageDraft } from '../../shared/domain'

/**
 * The Group's message log.
 *
 * This is the layer that makes the app multi-agent rather than three parallel
 * chats: filesystem state is shared for free — every session reads the same
 * live repo on disk — but *intent* is not. The reasoning behind a change lives
 * in one private 1:1 thread, so it has to be carried across Contact boundaries
 * explicitly. These rows are that carrier — written by compaction, read back
 * into every session that starts on the same repo.
 */

/**
 * How much history a new session is told about.
 *
 * The retention rule is that durable entries are kept indefinitely and always
 * injected, and this limit does not contradict that so much as put a floor
 * under it: the log is append-only and a year-old repo would eventually inject
 * more context than a turn can hold. Fifty is well above where any current repo
 * sits, so in practice "always" holds while the failure mode stays bounded.
 *
 * Retention and re-summarisation of the durable log are unsolved: nothing
 * prunes it, and at some size the decision log itself needs summarising rather
 * than trimming. These stay named constants, and contextForRepo() takes them as
 * parameters, so answering that later is a change of policy rather than a
 * change of shape.
 */
export const DURABLE_CONTEXT_LIMIT = 50
export const ROUTINE_CONTEXT_LIMIT = 5

/** Chronological, because a thread reads top to bottom. */
export function listGroupMessages(groupId: string): GroupMessage[] {
  return initDb()
    .select()
    .from(groupMessages)
    .where(eq(groupMessages.groupId, groupId))
    .orderBy(asc(groupMessages.timestamp))
    .all()
    .map(toGroupMessage)
}

/**
 * Id and timestamp are minted here, never accepted from the caller — the same
 * rule the other draft schemas follow. A renderer-supplied timestamp would let
 * a clock skew reorder the thread.
 */
export function insertGroupMessage(draft: GroupMessageDraft): GroupMessage {
  const row = {
    id: randomUUID(),
    timestamp: Date.now(),
    ...draft
  }

  initDb()
    .insert(groupMessages)
    .values({ ...row, timestamp: new Date(row.timestamp) })
    .run()

  // After the insert, never before — see insertMessage, which shares the rule
  // and the reason: this is the chokepoint every group writer passes through,
  // including compaction posting a routine_run with no renderer watching.
  emitMessagesChanged()
  return row
}

/**
 * Adds a line to a message that already posted.
 *
 * Exists for exactly one caller: a routine's `routine_run` row is written by
 * the summariser at turn end, but the pull request is the scheduler's own
 * post-turn step — the model has already summarised a push *it* could not do
 * (the sandbox blocks its network) as a failure by then. Appending the app's
 * own outcome after the model's account is what keeps the Group from asserting
 * a PR failed while the PR it opened sits open on GitHub. The model's sentence
 * is kept rather than replaced: what it believed is part of the record, and the
 * app's outcome is simply the last word. The correction is dated by adjacency.
 */
export function appendToGroupMessage(id: string, line: string): void {
  const db = initDb()
  const existing = db.select().from(groupMessages).where(eq(groupMessages.id, id)).get()
  if (!existing) return

  db.update(groupMessages)
    .set({ content: `${existing.content}\n\n${line}` })
    .where(eq(groupMessages.id, id))
    .run()
  emitMessagesChanged()
}

/**
 * The latest message per group, for ConversationList's preview line.
 *
 * One query rather than one per group, for the same reason messagePreviews()
 * is: the list renders every group at once, and the N+1 version would be N
 * round trips through the IPC boundary on every render of the primary screen.
 * It is proportional to the number of groups, not to how much has been said
 * in them — see messagePreviews().
 *
 * The `rowid` tiebreak matters here too — compaction writes a summary in the
 * same millisecond a fast turn finishes, and ordering by timestamp alone would
 * make which of the two shows up in the list non-deterministic.
 */
export function groupMessagePreviews(): GroupMessage[] {
  return initDb()
    .select()
    .from(groupMessages)
    .where(
      // Driven by `groups` rather than by every row in the table — one index
      // seek per group against
      // `group_messages_group_timestamp_idx`, instead of reading the whole
      // history of every repo group to keep the newest line from each.
      sql`${groupMessages.id} IN (
        SELECT (
          SELECT gm.id FROM ${groupMessages} gm
          WHERE gm.group_id = g.id
          ORDER BY gm.timestamp DESC, gm.rowid DESC
          LIMIT 1
        )
        FROM ${groups} g
      )`
    )
    .orderBy(desc(groupMessages.timestamp), desc(sql`rowid`))
    .all()
    .map(toGroupMessage)
}

/**
 * Stamps every open `branch_request` about `branch` as answered.
 *
 * Called from the merge and discard paths — the two clicks that answer the
 * ask — and idempotent by construction: only rows still unresolved are
 * stamped, so answering twice does not rewrite when the answer happened.
 * Returns how many were stamped, which is what lets a test claim "this merge
 * resolved that ask" without reading the table itself.
 */
export function resolveBranchRequests(repoPath: string, branch: string): number {
  const group = groupForRepo(repoPath)
  if (!group) return 0

  return initDb()
    .update(groupMessages)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(groupMessages.groupId, group.id),
        eq(groupMessages.type, 'branch_request'),
        eq(groupMessages.branch, branch),
        isNull(groupMessages.resolvedAt)
      )
    )
    .run().changes
}

/** Null rather than throwing: a repo with no contact bound has no group yet. */
export function groupForRepo(repoPath: string): Group | null {
  const row = initDb().select().from(groups).where(eq(groups.repoPath, repoPath)).get()
  return row ? toGroup(row) : null
}

/**
 * What a session starting on `repoPath` should be told about its colleagues.
 *
 * Two queries rather than one, because the two categories are retained on
 * different rules: durable entries — the summaries categorised `decision` or
 * `tradeoff` — are the project's running decision log, kept indefinitely and
 * always injected, while routine ones are recency-only. The older routine
 * entries stay in SQLite and remain queryable, they just stop being surfaced.
 * A single `ORDER BY timestamp DESC LIMIT n` would let a burst of routine
 * chatter push the decisions out, which is exactly the failure this split
 * exists to prevent.
 *
 * Returned chronologically, oldest first, so the injected block reads as a
 * history rather than a reverse-chronological feed.
 */
export function contextForRepo(
  repoPath: string,
  durableLimit = DURABLE_CONTEXT_LIMIT,
  routineLimit = ROUTINE_CONTEXT_LIMIT
): GroupMessage[] {
  const group = groupForRepo(repoPath)
  if (!group) return []

  const db = initDb()

  const recent = (durable: boolean, limit: number): GroupMessage[] =>
    db
      .select()
      .from(groupMessages)
      .where(
        and(
          eq(groupMessages.groupId, group.id),
          // Both summary-shaped types, not just `system_summary`. A routine
          // posts its summary as `routine_run` so one unattended fire leaves
          // one row — and work done while nobody was watching is precisely
          // what this log exists to carry across Contact boundaries.
          // Filtering on `system_summary` alone would make every routine
          // invisible to its colleagues, which is the same failure as a real
          // change filed as `routine` and dropped from context.
          //
          // `branch_request` is deliberately NOT here. It is addressed to the
          // human — only a person can merge — and injecting it would read to
          // every other persona as a task, which is exactly the failure the
          // group-context preamble was written to prevent. It also carries no
          // `durable` value, so it would never match either query anyway; the
          // filter says so explicitly rather than relying on that.
          inArray(groupMessages.type, ['system_summary', 'routine_run']),
          eq(groupMessages.durable, durable)
        )
      )
      .orderBy(desc(groupMessages.timestamp))
      .limit(limit)
      .all()
      .map(toGroupMessage)

  return [...recent(true, durableLimit), ...recent(false, routineLimit)].sort(
    (a, b) => a.timestamp - b.timestamp
  )
}
