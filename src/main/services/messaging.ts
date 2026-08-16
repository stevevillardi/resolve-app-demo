import { randomUUID } from 'crypto'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { initDb } from '../db'
import { toMessage } from '../db/mappers'
import { messages } from '../db/schema'
import { adapterForBackend } from './adapter-host'
import { emitAgentEvent, emitRunsChanged } from './agent-events'
import { summarizeTurn } from './compaction'
import { getContact, setBackendSessionId } from './contacts'
import { contextForRepo, insertGroupMessage } from './group-messages'
import { getPersonaTemplate } from './persona-templates'
import {
  acquire,
  activeRuns,
  blockingHolder,
  lockModeFor,
  workingPathFor,
  type Release
} from './run-lock'
import { skillsForPersona } from './skills'
import { baselineFor, recordUsage } from './usage-events'
import type { AgentEvent } from '../../shared/agent'
import type { GroupMessage, PersistedMessage } from '../../shared/domain'

/**
 * Sending a message to a Contact and streaming the reply back (blueprint §16
 * Journey 1). The loop everything else in the app exists to support.
 *
 * The shape worth understanding before editing: `sendMessage` does the part
 * that must be synchronous — validate, take the lock, persist what the user
 * typed — and then starts the turn *without awaiting it*, so the renderer gets
 * a runId immediately and the reply arrives as pushed events rather than as one
 * enormous IPC response. `runTurn` owns everything after that, including
 * persistence, and is the only thing that releases the lock.
 */

export interface SendResult {
  runId: string
  userMessage: PersistedMessage
}

export interface ActiveRun {
  runId: string
  contactId: string
  contactName: string
  workingPath: string
  mode: 'shared' | 'exclusive'
  startedAt: number
}

export interface MentionResult {
  runId: string
  groupMessage: GroupMessage
}

interface Run {
  controller: AbortController
  release: Release
  contactId: string
  /** Set only for a turn started from a Group thread, so the reply is mirrored. */
  groupId?: string
}

const runs = new Map<string, Run>()

// --- Reads ------------------------------------------------------------------

export function listMessages(contactId: string): PersistedMessage[] {
  return initDb()
    .select()
    .from(messages)
    .where(eq(messages.contactId, contactId))
    .orderBy(asc(messages.timestamp))
    .all()
    .map(toMessage)
}

/**
 * The latest message per contact, for ConversationList's preview line.
 *
 * One query rather than one per contact: the list renders every contact at
 * once, so the N+1 version would be N round trips through the IPC boundary on
 * every render of the app's primary screen.
 */
export function messagePreviews(): PersistedMessage[] {
  const latest = new Map<string, PersistedMessage>()
  const rows = initDb()
    .select()
    .from(messages)
    // Timestamps tie more often than they look like they would: a fast turn
    // writes the question and the reply in the same millisecond, and ordering
    // by timestamp alone would then show the user their own question as the
    // preview. `rowid` breaks the tie by insertion order, which is the thing
    // actually being asked for. (Ids are UUIDs, so they cannot order.)
    .orderBy(desc(messages.timestamp), desc(sql`rowid`))
    .all()

  for (const row of rows) {
    if (!latest.has(row.contactId)) latest.set(row.contactId, toMessage(row))
  }
  return [...latest.values()]
}

export function listActiveRuns(): ActiveRun[] {
  return activeRuns().map((holder) => ({
    runId: holder.runId,
    contactId: holder.contactId,
    contactName: holder.contactName,
    workingPath: holder.workingPath,
    mode: holder.mode,
    startedAt: holder.startedAt
  }))
}

// --- Writes -----------------------------------------------------------------

function insertMessage(
  contactId: string,
  role: 'user' | 'assistant',
  content: string
): PersistedMessage {
  const message: PersistedMessage = {
    id: randomUUID(),
    contactId,
    role,
    content,
    timestamp: Date.now()
  }
  initDb()
    .insert(messages)
    .values({ ...message, timestamp: new Date(message.timestamp) })
    .run()
  return message
}

/**
 * Starts a turn and returns as soon as it is running.
 *
 * The lock is taken *before* the user's message is written, so a refused send
 * leaves no trace at all. Persisting first would put a question in the thread
 * that nothing will ever answer, which reads as a lost message rather than as a
 * refusal.
 */
export function sendMessage(contactId: string, content: string): SendResult {
  const { runId, userMessage } = startTurn(contactId, content)
  return { runId, userMessage }
}

/**
 * Routes a Group @mention to a Contact's real session (blueprint §8).
 *
 * The reason this is thin: an @mention *is* a message to that Contact. It takes
 * the same lock, resumes the same session, streams on the same runId, and
 * writes the same `messages` rows — the Group thread and the 1:1 thread are two
 * views of one conversation, which is what §8's "no duplicated conversation
 * state" requires and what the acceptance check on divergent copies tests.
 *
 * What it adds is the Group's own record of the exchange: a `user_mention` now
 * and an `agent_reply` when the turn finishes.
 *
 * Ordering matches sendMessage exactly — the lock is taken before anything is
 * written, so a refused mention leaves no row in either table.
 */
export function mentionInGroup(groupId: string, contactId: string, content: string): MentionResult {
  const { runId, groupMessage } = startTurn(contactId, content, groupId)
  // Non-null by construction: startTurn writes one whenever a groupId is given.
  return { runId, groupMessage: groupMessage as GroupMessage }
}

interface StartedTurn {
  runId: string
  userMessage: PersistedMessage
  /** Only when the turn was started from a Group thread. */
  groupMessage: GroupMessage | null
}

/**
 * The body both entry points share: validate, take the lock, persist what the
 * user typed, start the turn.
 *
 * Extracted rather than duplicated because the ordering it encodes is
 * load-bearing in two directions — the lock before any write, and the release
 * on every failure path — and a second copy would drift.
 */
function startTurn(contactId: string, content: string, groupId?: string): StartedTurn {
  const contact = getContact(contactId)
  if (!contact) throw new Error(`No such contact: ${contactId}`)

  const persona = getPersonaTemplate(contact.personaTemplateId)
  if (!persona) throw new Error(`Contact "${contact.displayName}" has no persona template.`)

  const workingPath = workingPathFor(contact)
  const mode = lockModeFor(persona)
  const runId = randomUUID()

  const release = acquire({
    runId,
    contactId,
    contactName: contact.displayName,
    workingPath,
    mode,
    startedAt: Date.now()
  })

  if (!release) {
    const holder = blockingHolder(workingPath, mode)
    throw new Error(
      holder
        ? `${holder.contactName} is already working in this repo. Wait for it to finish, or stop it from that conversation.`
        : 'This repo is busy.'
    )
  }

  // Everything from here to the point the turn is running has to hand the lock
  // back if it fails. Resolving skills hits the database and building a session
  // constructs an SDK client; neither is guaranteed not to throw, and a lock
  // leaked here would wedge the repo until the app restarts.
  try {
    const userMessage = insertMessage(contactId, 'user', content)
    // No contactId: a mention comes from the user, not from a persona.
    const groupMessage = groupId
      ? insertGroupMessage({ groupId, type: 'user_mention', content })
      : null

    const controller = new AbortController()
    runs.set(runId, { controller, release, contactId, ...(groupId ? { groupId } : {}) })

    const spec = {
      persona,
      repoPath: workingPath,
      skills: skillsForPersona(persona),
      // Blueprint §5: what the rest of the fleet has decided on this repo.
      // Resolved fresh per turn rather than per session, so a summary written
      // by a colleague between two of this contact's turns is visible on the
      // next one instead of at the next restart.
      groupContext: contextForRepo(contact.repoPath),
      // What this session has already been billed for. Codex reports usage
      // cumulatively across a thread, so without this every turn after the
      // first over-reports — see baselineFor(). Claude ignores it.
      usageBaseline: baselineFor(contactId, contact.backendSessionId),
      ...(persona.model ? { model: persona.model } : {})
    }

    const adapter = adapterForBackend(persona.backend)
    const session = contact.backendSessionId
      ? adapter.resume(spec, contact.backendSessionId)
      : adapter.createSession(spec)

    // Deliberately not awaited — this is the point where the call becomes a
    // stream. Errors cannot escape runTurn(), so there is no catch on it.
    void runTurn(runId, adapter, session, content)
    emitRunsChanged()

    return { runId, userMessage, groupMessage }
  } catch (error) {
    runs.delete(runId)
    release()
    emitRunsChanged()
    throw error
  }
}

type Adapter = ReturnType<typeof adapterForBackend>
type Session = ReturnType<Adapter['createSession']>

async function runTurn(
  runId: string,
  adapter: Adapter,
  session: Session,
  prompt: string
): Promise<void> {
  const run = runs.get(runId)
  if (!run) return

  // Whole messages only, never deltas. Claude emits the deltas for a block and
  // then the same block again whole, so accumulating both would double every
  // reply. This is only ever a fallback: a turn that reaches `done` uses
  // `done.finalText`, which is the backend's own authoritative answer. It
  // matters when a turn is stopped mid-stream and never produces one.
  let streamed = ''
  let done: Extract<AgentEvent, { type: 'done' }> | null = null

  try {
    for await (const event of adapter.run(session, prompt, run.controller.signal)) {
      if (event.type === 'done') {
        // Held back rather than forwarded here: the renderer treats `done` as
        // its cue to refetch, so it must not arrive before the rows it will
        // refetch have been written.
        done = event
        break
      }
      if (event.type === 'text_message') streamed += event.text
      emitAgentEvent(runId, event)
    }
  } catch (error) {
    // Both adapters wrap their streams and guarantee a `done`, so reaching here
    // means something outside that wrapper failed. The thread still has to end
    // in a terminal state rather than a bubble that spins forever.
    emitAgentEvent(runId, {
      type: 'error',
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    finish(runId, run.contactId, session, prompt, done?.finalText ?? streamed, done, run.groupId)
  }
}

/**
 * Persists the turn, then releases and announces it.
 *
 * Ordering matters in both directions: rows are written before `done` is
 * emitted so the renderer's refetch can see them, and the lock is released
 * before `runs-changed` so a UI that reacts by re-enabling its composer is
 * telling the truth.
 */
function finish(
  runId: string,
  contactId: string,
  session: Session,
  prompt: string,
  finalText: string,
  done: Extract<AgentEvent, { type: 'done' }> | null,
  groupId?: string
): void {
  try {
    // An aborted turn usually has no final text, but it may have produced
    // billable tokens all the same — so the two are recorded independently
    // rather than one gating the other.
    if (finalText.trim()) {
      insertMessage(contactId, 'assistant', finalText)

      // The Group's copy of the same reply (§8). The `messages` row above is
      // the conversation; this is the Group's record that it happened, and the
      // two carry identical text on purpose — the 1:1 thread and the Group
      // thread are two views of one exchange, not two exchanges.
      if (groupId) {
        insertGroupMessage({ groupId, type: 'agent_reply', contactId, content: finalText })
      }
    }
    // A mention is spend the user asked for from the Group rather than from a
    // 1:1 thread; separating them lets the dashboard show what coordination
    // costs (see usageSourceSchema).
    // Stamped with the session so the next turn can subtract what this one
    // already accounted for — the row is a delta, and baselineFor() sums them.
    if (done?.usage) {
      recordUsage(contactId, groupId ? 'mention' : 'message', done.usage, session.sessionId)
    }

    // Read after the run, never before: the adapters fill this in mid-stream at
    // `session_started`, and it is what makes the next turn a resume.
    if (session.sessionId) {
      const contact = getContact(contactId)
      if (contact && contact.backendSessionId !== session.sessionId) {
        setBackendSessionId(contactId, session.sessionId)
      }
    }
  } finally {
    runs.get(runId)?.release()
    runs.delete(runId)
    emitAgentEvent(runId, done ?? { type: 'done', finalText, usage: null })
    emitRunsChanged()

    // Blueprint §6, and deliberately the last thing to happen: it runs after
    // the lock is released and after the renderer has been told the turn is
    // over, so a slow summariser delays nothing the user is waiting on. Not
    // awaited, and it never rejects — see summarizeTurn's contract.
    void summarizeTurn(contactId, prompt, finalText)
  }
}

/**
 * Stops an in-flight turn.
 *
 * Only signals the abort — `runTurn`'s `finally` does the cleanup, so a stop
 * and a natural finish take exactly the same path out. Whatever text the model
 * had already produced is kept, since a half-written review is more useful than
 * a blank bubble.
 */
export function cancelRun(runId: string): boolean {
  const run = runs.get(runId)
  if (!run) return false
  run.controller.abort()
  return true
}
