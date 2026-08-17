import { describe, expect, it } from 'vitest'
import {
  applySlashCommand,
  parseSlashQuery,
  rankSlashCommands,
  slashCommands,
  type SlashCommand
} from './slash'
import type { ContactContext } from '../../../shared/ipc-contract'

function context(overrides: Partial<ContactContext> = {}): ContactContext {
  return {
    persona: { id: 'p1', name: 'Reviewer', backend: 'claude', model: null },
    sessionId: null,
    systemPromptChars: 0,
    skills: [],
    repoSkills: [],
    injectedSkills: [],
    repoInstructions: null,
    repoTrust: { instructions: false, skills: [] },
    mcpServers: [],
    unavailableServers: [],
    groupContext: [],
    siblingBranches: [],
    workingContext: null,
    instructions: '',
    instructionsChars: 0,
    ...overrides
  }
}

describe('slashCommands', () => {
  it('offers nothing to a contact that has been granted nothing', () => {
    // The default, and the honest answer. A picker padded out with things the
    // session is sealed against would be the app contradicting its own
    // permission model at the exact moment a user is deciding what to ask for.
    expect(slashCommands(context())).toEqual([])
  })

  it('offers a repo skill once it is approved', () => {
    const commands = slashCommands(
      context({ injectedSkills: [{ name: 'release-notes', description: 'Draft the notes.' }] })
    )

    expect(commands.map((command) => command.name)).toEqual(['release-notes'])
    expect(commands[0].description).toBe('Draft the notes.')
  })

  it('treats a discovered skill and a described one alike', () => {
    // They differ in how they reach the model, which the context panel reports.
    // From the composer both are simply usable, and a user picking one has no
    // decision to make about the mechanism.
    const commands = slashCommands(
      context({
        repoSkills: ['native-one'],
        injectedSkills: [{ name: 'described-one', description: '' }]
      })
    )

    expect(commands.map((command) => command.name)).toEqual(['native-one', 'described-one'])
    expect(commands.every((command) => command.kind === 'repo-skill')).toBe(true)
  })

  it('offers GitHub actions only when the server is actually reachable', () => {
    const reachable = slashCommands(
      context({ mcpServers: [{ id: 'github', url: 'https://x/', deniedTools: 6 }] })
    )
    expect(reachable.map((command) => command.name)).toContain('issues')
  })

  it('offers nothing for a server that was granted and is unavailable', () => {
    // A persona with GitHub enabled and no account connected genuinely cannot
    // do this. Offering it anyway is how a user concludes the app is broken
    // rather than disconnected.
    const commands = slashCommands(
      context({
        mcpServers: [],
        unavailableServers: [{ id: 'github', reason: 'GitHub is not connected.' }]
      })
    )

    expect(commands).toEqual([])
  })

  it('survives the context not having loaded yet', () => {
    expect(slashCommands(null)).toEqual([])
    expect(slashCommands(undefined)).toEqual([])
  })
})

describe('parseSlashQuery', () => {
  it('opens on a bare slash', () => {
    expect(parseSlashQuery('/')).toBe('')
  })

  it('returns what has been typed so far', () => {
    expect(parseSlashQuery('/rel')).toBe('rel')
  })

  it('stays closed for ordinary prose', () => {
    expect(parseSlashQuery('what about src/index.ts')).toBeNull()
    expect(parseSlashQuery('')).toBeNull()
  })

  it('is strict about position, unlike a mention', () => {
    // parseMention matches after trimStart() because `@name` is a mention
    // wherever it appears. A slash command is the whole message or it is
    // nothing, and "  /release" is prose about a path.
    expect(parseSlashQuery('  /release')).toBeNull()
  })

  it('closes once the command has been chosen and an argument is being typed', () => {
    expect(parseSlashQuery('/release-notes ')).toBeNull()
    expect(parseSlashQuery('/release-notes for v2')).toBeNull()
  })

  it('closes on a newline as well as a space', () => {
    expect(parseSlashQuery('/release\n')).toBeNull()
  })
})

describe('rankSlashCommands', () => {
  const commands: SlashCommand[] = [
    { name: 'review-pr', description: 'Review a pull request.', template: '', kind: 'tool' },
    { name: 'release-notes', description: 'Draft the notes.', template: '', kind: 'repo-skill' },
    { name: 'issues', description: 'Open issues on the repo.', template: '', kind: 'tool' }
  ]

  it('returns everything for an empty query', () => {
    expect(rankSlashCommands(commands, '')).toHaveLength(3)
  })

  it('puts a prefix match first', () => {
    expect(rankSlashCommands(commands, 're')[0].name).toBe('review-pr')
  })

  it('finds a command by its description', () => {
    // Lower-ranked than a name hit, but present — "pull request" is what
    // somebody would type when they cannot remember the command's name.
    expect(rankSlashCommands(commands, 'pull request').map((c) => c.name)).toEqual(['review-pr'])
  })

  it('drops what does not match at all', () => {
    expect(rankSlashCommands(commands, 'deploy')).toEqual([])
  })

  it('breaks ties by the order it was given', () => {
    // All three match 'r' — the first two on their names, `issues` only through
    // "repo" in its description. So this asserts two things at once: the two
    // name hits keep their input order, and the weaker description hit sorts
    // below both rather than interleaving with them.
    const ranked = rankSlashCommands(commands, 'r')
    expect(ranked.map((c) => c.name)).toEqual(['review-pr', 'release-notes', 'issues'])
  })
})

describe('applySlashCommand', () => {
  const command: SlashCommand = {
    name: 'release-notes',
    description: '',
    template: 'Use the release-notes skill: ',
    kind: 'repo-skill'
  }

  it('replaces the typed token with the template', () => {
    expect(applySlashCommand('/rel', command)).toBe('Use the release-notes skill: ')
  })

  it('leaves a value the picker would not be open for alone', () => {
    // Defensive rather than reachable — but overwriting a half-written message
    // is not a mistake worth leaving available to a future caller.
    expect(applySlashCommand('what about src/a.ts', command)).toBe('what about src/a.ts')
  })

  it('ends with a space so the argument can be typed straight away', () => {
    expect(applySlashCommand('/', command).endsWith(' ')).toBe(true)
  })
})
