import type { Usage } from '@openai/codex-sdk'

/**
 * Codex cost computation (blueprint §14 open item #3).
 *
 * Unlike Claude's SDK, @openai/codex-sdk returns token counts and no dollar
 * figure at all, so the price table lives here. Prices change — check
 * LAST_VERIFIED before trusting any number below, and treat every figure as an
 * estimate for in-app display, never as billing.
 */

/** ISO date this table was last checked against vendor pricing. */
export const LAST_VERIFIED = '2026-08-16'

/**
 * The context size above which OpenAI charges its long-context rates.
 *
 * Compared against **one turn's own input tokens**, which is the closest thing
 * we have to the size of the request the vendor priced. Codex reports usage
 * cumulatively across a thread, so `deltaFrom` has already subtracted the
 * baseline by the time cost is computed; cumulative input is the running sum of
 * each request's prompt, which makes the delta that request's prompt.
 *
 * That is an approximation of a rule we cannot observe directly, and it has one
 * consequence worth stating: a long conversation whose individual turns each
 * stay under the threshold is priced at the short-context rate throughout, even
 * though its cumulative input is far larger. That is the intended reading — the
 * tier is a property of a request, not of a conversation.
 */
export const LONG_CONTEXT_THRESHOLD = 272_000

/** USD per 1M tokens. */
export interface Rates {
  input: number
  /**
   * Null means the vendor publishes no cache discount for this model, so cached
   * tokens bill at the full input rate.
   *
   * Deliberately not `0`. The `-pro` models list their cached rate as $0.00,
   * which almost certainly means caching is unavailable rather than free, and
   * the two readings differ by the entire cost of the cached tokens. Charging
   * the input rate errs toward over-reporting, which is the safe direction for
   * a spend figure. No row below uses this yet; it exists so that adding a
   * `-pro` model cannot quietly encode "free".
   */
  cachedInput: number | null
  output: number
}

export interface ModelPrice extends Rates {
  /** Applies once a request's context passes LONG_CONTEXT_THRESHOLD. */
  longContext?: Rates
}

/**
 * Rates per 1M tokens, transcribed from OpenAI's published pricing page on
 * LAST_VERIFIED.
 *
 * Rows marked inferred are not listed on that page under their own name and
 * are recorded at their base model's rate — which is how the published
 * `gpt-5.3-codex` row prices against `gpt-5.2`. Marked so a later check knows
 * which figures were read and which were reasoned.
 *
 * Only some models are tiered, and the long-context rates are **transcribed,
 * not derived**: input and cached double, but output rises by half. Anyone
 * tempted to replace these with a multiplier should note that `gpt-5.5` goes
 * 30 → 45, not 30 → 60.
 */
export const CODEX_PRICES: Record<string, ModelPrice> = {
  // Published.
  'gpt-5.6-cyber': { input: 12.5, cachedInput: 1.25, output: 75.0 },
  'gpt-5.6-sol': {
    input: 5.0,
    cachedInput: 0.5,
    output: 30.0,
    longContext: { input: 10.0, cachedInput: 1.0, output: 45.0 }
  },
  'gpt-5.6-terra': {
    input: 2.0,
    cachedInput: 0.2,
    output: 12.0,
    longContext: { input: 4.0, cachedInput: 0.4, output: 18.0 }
  },
  'gpt-5.6-luna': {
    input: 0.2,
    cachedInput: 0.02,
    output: 1.2,
    longContext: { input: 0.4, cachedInput: 0.04, output: 1.8 }
  },
  'gpt-5.5': {
    input: 5.0,
    cachedInput: 0.5,
    output: 30.0,
    longContext: { input: 10.0, cachedInput: 1.0, output: 45.0 }
  },
  'gpt-5.4': {
    input: 2.5,
    cachedInput: 0.25,
    output: 15.0,
    longContext: { input: 5.0, cachedInput: 0.5, output: 22.5 }
  },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10.0 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10.0 },
  // Inferred from the matching base model.
  'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10.0 }
}

/**
 * Blueprint §14 open item #2 — RESOLVED empirically against codex-cli 0.147.0
 * on 2026-08-16, not assumed.
 *
 * `cached_input_tokens` is a SUBSET of `input_tokens`. The proof is the CLI's
 * own arithmetic, which the rollout file in ~/.codex/sessions records but the
 * SDK's typed `Usage` omits: two independent turns reported
 *
 *   input 12231 + output 58 = total 12289
 *   input 24542 + output 69 = total 24611
 *
 * with cached_input_tokens of 4480 and 16128 respectively. Had cached been
 * additive, the totals would have been 16769 and 40739. So billing input and
 * cached separately would have overcharged every cached turn — exactly the
 * double-count blueprint §14 flags a third-party integration for making.
 */
export const CACHED_TOKENS_ARE_SUBSET = true

/**
 * The same arithmetic settles the other two fields.
 *
 * `reasoning_output_tokens` (32 in both turns above) is inside `output_tokens`,
 * since input + output alone reaches the total — so it is never added on top.
 *
 * `cache_write_input_tokens` is not billed separately by OpenAI at all (prompt
 * cache writes are free, unlike Anthropic's cache-creation tokens), so it is
 * reported for visibility and never priced.
 */
export function computeCodexCost(model: string, usage: Usage): number | null {
  const price = CODEX_PRICES[model]
  // Null rather than 0: an unknown model showing $0.00 reads as "this turn was
  // free" instead of "we don't know what this cost".
  if (!price) return null

  // A model with no long-context row is billed at one rate whatever its size —
  // `?? price` is what makes the threshold irrelevant to those, rather than
  // needing a second branch.
  const rates = usage.input_tokens > LONG_CONTEXT_THRESHOLD ? (price.longContext ?? price) : price

  // CACHED_TOKENS_ARE_SUBSET is a constant, so this subtraction is not
  // conditional on it — the constant records *why* the subtraction is here.
  // Writing it as a ternary implied a runtime switch that never existed.
  const cached = usage.cached_input_tokens ?? 0
  const uncachedInput = Math.max(0, usage.input_tokens - cached)
  // No published discount means no discount, not a free ride — see Rates.
  const cachedRate = rates.cachedInput ?? rates.input

  return (
    (uncachedInput * rates.input) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    (usage.output_tokens * rates.output) / 1_000_000
  )
}
