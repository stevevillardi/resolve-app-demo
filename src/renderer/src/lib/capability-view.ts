import { MCP_SERVERS, mcpServerInfo } from '../../../shared/mcp'
import type { RepoOffers } from '../../../shared/ipc-contract'
import type { RepoTrust } from '@/types'

/**
 * The rules behind the capability surface, kept out of the components.
 *
 * The renderer Vitest project matches `*.test.ts` only and there is no
 * component-testing library, so anything inside a `.tsx` cannot be tested at
 * all (see CLAUDE.md). These are the parts worth testing: what a checkbox does
 * to a trust record, how the approved set is reconciled with what is actually
 * on disk, and what the app is honestly able to claim about the built-in
 * capabilities it cannot suppress.
 */

export interface RepoSkillChoice {
  name: string
  description: string
  root: string
  /** Ticked. */
  approved: boolean
  /**
   * How this skill would reach the model if approved: the backend finds it
   * itself, or the app has to describe it. Shown because they are genuinely
   * different — a described skill costs prompt space every turn and cannot be
   * invoked as a skill, only read as a file.
   */
  delivery: 'discovered' | 'described'
  /**
   * Approved but no longer on disk. Kept visible rather than dropped: the
   * approval is still stored, and a skill that vanished because someone
   * reorganised the repo should be something a human notices and clears, not a
   * silent no-op.
   */
  missing: boolean
}

/**
 * Reconciles what a human approved against what the repository actually ships.
 *
 * Both directions matter and they fail differently. A skill on disk that is not
 * approved must appear unticked, or there is no way to grant it. A name in the
 * trust record with no file behind it must appear too — it is a stored approval
 * doing nothing, and hiding it would leave the user believing they granted
 * something they did not.
 */
export function repoSkillChoices(offers: RepoOffers | null, trust: RepoTrust): RepoSkillChoice[] {
  const approved = new Set(trust.skills)
  const onDisk = offers?.skills ?? []

  const choices: RepoSkillChoice[] = onDisk.map((skill) => ({
    name: skill.name,
    description: skill.description,
    root: skill.root,
    approved: approved.has(skill.name),
    delivery: skill.codexNative ? 'discovered' : 'described',
    missing: false
  }))

  const present = new Set(onDisk.map((skill) => skill.name))
  for (const name of trust.skills) {
    if (present.has(name)) continue
    choices.push({
      name,
      description: 'Approved, but no longer in the repository.',
      root: '',
      approved: true,
      delivery: 'described',
      missing: true
    })
  }

  return choices
}

/** Ticking and unticking one skill, without disturbing the instructions grant. */
export function toggleSkillTrust(trust: RepoTrust, name: string): RepoTrust {
  const approved = new Set(trust.skills)
  if (approved.has(name)) approved.delete(name)
  else approved.add(name)

  // Sorted so the stored record does not depend on click order — two users who
  // approved the same set should produce the same row.
  return { ...trust, skills: [...approved].sort() }
}

export function setInstructionsTrust(trust: RepoTrust, instructions: boolean): RepoTrust {
  return { ...trust, instructions }
}

/**
 * The reach axis, derived rather than stored.
 *
 * `sandbox` covers the disk and `githubScope` covers what may be done on
 * GitHub. Neither says whether the persona can reach the network at all, which
 * is what holding a server means — so this is read off the allowlist rather
 * than being a fourth column nobody would keep in step with it.
 */
export type McpReach = 'none' | 'github'

export function mcpReach(mcpServerIds: string[]): McpReach {
  return mcpServerIds.includes('github') ? 'github' : 'none'
}

export interface McpServerChoice {
  id: string
  label: string
  description: string
  governedBy: string
  granted: boolean
}

export function mcpServerChoices(mcpServerIds: string[]): McpServerChoice[] {
  return MCP_SERVERS.map((server) => ({ ...server, granted: mcpServerIds.includes(server.id) }))
}

export function toggleMcpServer(mcpServerIds: string[], id: string): string[] {
  return mcpServerIds.includes(id)
    ? mcpServerIds.filter((granted) => granted !== id)
    : [...mcpServerIds, id].sort()
}

/** The label the editor shows for a granted id, falling back to the raw id. */
export function mcpServerLabel(id: string): string {
  return mcpServerInfo(id)?.label ?? id
}

/**
 * What each backend brings that this app cannot switch off.
 *
 * Measured, not reasoned — see docs/plan/00-progress.md. Claude ships 16
 * built-in skills plus 48 slash commands and neither `skills: []` nor
 * `plugins: []` removes them; Codex ships 5, two of which acquire further
 * capabilities of their own. Every other capability on this screen is something
 * a human granted, so leaving these unmentioned would make the panel a list of
 * *some* of what a session can do while reading as a list of all of it.
 *
 * Disclosed rather than pretended away, which is the same choice `sandbox`
 * enforcement makes when it reports `os` versus `policy` instead of showing one
 * chip for both.
 */
export function builtInSkillCount(backend: 'claude' | 'codex'): number {
  return backend === 'claude' ? 16 : 5
}

export function builtInNote(backend: 'claude' | 'codex'): string {
  return backend === 'claude'
    ? '16 built-in skills and 48 slash commands ship with Claude Code and cannot be turned off.'
    : '5 built-in skills ship with Codex and cannot be turned off.'
}
