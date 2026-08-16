import type { PersonaBackend } from '../../shared/domain'

/**
 * The models a persona may be pointed at, per backend.
 *
 * Hardcoded, and dated, for the same reason pricing.ts is: neither SDK exposes
 * a "models available to this account" call, so there is nothing to ask. This
 * list will go stale, and the LAST_VERIFIED marker is how anyone reading it
 * finds out.
 *
 * It is emphatically **not authoritative**. Phase 5 established that
 * availability depends on the *account*, not just the CLI version — a
 * ChatGPT-account Codex user is refused `gpt-5.2-codex` and `gpt-5.3-codex`
 * with a 400 while `gpt-5.5` works, and nothing in the SDK says so in advance.
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
 * The model that writes end-of-session summaries (blueprint §6), per backend.
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
  claude: 'claude-haiku-4-5',
  /**
   * No longer the cheapest entry CODEX_PRICES knows, and left alone anyway.
   *
   * `gpt-5.6-luna` now undercuts it 3.75x on both input and output
   * (0.20/1.20 against 0.75/4.50), which across a summary after every turn is
   * real money. But the summariser's output is load-bearing rather than
   * decorative — Phase 7 found a mis-categorised summary silently drops a
   * turn's work out of every colleague's context — and nothing here can
   * measure summary *quality*. So this is a decision to make behind a live
   * check, not a side effect of refreshing a list.
   */
  codex: 'gpt-5.4-mini'
}

export function summaryModelFor(backend: PersonaBackend): string {
  return SUMMARY_MODELS[backend]
}
