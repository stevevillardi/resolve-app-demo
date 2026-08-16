import { z } from 'zod'
import { systemSummaryCategorySchema } from './domain'

/**
 * The end-of-session summary contract (blueprint §6), in both the shapes it
 * has to exist in: Zod for validating what came back, JSON Schema for telling
 * the backend what to produce.
 *
 * Lives in `shared/` rather than beside the compaction service so that
 * `scripts/probe-structured.ts` can import the real thing. The probe used to
 * carry its own copy with a "keep in step by hand" comment, which meant a probe
 * run verified the probe's schema rather than the app's — precisely the drift
 * the checked-in migrations exist to avoid elsewhere. Nothing here imports the
 * database or electron, so the probe stays runnable outside Electron.
 */

/**
 * ⚠️ **Every key must appear in `required`, and optionality is expressed as a
 * nullable type.** Codex passes this to OpenAI's strict structured-output mode,
 * which rejects anything else outright:
 *
 *     400 invalid_json_schema — 'required' is required to be supplied and to be
 *     an array including every key in properties. Missing 'branch'.
 *
 * Found by running `npm run probe:structured -- --backend codex --raw`, not by
 * reading either SDK's typings — both accept `Record<string, unknown>` and
 * neither says anything about strict mode. Claude accepts the same shape, so
 * one schema still serves both; a `branch` that is genuinely absent comes back
 * as `null` and is normalised away by summarySchema below.
 */
export const SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'One or two sentences, past tense, on what was decided or done and why. ' +
        'Written for a different agent working on this repo later, who cannot see this conversation.'
    },
    category: {
      type: 'string',
      enum: ['decision', 'tradeoff', 'routine'],
      description:
        'decision: a choice that later work must respect. ' +
        'tradeoff: a choice made with a cost worth recording. ' +
        'routine: everything else, including questions answered and code merely read.'
    },
    branch: {
      type: ['string', 'null'],
      description:
        'The git branch the work landed on, if the session created or switched to one. ' +
        'Null when the work happened on whatever branch was already checked out.'
    }
  },
  required: ['summary', 'category', 'branch'],
  additionalProperties: false
}

/**
 * `branch` is nullable *and* optional: Codex is required to send the key (see
 * above) and will send `null`, while Claude may legitimately omit it. Both mean
 * "no branch", and `GroupMessage.branch` is a plain optional string, so the
 * null is dropped rather than stored.
 */
export const summarySchema = z.object({
  summary: z.string().min(1),
  category: systemSummaryCategorySchema,
  branch: z.string().nullable().optional()
})

export type Summary = z.infer<typeof summarySchema>
