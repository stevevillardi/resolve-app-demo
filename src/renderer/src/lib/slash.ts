import { scoreCommand, type CommandItem } from './command-palette'
import type { ContactContext } from '../../../shared/ipc-contract'

/**
 * The `/` picker: what *this* contact can actually reach, right now.
 *
 * The governance argument of the whole phase, applied to the composer. A menu
 * that offered every skill the repository ships would be offering things the
 * session is sealed against — the user picks one, the persona has never heard
 * of it, and the app has just lied about its own permission model. So the list
 * is built from `contacts.context`, which is the resolved answer to "what would
 * the next turn be handed", rather than from what is on disk.
 *
 * That has a consequence worth stating: the picker is **empty** for a contact
 * that has been granted nothing, which is the default. Empty is the honest
 * answer there, and the picker says so rather than padding itself out.
 *
 * Lives in lib/ because the renderer Vitest project matches `*.test.ts` only —
 * a `.tsx` cannot be tested here at all (CLAUDE.md).
 */

export interface SlashCommand {
  /** Bare name, as typed after the slash. */
  name: string
  description: string
  /** What lands in the composer when it is picked. */
  template: string
  /**
   * Where the capability comes from. `repo-skill` is a SKILL.md the contact was
   * approved for; `tool` is a server it can reach.
   */
  kind: 'repo-skill' | 'tool'
}

/**
 * Built from what a turn would actually receive.
 *
 * Both skill lists are included and deliberately not distinguished here: a
 * discovered skill and a described one differ in *how* they reach the model,
 * which the context panel reports, but both are equally usable from the
 * composer and a user choosing one does not care which mechanism carried it.
 */
export function slashCommands(context: ContactContext | null | undefined): SlashCommand[] {
  if (!context) return []

  const commands: SlashCommand[] = []

  for (const name of context.repoSkills) {
    commands.push({
      name,
      description: 'Skill from this repository.',
      template: `Use the ${name} skill: `,
      kind: 'repo-skill'
    })
  }

  for (const skill of context.injectedSkills) {
    commands.push({
      name: skill.name,
      description: skill.description || 'Skill from this repository.',
      template: `Use the ${skill.name} skill: `,
      kind: 'repo-skill'
    })
  }

  // Only when the server is genuinely reachable. `unavailableServers` is
  // deliberately not offered: a persona granted GitHub with no account
  // connected cannot do this, and offering it anyway is how a user ends up
  // believing the app is broken rather than disconnected.
  if (context.mcpServers.some((server) => server.id === 'github')) {
    commands.push({
      name: 'issues',
      description: 'Ask about open issues on this repository.',
      template: 'Check the open issues on this repository and summarise them: ',
      kind: 'tool'
    })
    commands.push({
      name: 'review-pr',
      description: 'Review an open pull request.',
      template: 'Review the open pull request on this repository: ',
      kind: 'tool'
    })
  }

  return commands
}

/**
 * The query being typed, or null when the picker should not be open.
 *
 * **Strict prefix at index 0**, unlike `parseMention`, which matches after
 * `trimStart()`. A leading space is a real difference in intent: `@name` is a
 * mention wherever it appears in a sentence, while a slash command is the whole
 * message or it is nothing. `"  /release"` is prose about a path.
 *
 * Returns null once whitespace follows the name — by then the command has been
 * chosen and what is being typed is the argument.
 */
export function parseSlashQuery(value: string): string | null {
  if (!value.startsWith('/')) return null

  const rest = value.slice(1)
  if (/\s/.test(rest)) return null

  return rest
}

/** Ranked by the palette's own scorer, so both pickers agree on what "matches" means. */
export function rankSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  return commands
    .map((command, index) => ({
      command,
      index,
      score: scoreCommand(asItem(command), query)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command)
}

function asItem(command: SlashCommand): CommandItem {
  return {
    id: command.name,
    // The scorer's group is irrelevant here — this picker has no sections — but
    // CommandItem requires one, and reusing the type is what keeps the two
    // pickers agreeing about what counts as a match.
    group: 'Actions',
    label: command.name,
    detail: command.description
  }
}

/**
 * Replaces the typed `/query` with the command's template.
 *
 * Nothing is ever discarded, because there is never anything to discard:
 * `parseSlashQuery` returns null the moment whitespace appears, so the picker
 * is only open while the entire value is the token being typed. Guarding on
 * that here rather than assuming it — a caller that applies a command to some
 * other value gets its value back untouched instead of having it overwritten.
 */
export function applySlashCommand(value: string, command: SlashCommand): string {
  if (parseSlashQuery(value) === null) return value
  return command.template
}
