import type { Skill } from '../../shared/domain'
import type { SessionSpec } from './types'

/**
 * Context injection (blueprint §5): a persona's system prompt plus the content
 * of every skill attached to it, as one instruction string.
 *
 * Shared by both adapters rather than written twice, so "Claude and Codex
 * receive identical instructions" is true by construction instead of by
 * inspection — which matters, because the two deliver it by very different
 * routes (Claude's `systemPrompt` option vs Codex's `developer_instructions`
 * config override).
 */

const SKILLS_HEADING = '## Skills'

/**
 * Skills are rendered in the order persona.skillIds lists them, not the order
 * the caller happened to load them in, so the composed prompt is stable across
 * runs — an unstable prefix would defeat prompt caching for no benefit.
 */
export function orderSkills(skillIds: string[], skills: Skill[]): Skill[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  return skillIds.map((id) => byId.get(id)).filter((skill): skill is Skill => skill !== undefined)
}

export function composeInstructions(spec: SessionSpec): string {
  const { persona, skills } = spec
  const ordered = orderSkills(persona.skillIds, skills)

  const sections = [persona.systemPrompt.trim()]

  if (ordered.length > 0) {
    sections.push(
      [
        SKILLS_HEADING,
        ...ordered.map((skill) => `### ${skill.name}\n\n${skill.content.trim()}`)
      ].join('\n\n')
    )
  }

  // Phase 7 seam: blueprint §5 also calls for the last N durable and routine
  // GroupMessages for this repo to be injected here. There are no group
  // messages until Phase 7 writes some, so nothing is appended yet — add the
  // section here rather than in either adapter, so both keep getting the same
  // text.

  return sections.filter((section) => section !== '').join('\n\n')
}
