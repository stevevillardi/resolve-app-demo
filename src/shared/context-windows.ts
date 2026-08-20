/**
 * How much a model will hold, so the thread can say how full it is.
 *
 * A percentage needs a denominator, and neither SDK hands one to this app, so
 * the denominator has to be written down. Inventing a number to divide by would
 * be a guess presented as a measurement; transcribing one, dating it, and saying
 * per row where it came from is not — which is exactly what `pricing.ts` already
 * does for a set of numbers nobody could derive either. A figure that is missing
 * shows no percentage at all rather than a made-up one, and that path is tested.
 *
 * In `src/shared/` because both processes need it: the meter renders in the
 * renderer, which may not import `src/main`, while the model ids it is keyed by
 * are `src/main/adapters/models.ts`'s. `models.test.ts` pins the two together —
 * a model added to the picker without a window here fails that test rather than
 * quietly losing its percentage.
 *
 * Like `models.ts` and `pricing.ts`, this WILL go stale, and staleness here is
 * not a cosmetic defect: a window recorded five times too small has the meter
 * calling a half-full prompt full. **Read `CONTEXT_WINDOWS_LAST_VERIFIED`
 * first.** `source` records where a number came from and says nothing about
 * whether it is still current, so a `published` row goes stale exactly as
 * quietly as an `inferred` one — the date is the only field that answers that
 * question, and re-checking means re-checking every row, not just the hedged
 * ones.
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
  // Anthropic documents a 1M-token window for the Opus 4.6-and-later line, the
  // Sonnet 4.6-and-later line, and the whole 5 family — on the Claude API,
  // Bedrock, Vertex and Foundry alike. 1M is the *default* for these ids: no
  // beta header, and long-context requests bill at standard rates, so there is
  // no tier boundary inside the window the way there is for the GPT-5 line
  // below. (Those requests cap at 128k output tokens, which is a limit on the
  // reply rather than on the window, so nothing here reads it.)
  'claude-fable-5': { tokens: 1_000_000, source: 'published' },
  'claude-opus-5': { tokens: 1_000_000, source: 'published' },
  'claude-opus-4-8': { tokens: 1_000_000, source: 'published' },
  'claude-opus-4-7': { tokens: 1_000_000, source: 'published' },
  'claude-opus-4-6': { tokens: 1_000_000, source: 'published' },
  'claude-sonnet-5': { tokens: 1_000_000, source: 'published' },
  'claude-sonnet-4-6': { tokens: 1_000_000, source: 'published' },
  // Everything older stayed at 200k, Sonnet 4.5 included. Haiku is the only
  // model in this app's picker on that tier, and it is the one the captured SDK
  // fixture covers — `claude.test.ts` reports `contextWindow: 200000` for it,
  // which makes this the single row here confirmed by a real run rather than by
  // transcription.
  'claude-haiku-4-5': { tokens: 200_000, source: 'published' },

  // OpenAI documents 400k total for the GPT-5 line. Consistent with this repo's
  // own LONG_CONTEXT_THRESHOLD of 272k, which is the *input* tier boundary
  // inside that window rather than the window itself — worth not confusing,
  // since the two numbers sit two files apart and one looks like the other.
  //
  // The `inferred` rows below are the ids OpenAI does not document individually;
  // they carry the line's figure because they belong to it, which is a weaker
  // claim than a vendor page naming the id — and a reason to re-check them, not
  // to distrust them more than the dated `published` ones beside them.
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
