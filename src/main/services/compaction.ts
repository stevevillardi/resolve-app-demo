import { summaryModelFor } from '../adapters/models'
import { adapterForBackend } from './adapter-host'
import { getContact } from './contacts'
import { groupForRepo, insertGroupMessage } from './group-messages'
import { getPersonaTemplate } from './persona-templates'
import { recordUsage } from './usage-events'
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
 * Summarises one finished turn into the repo's Group.
 *
 * Fire-and-forget by contract — the caller must not await it, and it never
 * rejects. Returns the row it wrote, or null if there was nothing to write, so
 * tests can assert on the outcome without reaching into the database.
 */
export async function summarizeTurn(
  contactId: string,
  prompt: string,
  reply: string
): Promise<{ id: string } | null> {
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

    const spec = {
      persona: summariserPersona(persona),
      repoPath: contact.repoPath,
      skills: [],
      model: summaryModelFor(persona.backend)
    }

    const { data, usage } = await adapter.summarize(
      adapter.createSession(spec),
      `${PROMPT_HEADER}\n\n--- user ---\n${prompt}\n\n--- ${persona.name} ---\n${reply}`,
      SUMMARY_JSON_SCHEMA
    )

    // Recorded even when the summary itself is unusable: the tokens were spent
    // either way, and a category of spend that silently vanishes is worse on a
    // cost dashboard than one that shows up with nothing to show for it.
    if (usage) recordUsage(contactId, 'summary', usage)

    const parsed = summarySchema.safeParse(data)
    if (!parsed.success) return null

    return insertGroupMessage({
      groupId: group.id,
      type: 'system_summary',
      contactId,
      content: parsed.data.summary,
      category: parsed.data.category,
      // §6's rule, and the only place it is decided: decisions and tradeoffs
      // are the running decision log and are always re-injected; routine
      // entries stay queryable but fall out of context by recency.
      durable: parsed.data.category !== 'routine',
      // Falsy covers both shapes of "no branch": Codex is obliged to send the
      // key and sends null, Claude may omit it. Neither should be stored.
      ...(parsed.data.branch ? { branch: parsed.data.branch } : {})
    })
  } catch (error) {
    // The turn this summarises was committed before we got here. Losing a
    // Group entry is a degradation; propagating would corrupt a finished turn.
    console.error('[compaction] failed to summarise turn', error)
    return null
  }
}
