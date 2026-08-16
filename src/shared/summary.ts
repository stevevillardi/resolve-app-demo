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
 *
 * **The rule applies to nested objects too.** `needs` carries its own `required`
 * listing both of its keys and its own `additionalProperties: false`; without
 * them strict mode rejects every summary, not merely the rare one that fills it
 * in. Verified the same way on both backends after adding it — each returned
 * `needs: null` and parsed cleanly.
 *
 * The `category` descriptions are load-bearing prose, not documentation: they
 * are the only instruction the model gets about where the line falls, and
 * `durable` is derived from the answer. An earlier wording defined `routine` as
 * "everything else", and a live Journey 2 run classified an actual edit to
 * auth.ts as routine — the model read the category as being about how much it
 * had deliberated, and it had simply been told what to do. Written this way the
 * question is what the turn left behind, which is what §6 actually cares about.
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
        'Judge by what the turn left behind, not by how much was deliberated. ' +
        'decision: the repository was changed, or a choice was made that later work ' +
        'must respect — this applies even when the user asked for the change outright ' +
        'and nothing was weighed up. ' +
        'tradeoff: as decision, but an alternative was rejected or a cost accepted ' +
        'that someone should know about. ' +
        'routine: the repository is exactly as it was — a question answered, code ' +
        'read, a search run, a command that changed nothing.'
    },
    branch: {
      type: ['string', 'null'],
      description:
        'The git branch the work landed on, if the session created or switched to one. ' +
        'Null when the work happened on whatever branch was already checked out.'
    },
    needs: {
      type: ['object', 'null'],
      description:
        'Set this only if you could not finish because you needed changes that exist ' +
        'on another agent’s branch and are not in your working tree. Null otherwise — ' +
        'reading another branch does not count, since you can do that yourself with ' +
        'git show and git diff. This asks a human to merge it for you.',
      properties: {
        branch: {
          type: 'string',
          description: 'The branch whose changes you need in your own working tree.'
        },
        reason: {
          type: 'string',
          description:
            'One sentence on what you were blocked from doing, for the human deciding ' +
            'whether to merge it.'
        }
      },
      required: ['branch', 'reason'],
      additionalProperties: false
    }
  },
  required: ['summary', 'category', 'branch', 'needs'],
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
  branch: z.string().nullable().optional(),
  /**
   * A request for a human to merge somebody else's branch into this session's
   * tree — the one thing in docs/plan/12-worktree-isolation.md's three layers
   * that a persona cannot do for itself, and should not.
   *
   * Nested `additionalProperties: false` and its own `required` above, because
   * strict mode applies to sub-objects too and would otherwise 400 on every
   * summary rather than only on the rare turn that sets this.
   */
  needs: z
    .object({ branch: z.string().min(1), reason: z.string().min(1) })
    .nullable()
    .optional()
})

export type Summary = z.infer<typeof summarySchema>
