export type PersonaBackend = 'claude' | 'codex'

export type SandboxLevel = 'read_only' | 'workspace_write' | 'full_access'

export type GithubScope = 'read_only' | 'open_pr' | 'full_access'

export interface PersonaTemplate {
  id: string
  name: string
  avatarColor: string
  backend: PersonaBackend
  systemPrompt: string
  skillIds: string[]
  sandbox: SandboxLevel
  githubScope: GithubScope
}
