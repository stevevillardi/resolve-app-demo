import { describe, expect, it } from 'vitest'
import { CODEX_PRICES } from './pricing'
import { MODELS_LAST_VERIFIED, SUMMARY_MODELS, modelsForBackend, summaryModelFor } from './models'

/**
 * The invariant models.ts states in a comment and nothing enforced.
 *
 * "Codex entries are kept in step with CODEX_PRICES" was true by inspection
 * until someone added a model without a price row, at which point every turn on
 * it reports `costUsd: null` — honest, and useless on the dashboard. The
 * failure is silent at the point of the mistake and only visible much later, in
 * a total that is quietly short, which is exactly the shape of thing worth
 * pinning.
 *
 * Deliberately asserted for Codex only. There is no Claude price table and
 * there should not be: Claude's cost comes from its own SDK, so a Claude model
 * with no local row is the normal case rather than a defect.
 */

describe('the codex model menu', () => {
  it('prices every model it offers', () => {
    for (const model of modelsForBackend('codex')) {
      expect(CODEX_PRICES[model], model).toBeDefined()
    }
  })

  it('prices the summariser, which bills like any other turn', () => {
    expect(CODEX_PRICES[summaryModelFor('codex')]).toBeDefined()
  })

  it('offers the summariser as a choice, so it is visible in the picker', () => {
    expect(modelsForBackend('codex')).toContain(SUMMARY_MODELS.codex)
  })
})

describe('the model menu', () => {
  it('carries a last-verified date, since these lists go stale', () => {
    expect(MODELS_LAST_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('keeps the two backends disjoint', () => {
    // The editor clears the model on a backend switch precisely because no
    // choice survives one. A shared id would make that reset look like a bug.
    const claude = modelsForBackend('claude')
    const codex = modelsForBackend('codex')
    expect(claude.filter((model) => codex.includes(model))).toEqual([])
  })

  it('hands out a copy, so a caller cannot edit the menu', () => {
    const first = modelsForBackend('claude')
    first.push('claude-not-a-model')
    expect(modelsForBackend('claude')).not.toContain('claude-not-a-model')
  })

  it('names no dated Claude snapshot, where an alias exists', () => {
    // A dated id is valid but pins a snapshot, and needs editing every time one
    // ships. The aliases do not.
    for (const model of [...modelsForBackend('claude'), SUMMARY_MODELS.claude]) {
      expect(model, model).not.toMatch(/-\d{8}$/)
    }
  })
})
