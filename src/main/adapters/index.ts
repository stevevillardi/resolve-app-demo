import type { PersonaBackend } from '../../shared/domain'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import type { AdapterConfig, AgentAdapter } from './types'

export type { AdapterConfig, AgentAdapter, AgentSession, SessionSpec } from './types'

/**
 * Picks the adapter for a persona's backend (blueprint §3).
 *
 * Takes config rather than reading it from anywhere, because nothing under
 * src/main/adapters/ may import `electron` — the Codex binary path in
 * particular has to be resolved by the caller. Phase 6 will call this once at
 * startup with { codexBinaryPath: resolveCodexBinary() }.
 */
export function adapterFor(backend: PersonaBackend, config: AdapterConfig = {}): AgentAdapter {
  switch (backend) {
    case 'claude':
      return createClaudeAdapter(config)
    case 'codex':
      return createCodexAdapter(config)
  }
}
