import { summaryModelFor } from '../adapters/models'
import { adapterForBackend } from './adapter-host'
import { getContact } from './contacts'
import { groupForRepo, insertGroupMessage } from './group-messages'
import { getPersonaTemplate } from './persona-templates'
import { workingPathFor } from './run-lock'
import type { TurnOrigin, TurnSummary } from './turn-origin'
import { recordUsage } from './usage-events'
import { recordOfWork, type WorkRecord } from './worktrees'
import { SUMMARY_JSON_SCHEMA, summarySchema } from '../../shared/summary'
import type { PersonaTemplate } from '../../shared/domain'

/**
 * End-of-session compaction (blueprint §6).
 *
 * §6's insight is that filesystem state crosses Contact boundaries for free and
 * intent does not: the reasoning behind a change lives in one private
 * conversation and is invisible to every other persona on the repo. So after
 * each turn we ask for a structured summary of what just happened and post it
 * to the repo's Group, where src/main/services/group-messages.ts reads it back
 * into every session that starts there afterwards.
 *
 * Three properties this module is built around, in descending order of how
 * annoying they are to rediscover:
 *
 * 1. **It must never fail the user's turn.** By the time this runs the reply is
 *    already persisted and `done` has been emitted. Every failure here is
 *    swallowed and logged; the visible symptom is a missing Group entry, which
 *    is the correct degradation.
 * 2. **It runs on a throwaway session, not the persona's.** Resuming the
 *    persona's session would append a summarise turn to the user's own
 *    conversation history — and on Claude it is not even possible, because
 *    `outputFormat` is a session-level option that cannot be switched on for a
 *    session already in flight.
 * 3. **It takes no lock and emits no events.** It is a text-only turn against a
 *    transcript it is handed. Taking a run-lock hold would put a phantom entry
 *    in listActiveRuns() and the fleet indicator; emitting events would render
 *    the summariser's output as a reply in the thread.
 */

const PROMPT_HEADER =
  'Summarise the exchange below for a shared project log that other agents working ' +
  'on this repository will read before they start. Record intent and rationale, not ' +
  'a restatement of the code. Categorise by what the turn left behind rather than by ' +
  'how much was deliberated: if the repository changed, it is not routine, even if ' +
  'the change was asked for outright. Answer only with the requested JSON object.'

/**
 * A persona for the summariser, derived from the one whose turn is being
 * summarised.
 *
 * Read-only and skill-less on purpose: it is given its material in the prompt,
 * and inheriting the persona's skills would spend tokens re-injecting
 * instructions that have nothing to do with summarising. It keeps the backend,
 * because that is what decides which SDK and which credentials are in play.
 */
function summariserPersona(persona: PersonaTemplate): PersonaTemplate {
  return {
    ...persona,
    id: `${persona.id}-summariser`,
    systemPrompt: PROMPT_HEADER,
    skillIds: [],
    sandbox: 'read_only',
    model: summaryModelFor(persona.backend)
  }
}

/**
 * Tells the summariser where the work landed, when it landed out of sight.
 *
 * Written into the prompt rather than left for the model to discover, so the
 * summary text itself names the branch — the row's `branch` column is what the
 * next session's context renders, but a colleague reading the log wants the
 * sentence to say so too.
 */
function describeWork(work: WorkRecord | null): string {
  if (!work || work.files.length === 0) return ''

  const files = work.files.slice(0, FILES_IN_PROMPT)
  const more = work.files.length - files.length

  return [
    `This turn's work is committed on branch \`${work.branch}\`, which is not checked out`,
    'in the main tree — nobody else can see these changes on disk. Say so in the summary,',
    `and name the branch. Files changed: ${files.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`
  ].join(' ')
}

/** Enough to be useful in a summary; a whole refactor's file list is not. */
const FILES_IN_PROMPT = 12

/**
 * Summarises one finished turn into the repo's Group.
 *
 * Fire-and-forget by contract — the caller must not await it, and it never
 * rejects. Returns the row it wrote, or null if there was nothing to write, so
 * tests can assert on the outcome without reaching into the database.
 */
export async function summarizeTurn(
  contactId: string,
  prompt: string,
  reply: string,
  origin: TurnOrigin = { kind: 'message' }
): Promise<TurnSummary | null> {
  try {
    // Nothing was said, so there is nothing to record. Catches aborted turns,
    // which reach finish() with empty text but are otherwise ordinary.
    if (!reply.trim()) return null

    const contact = getContact(contactId)
    if (!contact) return null

    const persona = getPersonaTemplate(contact.personaTemplateId)
    if (!persona) return null

    const adapter = adapterForBackend(persona.backend)
    // A backend that cannot constrain output to a schema would return prose we
    // would then store as a summary. Saying so beats guessing — see
    // AgentCapabilities.supportsStructuredOutput.
    if (!adapter.capabilities.supportsStructuredOutput) return null

    const group = groupForRepo(contact.repoPath)
    if (!group) return null

    // What the turn left on a branch nobody else can see. Asked of git, not of
    // the model — see recordOfWork().
    const work = await recordOfWork(contact)

    const spec = {
      persona: summariserPersona(persona),
      // The working path, not the repo: the summariser has to be able to look at
      // the tree the turn actually happened in. Pointed at the main tree it
      // would be describing somebody else's files.
      repoPath: workingPathFor(contact),
      skills: [],
      model: summaryModelFor(persona.backend)
    }

    const { data, usage } = await adapter.summarize(
      adapter.createSession(spec),
      [
        PROMPT_HEADER,
        describeWork(work),
        `--- user ---\n${prompt}`,
        `--- ${persona.name} ---\n${reply}`
      ]
        .filter(Boolean)
        .join('\n\n'),
      SUMMARY_JSON_SCHEMA
    )

    // Recorded even when the summary itself is unusable: the tokens were spent
    // either way, and a category of spend that silently vanishes is worse on a
    // cost dashboard than one that shows up with nothing to show for it.
    if (usage) recordUsage(contactId, 'summary', usage)

    const parsed = summarySchema.safeParse(data)
    if (!parsed.success) return null

    const durable = parsed.data.category !== 'routine'
    // git's answer wins over the model's. The model's `branch` stays as the
    // fallback for a session that switched branches itself in the main tree,
    // which git cannot attribute to this turn. Falsy covers both shapes of "no
    // branch": Codex is obliged to send the key and sends null, Claude may omit
    // it. Neither should be stored.
    const branch = work?.branch || parsed.data.branch || null
    // A routine's summary IS its Group record — it replaces the `system_summary`
    // rather than joining it, so one unattended fire leaves one row. It still
    // carries `category`/`durable`, because contextForRepo reads both types and
    // work done while nobody watched is exactly what §6 has to carry across
    // Contact boundaries.
    const row = insertGroupMessage({
      groupId: group.id,
      type: origin.kind === 'routine' ? 'routine_run' : 'system_summary',
      contactId,
      content: parsed.data.summary,
      category: parsed.data.category,
      // §6's rule, and the only place it is decided: decisions and tradeoffs
      // are the running decision log and are always re-injected; routine
      // entries stay queryable but fall out of context by recency.
      durable,
      ...(branch ? { branch } : {})
    })

    // A separate row rather than a field on the summary: this is the one thing
    // in the phase a persona cannot do for itself, it needs its own shape in the
    // thread because it is actionable, and it must not be swept up by the
    // recency limits that govern the decision log.
    // Compared against the row rather than against `work`, so it holds whether
    // or not the worktree has been materialised: asking for a merge of the
    // branch you are already on is a model mistake, not an instruction.
    const needs = parsed.data.needs
    if (needs && needs.branch !== contact.branch) {
      insertGroupMessage({
        groupId: group.id,
        type: 'branch_request',
        contactId,
        content: needs.reason,
        branch: needs.branch
      })
    }

    return { id: row.id, summary: parsed.data.summary, category: parsed.data.category, durable }
  } catch (error) {
    // The turn this summarises was committed before we got here. Losing a
    // Group entry is a degradation; propagating would corrupt a finished turn.
    console.error('[compaction] failed to summarise turn', error)
    return null
  }
}
