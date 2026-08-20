import type { PersonaBackend } from '../../shared/domain'

/**
 * The models a persona may be pointed at, per backend.
 *
 * Hardcoded, and dated, for the same reason pricing.ts is: neither SDK exposes
 * a "models available to this account" call, so there is nothing to ask. This
 * list will go stale, and the LAST_VERIFIED marker is how anyone reading it
 * finds out.
 *
 * It is emphatically **not authoritative**: availability depends on the
 * *account*, not just the CLI version — a ChatGPT-account Codex user is refused
 * `gpt-5.2-codex` and `gpt-5.3-codex` with a 400 while `gpt-5.5` works, and
 * nothing in the SDK says so in advance.
 * So the real failure mode is a 400 on first use, which arrives as a normal
 * `error` event and lands in the thread like any other failure. Treat this list
 * as a menu of plausible choices, not a promise.
 */

export const MODELS_LAST_VERIFIED = '2026-08-17'

/**
 * Ordered most- to least-capable, because that is how the picker reads.
 *
 * Codex entries are kept in step with CODEX_PRICES in pricing.ts: a model that
 * can be chosen but not priced reports `costUsd: null` for every turn, which is
 * honest but useless on the usage dashboard.
 */
const MODELS: Record<PersonaBackend, string[]> = {
  // Undated aliases throughout: `claude-haiku-4-5-20251001` is a valid id, but
  // the alias is the documented form and does not need editing when a new
  // snapshot ships.
  claude: [
    'claude-fable-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5'
  ],
  // Generation-descending, then descending within a generation.
  codex: [
    'gpt-5.6-cyber',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex'
  ]
}

export function modelsForBackend(backend: PersonaBackend): string[] {
  return [...MODELS[backend]]
}

/**
 * The model that writes end-of-session summaries, per backend.
 *
 * Deliberately not the persona's model. Compaction runs after *every* turn, so
 * pinning it to the persona would roughly double the cost of an Opus-class
 * persona for a task that is classification, not reasoning: read one finished
 * turn, write a sentence, pick one of three categories. The cheapest model on
 * each backend is enough, and it keeps the price of coordination independent of
 * how expensive a persona the user chose.
 *
 * Same caveat as MODELS above — hardcoded because neither SDK will tell us, and
 * dated so the staleness is visible. A model that is unavailable to the account
 * fails the summary turn, which is swallowed: the user's turn is already
 * committed by then, so the visible symptom is a missing Group entry, not a
 * broken conversation.
 */
export const SUMMARY_MODELS: Record<PersonaBackend, string> = {
  // Still the cheapest Claude model, so nothing to move to.
  claude: 'claude-haiku-4-5',
  /**
   * The cheapest entry CODEX_PRICES knows, which is the whole selection rule.
   *
   * Took over from `gpt-5.4-mini` on 2026-08-17: 0.20/1.20 against 0.75/4.50
   * per 1M is 3.75x less on both input and output, and compaction runs after
   * *every* turn. It is cheaper in every case rather than on average — even
   * luna's long-context tier (0.40/1.80) undercuts gpt-5.4-mini's flat rate,
   * so there is no transcript size at which the old choice wins.
   *
   * The risk this carries is quality, not cost, and it is worth naming because
   * nothing in the test suite can see it: a summariser picks a category, and a
   * mis-categorised summary silently drops a turn's work out of every
   * colleague's context. That failure is invisible in the thread the turn
   * happened in and shows up later as a colleague missing something it should
   * have known. If summaries start reading thin or landing in the wrong
   * category, this line is the first thing to suspect.
   */
  codex: 'gpt-5.6-luna'
}

export function summaryModelFor(backend: PersonaBackend): string {
  return SUMMARY_MODELS[backend]
}
