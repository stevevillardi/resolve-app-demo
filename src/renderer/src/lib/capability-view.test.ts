import { describe, expect, it } from 'vitest'
import {
  builtInNote,
  mcpReach,
  mcpServerChoices,
  repoSkillChoices,
  setInstructionsTrust,
  toggleMcpServer,
  toggleSkillTrust
} from './capability-view'
import type { RepoOffers } from '../../../shared/ipc-contract'

const CLOSED = { instructions: false, skills: [] }

function offers(
  skills: { name: string; description?: string; root?: string; codexNative?: boolean }[]
): RepoOffers {
  return {
    instructionsFile: 'CLAUDE.md',
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description ?? '',
      root: skill.root ?? '.claude/skills',
      codexNative: skill.codexNative ?? false
    }))
  }
}

describe('repoSkillChoices', () => {
  it('offers what is on disk, unticked, before anything is approved', () => {
    const choices = repoSkillChoices(offers([{ name: 'release-notes' }]), CLOSED)
    expect(choices).toHaveLength(1)
    expect(choices[0].approved).toBe(false)
  })

  it('ticks the ones in the trust record', () => {
    const choices = repoSkillChoices(offers([{ name: 'a' }, { name: 'b' }]), {
      instructions: false,
      skills: ['b']
    })

    expect(choices.find((c) => c.name === 'a')?.approved).toBe(false)
    expect(choices.find((c) => c.name === 'b')?.approved).toBe(true)
  })

  it('keeps showing an approval whose file has gone', () => {
    // A stored approval with nothing behind it does nothing, and dropping it
    // from the list would leave the user believing they granted something they
    // did not. It has to be visible to be clearable.
    const choices = repoSkillChoices(offers([{ name: 'release-notes' }]), {
      instructions: false,
      skills: ['release-notes', 'deleted-one']
    })

    const gone = choices.find((c) => c.name === 'deleted-one')
    expect(gone?.missing).toBe(true)
    expect(gone?.approved).toBe(true)
  })

  it('says how each approved skill would actually reach the model', () => {
    // Not cosmetic. A described skill costs prompt space on every turn and can
    // only be read as a file; a discovered one is invoked as a skill.
    const choices = repoSkillChoices(
      offers([
        { name: 'native', root: '.codex/skills', codexNative: true },
        { name: 'injected', root: '.claude/skills', codexNative: false }
      ]),
      CLOSED
    )

    expect(choices.find((c) => c.name === 'native')?.delivery).toBe('discovered')
    expect(choices.find((c) => c.name === 'injected')?.delivery).toBe('described')
  })

  it('shows nothing for a repo that ships nothing', () => {
    expect(repoSkillChoices(offers([]), CLOSED)).toEqual([])
  })

  it('survives the offers not having loaded yet', () => {
    expect(repoSkillChoices(null, CLOSED)).toEqual([])
  })
})

describe('toggleSkillTrust', () => {
  it('grants and revokes the named skill', () => {
    const granted = toggleSkillTrust(CLOSED, 'release-notes')
    expect(granted.skills).toEqual(['release-notes'])
    expect(toggleSkillTrust(granted, 'release-notes').skills).toEqual([])
  })

  it('leaves the instructions grant alone', () => {
    // Two different decisions. Trusting a repo's CLAUDE.md is not the same as
    // letting it hand the model executable skills, and ticking one must never
    // move the other.
    const trust = { instructions: true, skills: [] }
    expect(toggleSkillTrust(trust, 'release-notes').instructions).toBe(true)
  })

  it('stores names in a stable order regardless of click order', () => {
    const oneWay = toggleSkillTrust(toggleSkillTrust(CLOSED, 'b'), 'a')
    const other = toggleSkillTrust(toggleSkillTrust(CLOSED, 'a'), 'b')
    expect(oneWay.skills).toEqual(other.skills)
  })

  it('does not mutate what it was given', () => {
    const trust = { instructions: false, skills: ['a'] }
    toggleSkillTrust(trust, 'b')
    expect(trust.skills).toEqual(['a'])
  })
})

describe('setInstructionsTrust', () => {
  it('leaves approved skills alone', () => {
    const trust = { instructions: false, skills: ['release-notes'] }
    expect(setInstructionsTrust(trust, true)).toEqual({
      instructions: true,
      skills: ['release-notes']
    })
  })
})

describe('mcpReach', () => {
  it('is none until a server is granted', () => {
    expect(mcpReach([])).toBe('none')
  })

  it('is github once one is', () => {
    expect(mcpReach(['github'])).toBe('github')
  })
})

describe('mcpServerChoices', () => {
  it('lists the whole registry, marking what is granted', () => {
    // The list is what the app knows how to run, not what this persona holds —
    // a checklist that only showed granted servers could never grant one.
    const choices = mcpServerChoices([])
    expect(choices.length).toBeGreaterThan(0)
    expect(choices.every((choice) => !choice.granted)).toBe(true)
    expect(mcpServerChoices(['github']).find((c) => c.id === 'github')?.granted).toBe(true)
  })

  it('says what actually governs each server', () => {
    // Ticking the box grants nothing the persona's GitHub scope does not
    // already allow, and the editor has to say so or the checkbox reads as the
    // whole decision.
    expect(mcpServerChoices([]).find((c) => c.id === 'github')?.governedBy).toBe('GitHub scope')
  })
})

describe('toggleMcpServer', () => {
  it('grants and revokes', () => {
    expect(toggleMcpServer([], 'github')).toEqual(['github'])
    expect(toggleMcpServer(['github'], 'github')).toEqual([])
  })

  it('does not mutate what it was given', () => {
    const ids = ['github']
    toggleMcpServer(ids, 'github')
    expect(ids).toEqual(['github'])
  })
})

describe('built-in disclosure', () => {
  it('names what each backend brings that cannot be turned off', () => {
    // Every other capability on the panel is something a human granted. Leaving
    // these out would make it a list of *some* of what a session can do while
    // reading as a list of all of it.
    expect(builtInNote('claude')).toContain('16')
    expect(builtInNote('claude')).toContain('cannot be turned off')
    expect(builtInNote('codex')).toContain('5')
  })
})
