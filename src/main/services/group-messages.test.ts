import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { groups } from '../db/schema'
import type { AppDatabase } from '../db'

/**
 * Against a real :memory: SQLite with the checked-in migrations applied, so
 * the 0005 `branch` column and the (group_id, timestamp) index are exercised
 * rather than described.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))
// insertGroupMessage announces itself; without this mock the import chain
// reaches `electron`, which does not exist under vitest's node environment.
const emitMessagesChanged = vi.fn()
vi.mock('./agent-events', () => ({ emitMessagesChanged: (): void => emitMessagesChanged() }))

const {
  appendToGroupMessage,
  contextForRepo,
  DURABLE_CONTEXT_LIMIT,
  groupForRepo,
  groupMessagePreviews,
  insertGroupMessage,
  listGroupMessages,
  ROUTINE_CONTEXT_LIMIT
} = await import('./group-messages')

const REPO = '/Users/dev/my-app'
const GROUP = 'group-1'

/** Timestamps are minted by the service, so ordering is controlled by clock. */
let now = Date.parse('2026-08-16T09:00:00Z')

function summary(
  content: string,
  category: 'decision' | 'tradeoff' | 'routine',
  extra: Record<string, unknown> = {}
): void {
  now += 1000
  vi.setSystemTime(now)
  insertGroupMessage({
    groupId: GROUP,
    type: 'system_summary',
    content,
    category,
    durable: category !== 'routine',
    ...extra
  })
}

beforeEach(() => {
  db = createTestDb()
  db.insert(groups).values({ id: GROUP, repoPath: REPO }).run()
  now = Date.parse('2026-08-16T09:00:00Z')
  vi.useFakeTimers()
})

describe('insertGroupMessage', () => {
  it('mints the id and timestamp rather than taking them', () => {
    vi.setSystemTime(now)
    const written = insertGroupMessage({ groupId: GROUP, type: 'user_mention', content: 'hi' })

    expect(written.id).toMatch(/[0-9a-f-]{36}/)
    expect(written.timestamp).toBe(now)
  })

  it('announces after the insert, so background writes reach the sidebar', () => {
    // The chokepoint rule: every group writer passes through here, including
    // compaction posting a routine_run with no renderer subscribed to any
    // runId. If this stops announcing, previews and unread counts go stale
    // for exactly the messages that arrive while nobody watches.
    emitMessagesChanged.mockClear()
    insertGroupMessage({ groupId: GROUP, type: 'agent_reply', content: 'done' })
    expect(emitMessagesChanged).toHaveBeenCalledTimes(1)
  })

  it('round-trips a user_mention with no contact', () => {
    // The one type with no author: it comes from the user, not a Contact.
    insertGroupMessage({ groupId: GROUP, type: 'user_mention', content: 'hi' })
    const [read] = listGroupMessages(GROUP)

    expect(read.contactId).toBeUndefined()
    expect(read.type).toBe('user_mention')
  })

  it('round-trips the branch a summary reported', () => {
    // Unwritten until worktrees land, but the column has to survive the
    // mapper round-trip now: if it does not, a summary written from a
    // worktree loses the branch it names, and the next session is told about
    // work it cannot find on disk.
    summary('Moved the token cache', 'decision', { branch: 'persona/refactor-buddy' })
    expect(listGroupMessages(GROUP)[0].branch).toBe('persona/refactor-buddy')
  })

  it('leaves branch absent rather than null when nothing reported one', () => {
    summary('Tidied imports', 'routine')
    expect('branch' in listGroupMessages(GROUP)[0]).toBe(false)
  })
})

describe('appendToGroupMessage', () => {
  // The scheduler amends a routine_run with the app's own PR outcome after the
  // summariser has already posted the model's account — so the Group never
  // ends up asserting a PR failed while the PR it opened sits open on GitHub.
  it('appends the line and announces the change', () => {
    const row = insertGroupMessage({
      groupId: GROUP,
      type: 'routine_run',
      content: 'A pull request could not be opened.'
    })

    emitMessagesChanged.mockClear()
    appendToGroupMessage(row.id, 'Opened PR #3.')

    expect(listGroupMessages(GROUP)[0].content).toBe(
      'A pull request could not be opened.\n\nOpened PR #3.'
    )
    expect(emitMessagesChanged).toHaveBeenCalledTimes(1)
  })

  it('is a silent no-op for an id that no longer exists', () => {
    emitMessagesChanged.mockClear()
    appendToGroupMessage('gone', 'Opened PR #3.')
    expect(emitMessagesChanged).not.toHaveBeenCalled()
  })
})

describe('listGroupMessages', () => {
  it('reads chronologically, because a thread reads top to bottom', () => {
    summary('first', 'routine')
    summary('second', 'decision')
    summary('third', 'routine')

    expect(listGroupMessages(GROUP).map((m) => m.content)).toEqual(['first', 'second', 'third'])
  })

  it('does not leak another repo history', () => {
    db.insert(groups).values({ id: 'group-2', repoPath: '/other' }).run()
    summary('ours', 'decision')
    insertGroupMessage({ groupId: 'group-2', type: 'agent_reply', content: 'theirs' })

    expect(listGroupMessages(GROUP).map((m) => m.content)).toEqual(['ours'])
  })
})

describe('contextForRepo', () => {
  it('is empty for a repo with no group yet', () => {
    expect(contextForRepo('/nowhere')).toEqual([])
  })

  it('injects every durable entry and only the most recent routine ones', () => {
    summary('decided A', 'decision')
    summary('traded off B', 'tradeoff')
    for (let i = 0; i < ROUTINE_CONTEXT_LIMIT + 3; i += 1) summary(`routine ${i}`, 'routine')

    const injected = contextForRepo(REPO)
    const durable = injected.filter((m) => m.durable)
    const routine = injected.filter((m) => !m.durable)

    expect(durable.map((m) => m.content)).toEqual(['decided A', 'traded off B'])
    expect(routine).toHaveLength(ROUTINE_CONTEXT_LIMIT)
    expect(routine.at(-1)?.content).toBe(`routine ${ROUTINE_CONTEXT_LIMIT + 2}`)
  })

  // The property the two-query split exists for. Under a single
  // `ORDER BY timestamp DESC LIMIT n` a burst of routine chatter would push
  // the decision log out of context entirely, and a durable entry is meant to
  // be kept indefinitely and always injected.
  it('keeps decisions injected however much routine chatter buries them', () => {
    summary('the decision that matters', 'decision')
    for (let i = 0; i < ROUTINE_CONTEXT_LIMIT * 10; i += 1) summary(`noise ${i}`, 'routine')

    expect(contextForRepo(REPO).map((m) => m.content)).toContain('the decision that matters')
  })

  it('caps durable entries too, as a bound rather than a policy', () => {
    // Durable entries are kept indefinitely and always injected; this limit
    // is not a retention policy, only a bound stopping an append-only log
    // from growing past what a turn can hold. What to do when a repo reaches
    // it — prune, or re-summarise the decision log itself — is unsolved.
    for (let i = 0; i < DURABLE_CONTEXT_LIMIT + 5; i += 1) summary(`decision ${i}`, 'decision')

    const injected = contextForRepo(REPO)
    expect(injected).toHaveLength(DURABLE_CONTEXT_LIMIT)
    expect(injected.at(-1)?.content).toBe(`decision ${DURABLE_CONTEXT_LIMIT + 4}`)
  })

  // Written from the claim, not the query: a routine posts its summary as
  // `routine_run` instead of `system_summary`, and unattended work is exactly
  // what the Group log has to carry across Contact boundaries. If this filter
  // ever narrows back to `system_summary`, every routine goes silently
  // invisible to its colleagues and nothing else in the suite would notice.
  it('carries a routine run to a colleague, same as any other durable summary', () => {
    now += 1000
    vi.setSystemTime(now)
    insertGroupMessage({
      groupId: GROUP,
      type: 'routine_run',
      content: 'Cached the token read in auth.ts',
      category: 'decision',
      durable: true
    })

    expect(contextForRepo(REPO).map((m) => m.content)).toEqual(['Cached the token read in auth.ts'])
  })

  it('retains a non-durable routine run by recency, like any other routine entry', () => {
    for (let i = 0; i < ROUTINE_CONTEXT_LIMIT + 3; i += 1) {
      now += 1000
      vi.setSystemTime(now)
      insertGroupMessage({
        groupId: GROUP,
        type: 'routine_run',
        content: `swept ${i}`,
        category: 'routine',
        durable: false
      })
    }

    expect(contextForRepo(REPO)).toHaveLength(ROUTINE_CONTEXT_LIMIT)
  })

  // Written from the claim: a branch request is addressed to the human, because
  // only a person can merge. Injecting it would read to every other persona as
  // a task — the same failure the group-context preamble exists to prevent.
  it('never injects a branch request, which is addressed to the human', () => {
    now += 1000
    vi.setSystemTime(now)
    insertGroupMessage({
      groupId: GROUP,
      type: 'branch_request',
      content: 'Needs the new auth helper.',
      branch: 'persona/refactor-buddy-a3f9'
    })
    summary('a real decision', 'decision')

    expect(contextForRepo(REPO).map((m) => m.content)).toEqual(['a real decision'])
  })

  it('returns oldest first, so the block reads as a history', () => {
    summary('older', 'decision')
    summary('newer', 'decision')

    expect(contextForRepo(REPO).map((m) => m.content)).toEqual(['older', 'newer'])
  })

  it('ignores group messages that are not summaries', () => {
    // Mentions and replies are conversation, not the decision log. Injecting
    // them would replay chatter into every future session on the repo.
    insertGroupMessage({ groupId: GROUP, type: 'user_mention', content: 'hey' })
    insertGroupMessage({ groupId: GROUP, type: 'agent_reply', content: 'sure' })
    summary('the only summary', 'decision')

    expect(contextForRepo(REPO).map((m) => m.content)).toEqual(['the only summary'])
  })
})

describe('groupForRepo', () => {
  it('finds the group bound to a repo', () => {
    expect(groupForRepo(REPO)?.id).toBe(GROUP)
  })

  it('is null for a repo nothing is bound to', () => {
    expect(groupForRepo('/nowhere')).toBeNull()
  })
})

describe('groupMessagePreviews', () => {
  it('returns the newest message per group, one row each', () => {
    db.insert(groups).values({ id: 'group-2', repoPath: '/other' }).run()

    summary('ours, older', 'routine')
    summary('ours, newest', 'decision')
    now += 1000
    vi.setSystemTime(now)
    insertGroupMessage({ groupId: 'group-2', type: 'agent_reply', content: 'theirs' })

    const previews = groupMessagePreviews()
    expect(previews).toHaveLength(2)
    expect(previews.find((m) => m.groupId === GROUP)?.content).toBe('ours, newest')
    expect(previews.find((m) => m.groupId === 'group-2')?.content).toBe('theirs')
  })

  it('breaks a timestamp tie by insertion order', () => {
    // Compaction writes a summary in the same millisecond a fast turn
    // finishes. Ordering by timestamp alone makes which one shows in the list
    // non-deterministic — the same trap messagePreviews() documents.
    vi.setSystemTime(now)
    insertGroupMessage({ groupId: GROUP, type: 'user_mention', content: 'first' })
    insertGroupMessage({ groupId: GROUP, type: 'agent_reply', content: 'second' })

    expect(groupMessagePreviews()[0].content).toBe('second')
  })

  it('is empty when nothing has been written', () => {
    expect(groupMessagePreviews()).toEqual([])
  })
})
