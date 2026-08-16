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

export interface ModelPrice {
  /** USD per 1M tokens. */
  input: number
  cachedInput: number
  output: number
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
 * `gpt-5.5` and `gpt-5.4` are the <272K-context tier; OpenAI charges more above
 * that. Long sessions will under-report until this table grows a context
 * dimension — a known limitation, not an oversight.
 */
export const CODEX_PRICES: Record<string, ModelPrice> = {
  // Published.
  'gpt-5.6-sol': { input: 5.0, cachedInput: 0.5, output: 30.0 },
  'gpt-5.5': { input: 5.0, cachedInput: 0.5, output: 30.0 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15.0 },
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

  // CACHED_TOKENS_ARE_SUBSET is a constant, so this subtraction is not
  // conditional on it — the constant records *why* the subtraction is here.
  // Writing it as a ternary implied a runtime switch that never existed.
  const cached = usage.cached_input_tokens ?? 0
  const uncachedInput = Math.max(0, usage.input_tokens - cached)

  return (
    (uncachedInput * price.input) / 1_000_000 +
    (cached * price.cachedInput) / 1_000_000 +
    (usage.output_tokens * price.output) / 1_000_000
  )
}
