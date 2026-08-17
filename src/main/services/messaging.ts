import { randomUUID } from 'crypto'
import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { initDb } from '../db'
import { toMessage } from '../db/mappers'
import { messages, toolCalls } from '../db/schema'
import { GITHUB_MCP_SERVER_ID } from '../adapters/github-mcp-tools'
import { adapterForBackend } from './adapter-host'
import { notifyTurnFinished } from '../notifications'
import { emitAgentEvent, emitMessagesChanged, emitRunsChanged } from './agent-events'
import { summarizeTurn } from './compaction'
import { clearBackendSessionId, getContact, setBackendSessionId } from './contacts'
import { groupForRepo, insertGroupMessage } from './group-messages'
import { getPersonaTemplate } from './persona-templates'
import {
  acquire,
  activeRuns,
  blockingHolder,
  lockModeFor,
  workingPathFor,
  type Release
} from './run-lock'
import { buildSessionSpec } from './session-spec'
import { captureWorkEnd, captureWorkStart } from './turn-work'
import type { TurnOrigin, TurnOutcome } from './turn-origin'
import { baselineFor, recordUsage } from './usage-events'
import { ensureWorktree } from './worktrees'
import type { SessionSpec } from '../adapters/types'
import { TOOL_DETAIL_MAX, toolExcerpt } from '../../shared/agent'
import type { AgentEvent } from '../../shared/agent'
import type { Contact, GroupMessage, PersistedMessage, TurnWork } from '../../shared/domain'

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

export interface RoutineTurn {
  runId: string
  completed: Promise<TurnOutcome>
}

interface Run {
  controller: AbortController
  release: Release
  contactId: string
  /** What started this turn — decides its Group rows and its usage source. */
  origin: TurnOrigin
  /**
   * Resolved once at start: the mention's group, or the routine's repo group.
   * Null for a 1:1 message, and for a routine whose repo has no Group yet.
   */
  groupId: string | null
  /** Settles the caller's `completed` promise. Never throws — see StartedTurn. */
  settle: (outcome: TurnOutcome) => void
}

const runs = new Map<string, Run>()

// --- Reads ------------------------------------------------------------------

/**
 * The persisted tool record for a thread (Phase 17, doc 15 item 1; widened in
 * Phase 19): name and status per call, stamped with the message the turn ended
 * in, plus the bounded detail/output excerpts — see the table's comment in
 * schema.ts for the reversal this was.
 */
export function listToolCalls(contactId: string): {
  id: string
  messageId: string | null
  name: string
  status: 'running' | 'completed' | 'failed'
  createdAt: number
  detail?: string
  output?: string
}[] {
  return initDb()
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.contactId, contactId))
    .orderBy(asc(toolCalls.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      messageId: row.messageId,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt.getTime(),
      ...(row.detail === null ? {} : { detail: row.detail }),
      ...(row.output === null ? {} : { output: row.output })
    }))
}

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
  content: string,
  work: TurnWork | null = null
): PersistedMessage {
  const message: PersistedMessage = {
    id: randomUUID(),
    contactId,
    role,
    content,
    timestamp: Date.now(),
    ...(work ? { work } : {})
  }
  initDb()
    .insert(messages)
    .values({ ...message, work: work ?? null, timestamp: new Date(message.timestamp) })
    .run()
  // After the insert, never before — same ordering rule as recordUsage. This
  // chokepoint is what keeps previews and unread counts honest for turns no
  // renderer is subscribed to (a routine, a reply landing on a closed thread).
  emitMessagesChanged()
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
  const { runId, userMessage } = startTurn(contactId, content, { kind: 'message' })
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
  const { runId, groupMessage } = startTurn(contactId, content, { kind: 'mention', groupId })
  // Non-null by construction: startTurn writes one for a mention origin.
  return { runId, groupMessage: groupMessage as GroupMessage }
}

/**
 * Runs a Routine's prompt as an ordinary turn (blueprint §7).
 *
 * The third and last entry point, and deliberately as thin as the other two:
 * a routine fire *is* a message to that Contact, taking the same lock, resuming
 * the same session, and writing the same `messages` rows. What it adds is a
 * `routine_run` on the way out and `source: 'routine'` on its spend.
 *
 * Unlike the other two it hands back `completed`, because nobody is watching:
 * the scheduler has to write `lastRunAt`/`lastRunSummary` when the turn ends,
 * and there is no renderer subscribed to the event stream to notice for it.
 */
export function runRoutineTurn(routineId: string, contactId: string, prompt: string): RoutineTurn {
  const { runId, completed } = startTurn(contactId, prompt, { kind: 'routine', routineId })
  return { runId, completed }
}

interface StartedTurn {
  runId: string
  userMessage: PersistedMessage
  /** Only when the turn was started from a Group thread. */
  groupMessage: GroupMessage | null
  /**
   * How the turn ended, once every durable write is done.
   *
   * A promise rather than a caller-supplied callback, and the reason is not
   * style: `finish()` does its work inside a `finally`, and a callback that
   * threw there would *replace* the in-flight error path — one bad line of
   * routine bookkeeping would silently corrupt the teardown of every turn in
   * the app. `resolve()` is total and cannot throw.
   *
   * Settles exactly once and never rejects: `finish()` is on every path out of
   * `runTurn`, including an aborted turn and one whose adapter threw.
   */
  completed: Promise<TurnOutcome>
}

/**
 * The body both entry points share: validate, take the lock, persist what the
 * user typed, start the turn.
 *
 * Extracted rather than duplicated because the ordering it encodes is
 * load-bearing in two directions — the lock before any write, and the release
 * on every failure path — and a second copy would drift.
 */
function startTurn(contactId: string, content: string, origin: TurnOrigin): StartedTurn {
  const contact = getContact(contactId)
  if (!contact) throw new Error(`No such contact: ${contactId}`)

  const persona = getPersonaTemplate(contact.personaTemplateId)
  if (!persona) throw new Error(`Contact "${contact.displayName}" has no persona template.`)

  const workingPath = workingPathFor(contact)
  const mode = lockModeFor(persona, contact.isolation)
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
    // "Here" rather than "in this repo": since Phase 12 a refusal means the two
    // share a working directory, which is now a narrower thing than sharing a
    // repo — two Contacts in their own worktrees never reach this at all.
    const holder = blockingHolder(workingPath, mode)
    throw new Error(
      holder
        ? `${holder.contactName} is already working here. Wait for it to finish, or stop it from that conversation.`
        : 'This working copy is busy.'
    )
  }

  // Everything from here to the point the turn is running has to hand the lock
  // back if it fails. Resolving skills hits the database and building a session
  // constructs an SDK client; neither is guaranteed not to throw, and a lock
  // leaked here would wedge the repo until the app restarts.
  try {
    // Written for a routine too: blueprint §7 wants opening the Contact to show
    // what it did while asleep, and an assistant bubble with no question above
    // it reads as a glitch rather than as unattended work.
    const userMessage = insertMessage(contactId, 'user', content)

    // A mention's group is chosen, a routine's is derived from its repo. A
    // routine whose repo has no Group yet degrades to no Group row rather than
    // throwing — the turn itself is still worth running.
    const groupId =
      origin.kind === 'mention'
        ? origin.groupId
        : origin.kind === 'routine'
          ? (groupForRepo(contact.repoPath)?.id ?? null)
          : null

    // Only a mention has an inbound row. A routine's prompt was never typed
    // into the group thread, and posting one would invent a user utterance.
    // No contactId: a mention comes from the user, not from a persona.
    const groupMessage =
      origin.kind === 'mention'
        ? insertGroupMessage({ groupId: origin.groupId, type: 'user_mention', content })
        : null

    const controller = new AbortController()
    let settle: (outcome: TurnOutcome) => void
    const completed = new Promise<TurnOutcome>((resolve) => {
      settle = resolve
    })
    runs.set(runId, { controller, release, contactId, origin, groupId, settle: settle! })

    // Built by session-spec.ts rather than inline, so the "what's in my
    // context" panel resolves the same thing this turn is about to send —
    // capability resolution included. The usage baseline stays a caller's
    // concern: Codex reports cumulatively across a thread, so without it every
    // turn after the first over-reports — see baselineFor(). Claude ignores it,
    // and the panel has no use for it.
    const spec = buildSessionSpec(contact, persona, {
      workingPath,
      usageBaseline: baselineFor(contactId, contact.backendSessionId)
    })

    // The token reaches the subprocess only when this session actually holds
    // the server, rather than whenever an account is connected somewhere.
    const adapter = adapterForBackend(persona.backend, {
      needsGithubToken: (spec.mcpServers ?? []).some((server) => server.id === GITHUB_MCP_SERVER_ID)
    })
    const session = contact.backendSessionId
      ? adapter.resume(spec, contact.backendSessionId)
      : adapter.createSession(spec)

    // Deliberately not awaited — this is the point where the call becomes a
    // stream. Errors cannot escape runTurn(), so there is no catch on it.
    void runTurn(runId, adapter, session, content, contact, spec)
    emitRunsChanged()

    return { runId, userMessage, groupMessage, completed }
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
  prompt: string,
  contact: Contact,
  spec: SessionSpec
): Promise<void> {
  const run = runs.get(runId)
  if (!run) return

  // Whole messages only, never deltas. Claude emits the deltas for a block and
  // then the same block again whole, so accumulating both would double every
  // reply. This is only ever a fallback: a turn that reaches `done` uses
  // `done.finalText`, which is the backend's own authoritative answer. It
  // matters when a turn is stopped mid-stream and never produces one.
  let activeSession = session
  let streamed = ''
  let done: Extract<AgentEvent, { type: 'done' }> | null = null
  // Kept so a caller with nobody watching can say *why* it failed. A routine
  // whose lastRunSummary reads "produced nothing" is not actionable; one that
  // reads "Failed — not authenticated" is.
  let failure: string | null = null
  // A resumed session whose resume key the backend refuses gets one fresh
  // start. Only a resume can heal this way (a fresh session has no dead key to
  // shed), and only before anything has streamed — past that point a restart
  // would silently discard output the user already saw.
  let canHealDeadResume = Boolean(contact.backendSessionId)
  // Persisted per call as it happens, with the bounded detail/output excerpts
  // (Phase 19, reversing doc 15 item 1). Row ids kept so finish() can stamp
  // them with the message this turn ends in; the backend's toolCallId is only
  // unique per turn.
  const toolRowIds = new Map<string, string>()
  let workStart: Awaited<ReturnType<typeof captureWorkStart>> | null = null

  try {
    // The first thing the turn does, because it decides where the turn runs.
    // Creating the worktree is deferred to here rather than done at bind time so
    // an unused Contact costs no checkout — and it cannot happen any earlier
    // than this, because startTurn() is synchronous and git is not.
    spec.writablePaths = await ensureWorktree(contact)

    // Read before the model does anything, so the record measures this turn
    // alone. Failure degrades to "no record" — see turn-work.ts.
    workStart = await captureWorkStart(workingPathFor(contact)).catch(() => null)

    attempts: while (true) {
      for await (const event of adapter.run(activeSession, prompt, run.controller.signal)) {
        if (event.type === 'error') {
          // Self-heal: the model/backend changed under this contact (or the
          // vendor expired the thread), so the stored key points at a session
          // that no longer exists. The transcript is ours, not the vendor's —
          // dropping the key and starting fresh loses nothing visible, and
          // beats surfacing a raw "failed to resume" string the user cannot
          // act on. The dead attempt's error is deliberately not forwarded.
          if (event.kind === 'session' && canHealDeadResume && streamed === '') {
            canHealDeadResume = false
            clearBackendSessionId(contact.id)
            activeSession = adapter.createSession(spec)
            failure = null
            continue attempts
          }
          failure = event.message
        }
        if (event.type === 'done') {
          // Held back rather than forwarded here: the renderer treats `done` as
          // its cue to refetch, so it must not arrive before the rows it will
          // refetch have been written.
          done = event
          break attempts
        }
        if (event.type === 'text_message') streamed += event.text
        if (event.type === 'tool_start') {
          const rowId = randomUUID()
          toolRowIds.set(event.toolCallId, rowId)
          initDb()
            .insert(toolCalls)
            .values({
              id: rowId,
              contactId: contact.id,
              messageId: null,
              toolCallId: event.toolCallId,
              name: event.name,
              status: 'running',
              createdAt: new Date(),
              detail: event.detail ? toolExcerpt(event.detail, TOOL_DETAIL_MAX) : null
            })
            .run()
        }
        if (event.type === 'tool_end') {
          const rowId = toolRowIds.get(event.toolCallId)
          if (rowId) {
            initDb()
              .update(toolCalls)
              // The adapter bounded `output` at emit time; stored as emitted.
              .set({ status: event.status, ...(event.output ? { output: event.output } : {}) })
              .where(eq(toolCalls.id, rowId))
              .run()
          }
        }
        emitAgentEvent(runId, event)
      }
      // The stream ended without a `done` (a cancelled turn); nothing to retry.
      break
    }
  } catch (error) {
    // Both adapters wrap their streams and guarantee a `done`, so reaching here
    // means something outside that wrapper failed. The thread still has to end
    // in a terminal state rather than a bubble that spins forever.
    failure = error instanceof Error ? error.message : String(error)
    emitAgentEvent(runId, { type: 'error', kind: 'unknown', message: failure })
  } finally {
    // Measured in the teardown so an adapter throw still gets its record; a
    // couple of git reads is what it costs. Never fails the turn.
    const work = workStart
      ? await captureWorkEnd(workingPathFor(contact), workStart).catch(() => null)
      : null
    finish(
      runId,
      run,
      activeSession,
      prompt,
      done?.finalText ?? streamed,
      done,
      failure,
      [...toolRowIds.values()],
      work
    )
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
  run: Run,
  session: Session,
  prompt: string,
  finalText: string,
  done: Extract<AgentEvent, { type: 'done' }> | null,
  failure: string | null,
  toolRowIds: string[] = [],
  work: TurnWork | null = null
): void {
  const { contactId, origin, groupId } = run
  try {
    // An aborted turn usually has no final text, but it may have produced
    // billable tokens all the same — so the two are recorded independently
    // rather than one gating the other.
    if (finalText.trim()) {
      const reply = insertMessage(contactId, 'assistant', finalText, work)

      // Stamp the turn's tool rows with the message it ended in, so history
      // can render the calls with the reply they produced. A turn that dies
      // before this leaves rows with a null messageId and status 'running' —
      // rendered as interrupted, which is the truth.
      if (toolRowIds.length > 0) {
        initDb()
          .update(toolCalls)
          .set({ messageId: reply.id })
          .where(inArray(toolCalls.id, toolRowIds))
          .run()
      }

      // The Group's copy of the same reply (§8). The `messages` row above is
      // the conversation; this is the Group's record that it happened, and the
      // two carry identical text on purpose — the 1:1 thread and the Group
      // thread are two views of one exchange, not two exchanges.
      //
      // A routine writes no reply row here. Its Group record is the single
      // `routine_run` that compaction posts in place of the usual
      // `system_summary` — one unattended event, one row, and a summary rather
      // than a wall of text in what RoutineRunNotice renders as a log line.
      if (groupId && origin.kind === 'mention') {
        insertGroupMessage({ groupId, type: 'agent_reply', contactId, content: finalText })
      }
    }
    // A mention is spend the user asked for from the Group rather than from a
    // 1:1 thread, and a routine is spend nobody asked for directly; separating
    // them lets the dashboard show what coordination and autonomy each cost
    // (see usageSourceSchema). The origin's discriminant *is* the source, so
    // there is no mapping table here to fall out of step with the branch above.
    // Stamped with the session so the next turn can subtract what this one
    // already accounted for — the row is a delta, and baselineFor() sums them.
    if (done?.usage) {
      recordUsage(
        contactId,
        origin.kind,
        done.usage,
        session.sessionId,
        origin.kind === 'routine' ? origin.routineId : null
      )
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

    // A ten-minute turn finishing while the user is in their editor used to
    // finish silently (review §C1). Routine origins are excluded — the
    // scheduler notifies those with the run summary this function cannot see —
    // and the "is anyone looking" check lives inside notifications.ts, so a
    // watched turn stays silent without this module touching electron.
    if (origin.kind !== 'routine') {
      notifyTurnFinished({ contactId, origin, finalText, error: failure })
    }

    // Blueprint §6, and deliberately the last thing to happen: it runs after
    // the lock is released and after the renderer has been told the turn is
    // over, so a slow summariser delays nothing the user is waiting on. Not
    // awaited, and it never rejects — see summarizeTurn's contract.
    const summarising = summarizeTurn(contactId, prompt, finalText, origin)

    // Settled after the lock is released, so a routine writing its own rows in
    // reaction cannot be refused by the very turn it is reacting to. It waits
    // on the summariser because that is where a routine's lastRunSummary and
    // its `routine_run` row come from — the one already-paid-for summary of
    // this turn, rather than a second model call for a UI subtitle.
    void summarising.then((summary) =>
      settleRun(run, {
        runId,
        finalText,
        error: failure,
        aborted: run.controller.signal.aborted,
        usage: done?.usage ?? null,
        summary
      })
    )
  }
}

/**
 * Hands the outcome back to whoever started the turn.
 *
 * Wrapped so a consumer that throws cannot escape into `finish`'s `finally` and
 * replace the error path of a turn that has already been committed.
 */
function settleRun(run: Run, outcome: TurnOutcome): void {
  try {
    run.settle(outcome)
  } catch (error) {
    console.error('[messaging] a turn-completion consumer threw', error)
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
