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

export const MODELS_LAST_VERIFIED = '2026-08-16'

/**
 * Ordered most- to least-capable, because that is how the picker reads.
 *
 * Codex entries are kept in step with CODEX_PRICES in pricing.ts: a model that
 * can be chosen but not priced reports `costUsd: null` for every turn, which is
 * honest but useless on the usage dashboard.
 */
const MODELS: Record<PersonaBackend, string[]> = {
  claude: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5-20251001'],
  codex: [
    'gpt-5.6-sol',
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
 * Whether a persisted model still belongs to its backend.
 *
 * The editor uses this to clear a stale choice when the backend is switched —
 * a Claude persona holding `gpt-5.5` would fail every turn, and failing at send
 * time is a worse place to find out than at edit time.
 */
export function isModelForBackend(backend: PersonaBackend, model: string): boolean {
  return MODELS[backend].includes(model)
}
