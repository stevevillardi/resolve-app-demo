/**
 * How much a model will hold, so the thread can say how full it is.
 *
 * **This reverses a stance recorded in `src/renderer/src/lib/usage.ts`**, which
 * refused to show a percentage on the grounds that "there is no per-model
 * context-window table anywhere in this app, and inventing one to divide by
 * would be a guess presented as a measurement". The objection was right about
 * inventing and wrong about the conclusion: the answer is to write the table
 * down, date it, and say per row where each number came from — which is exactly
 * what `pricing.ts` already does for a set of numbers nobody could derive
 * either. A figure that is transcribed and labelled is not a guess. A figure
 * that is missing still shows no percentage, and that path is tested.
 *
 * In `src/shared/` because both processes need it: the meter renders in the
 * renderer, which may not import `src/main`, while the model ids it is keyed by
 * are `src/main/adapters/models.ts`'s. `models.test.ts` pins the two together —
 * a model added to the picker without a window here fails that test rather than
 * quietly losing its percentage.
 *
 * Like `models.ts` and `pricing.ts`, this WILL go stale. LAST_VERIFIED is how
 * the next person finds out.
 *
 * **Two open items ride on this file**, both in `docs/plan/00-progress.md` under
 * "Cross-cutting open items": the Claude 5 rows are `inferred` and want
 * confirming, and the Claude SDK reports a window per turn that this app is not
 * yet reading — which would retire the first item for that backend. Recorded
 * there rather than only here so they are found by someone reading the plan,
 * not only by someone already editing this table.
 */

/** ISO date this table was last checked against vendor documentation. */
export const CONTEXT_WINDOWS_LAST_VERIFIED = '2026-08-17'

export interface ContextWindow {
  /** Total tokens the model accepts in one request. */
  tokens: number
  /**
   * Where the number came from, carried per row rather than per table because
   * the two kinds are mixed and the difference matters to a reader deciding
   * whether to trust a percentage.
   *
   * `published` — stated by the vendor for this model id.
   * `inferred` — taken from the family it belongs to, because the vendor does
   * not document this id on its own. Same convention as CODEX_PRICES.
   */
  source: 'published' | 'inferred'
}

/**
 * Keyed exactly as `models.ts` keys its menu, which is by undated alias.
 *
 * Claude bills against *dated* ids — the captured SDK fixture in
 * `claude.test.ts` reports `modelUsage` under `claude-haiku-4-5-20251001` while
 * the picker offers `claude-haiku-4-5` — so `contextWindowFor` strips a
 * trailing date. That is measured from a real run, not assumed.
 */
const CONTEXT_WINDOWS: Record<string, ContextWindow> = {
  // Anthropic has published 200k for every Claude model to date, and the
  // captured fixture confirms it for haiku-4-5.
  'claude-opus-4-8': { tokens: 200_000, source: 'published' },
  'claude-opus-4-7': { tokens: 200_000, source: 'published' },
  'claude-opus-4-6': { tokens: 200_000, source: 'published' },
  'claude-sonnet-4-6': { tokens: 200_000, source: 'published' },
  'claude-haiku-4-5': { tokens: 200_000, source: 'published' },
  // The 5 family at the family baseline. Marked inferred deliberately: it is
  // the figure every Claude generation has shipped with, but it is not a number
  // read off a page for these ids, and a reader deciding whether to act on "92%
  // full" deserves to know which of those two they are looking at.
  'claude-fable-5': { tokens: 200_000, source: 'inferred' },
  'claude-opus-5': { tokens: 200_000, source: 'inferred' },
  'claude-sonnet-5': { tokens: 200_000, source: 'inferred' },

  // OpenAI documents 400k total for the GPT-5 line. Consistent with this repo's
  // own LONG_CONTEXT_THRESHOLD of 272k, which is the *input* tier boundary
  // inside that window rather than the window itself — worth not confusing,
  // since the two numbers sit two files apart and one looks like the other.
  'gpt-5.6-cyber': { tokens: 400_000, source: 'inferred' },
  'gpt-5.6-sol': { tokens: 400_000, source: 'inferred' },
  'gpt-5.6-terra': { tokens: 400_000, source: 'inferred' },
  'gpt-5.6-luna': { tokens: 400_000, source: 'inferred' },
  'gpt-5.5': { tokens: 400_000, source: 'inferred' },
  'gpt-5.4': { tokens: 400_000, source: 'inferred' },
  'gpt-5.4-mini': { tokens: 400_000, source: 'inferred' },
  'gpt-5.3-codex': { tokens: 400_000, source: 'published' },
  'gpt-5.2-codex': { tokens: 400_000, source: 'published' },
  'gpt-5.1-codex': { tokens: 400_000, source: 'published' },
  'gpt-5.2': { tokens: 400_000, source: 'published' },
  'gpt-5.1': { tokens: 400_000, source: 'published' },
  'gpt-5': { tokens: 400_000, source: 'published' }
}

/** Undated form of a model id, if it carries a trailing snapshot date. */
const DATED = /-\d{8}$/

/**
 * The window for a model, or null when this app does not know one.
 *
 * Exactly two lookups and then it gives up: the id as given, then the id with a
 * trailing `-YYYYMMDD` removed. No prefix scan and no fuzzy match — a near miss
 * that resolved to a *different* model's window would be the guess-presented-
 * as-a-measurement this table exists to avoid, and it would be invisible.
 *
 * Null is a supported answer all the way to the screen: the meter falls back to
 * the bare token count with no percentage and no bar, which is what the app did
 * before this table existed.
 */
export function contextWindowFor(model: string | null | undefined): ContextWindow | null {
  if (!model) return null
  return CONTEXT_WINDOWS[model] ?? CONTEXT_WINDOWS[model.replace(DATED, '')] ?? null
}
