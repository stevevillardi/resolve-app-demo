import type { PersonaBackend } from '../../shared/domain'
import { createClaudeAdapter } from './claude'
import { createCodexAdapter } from './codex'
import type { AdapterConfig, AgentAdapter } from './types'

export type { AdapterConfig, AgentAdapter, AgentSession, SessionSpec } from './types'

/**
 * Picks the adapter for a persona's backend.
 *
 * Takes config rather than reading it from anywhere, because nothing under
 * src/main/adapters/ may import `electron` — the Codex binary path in
 * particular has to be resolved by the caller. In the app that caller is
 * adapterForBackend() in services/adapter-host.ts, which builds the config
 * fresh for every turn; the probe scripts call this directly with a config of
 * their own.
 */
export function adapterFor(backend: PersonaBackend, config: AdapterConfig = {}): AgentAdapter {
  switch (backend) {
    case 'claude':
      return createClaudeAdapter(config)
    case 'codex':
      return createCodexAdapter(config)
  }
}
