import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverRepoSkills,
  readRepoInstructions,
  REPO_INSTRUCTIONS_MAX_BYTES
} from './repo-instructions'

/**
 * Real directories, not a mocked fs. The claim this module makes is about what
 * is on disk in a repository somebody else wrote, and a mock would only prove
 * we agree with ourselves about the shape of it.
 *
 * No git init here: unlike the Codex live tests, nothing in this module needs a
 * working tree — it reads files by path.
 */

const scratch = mkdtempSync(join(tmpdir(), 'repo-instructions-'))
let repo: string

function write(relative: string, content: string): void {
  const target = join(repo, relative)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content)
}

beforeEach(() => {
  repo = mkdtempSync(join(scratch, 'repo-'))
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('readRepoInstructions', () => {
  it('returns null for a repo that ships none', () => {
    expect(readRepoInstructions(repo)).toBeNull()
  })

  it('reads CLAUDE.md and says which file it came from', () => {
    write('CLAUDE.md', 'Always use tabs.')
    const result = readRepoInstructions(repo)
    expect(result?.content).toBe('Always use tabs.')
    // The prompt frames the block with its origin, so a persona can weigh
    // repo-authored text against its own instructions rather than merging them.
    expect(result?.fileName).toBe('CLAUDE.md')
    expect(result?.path).toBe(join(repo, 'CLAUDE.md'))
    expect(result?.truncated).toBe(false)
  })

  it('falls back to AGENTS.md', () => {
    write('AGENTS.md', 'Run the tests first.')
    expect(readRepoInstructions(repo)?.fileName).toBe('AGENTS.md')
  })

  it('reads both when a repo ships both and they differ', () => {
    // First-hit-wins would silently drop whichever file lost, and a repo whose
    // two files disagree is exactly the repo whose second file matters.
    // Headers keep the origin of each half legible to the model.
    write('CLAUDE.md', 'From Claude.')
    write('AGENTS.md', 'From Agents.')
    const result = readRepoInstructions(repo)
    expect(result?.fileName).toBe('CLAUDE.md + AGENTS.md')
    expect(result?.content).toContain('## CLAUDE.md')
    expect(result?.content).toContain('From Claude.')
    expect(result?.content).toContain('## AGENTS.md')
    expect(result?.content).toContain('From Agents.')
  })

  it('reads identical twins once, named by the preferred file', () => {
    // The common case: one file for each tool's convention, same content.
    // Concatenating would double it in the context window for no gain.
    write('CLAUDE.md', 'Shared instructions.')
    write('AGENTS.md', 'Shared instructions.\n')
    const result = readRepoInstructions(repo)
    expect(result?.fileName).toBe('CLAUDE.md')
    expect(result?.content.match(/Shared instructions/g)).toHaveLength(1)
  })

  it('applies one shared cap to the combined text', () => {
    // The cap protects the persona's own prompt, which does not care how many
    // files the excess arrived in.
    write('CLAUDE.md', 'x'.repeat(20 * 1024))
    write('AGENTS.md', 'y'.repeat(20 * 1024))
    const result = readRepoInstructions(repo)
    expect(result?.truncated).toBe(true)
    expect(result?.content.length).toBeLessThan(40 * 1024)
    expect(result?.content).toContain('[Truncated: CLAUDE.md + AGENTS.md')
  })

  it('skips an empty file rather than injecting a blank section', () => {
    write('CLAUDE.md', '   \n\n')
    write('AGENTS.md', 'Real instructions.')
    expect(readRepoInstructions(repo)?.fileName).toBe('AGENTS.md')
  })

  it('caps a long file and says so in the text itself', () => {
    // Silent truncation is the failure worth guarding: a model handed the first
    // 32 KB of a longer document follows half a sentence and behaves as though
    // it read the whole thing. The notice is the difference between a cap and
    // a corruption.
    write('CLAUDE.md', 'x'.repeat(REPO_INSTRUCTIONS_MAX_BYTES + 5000))
    const result = readRepoInstructions(repo)

    expect(result?.truncated).toBe(true)
    expect(result?.content).toContain('Truncated')
    expect(result?.content).toContain('CLAUDE.md')
    expect(result!.content.length).toBeLessThan(REPO_INSTRUCTIONS_MAX_BYTES + 500)
  })

  it('leaves a file exactly at the cap alone', () => {
    write('CLAUDE.md', 'x'.repeat(REPO_INSTRUCTIONS_MAX_BYTES))
    const result = readRepoInstructions(repo)
    expect(result?.truncated).toBe(false)
    expect(result?.content).not.toContain('Truncated')
  })
})

describe('discoverRepoSkills', () => {
  it('finds nothing in a repo that ships nothing', () => {
    expect(discoverRepoSkills(repo)).toEqual([])
  })

  it('reads all three conventions and records which root each came from', () => {
    write('.claude/skills/review/SKILL.md', '---\nname: review\ndescription: Review code.\n---\n')
    write(
      '.codex/skills/release/SKILL.md',
      '---\nname: release\ndescription: Cut a release.\n---\n'
    )
    write('.agents/skills/style/SKILL.md', '---\nname: style\ndescription: House style.\n---\n')

    const skills = discoverRepoSkills(repo)
    expect(skills.map((s) => s.name)).toEqual(['release', 'review', 'style'])
    expect(skills.map((s) => s.root)).toEqual(['.codex/skills', '.claude/skills', '.agents/skills'])
    expect(skills.find((s) => s.name === 'review')?.description).toBe('Review code.')
  })

  it('marks which ones Codex would find by itself', () => {
    // The asymmetry that decides delivery: Codex scans .codex and .agents and
    // is blind to .claude, so a .claude skill can only ever be injected.
    write('.claude/skills/review/SKILL.md', '---\nname: review\n---\n')
    write('.codex/skills/release/SKILL.md', '---\nname: release\n---\n')

    const byName = new Map(discoverRepoSkills(repo).map((s) => [s.name, s]))
    expect(byName.get('review')?.codexNative).toBe(false)
    expect(byName.get('release')?.codexNative).toBe(true)
  })

  it('ignores a directory with no SKILL.md in it', () => {
    mkdirSync(join(repo, '.claude/skills/notaskill'), { recursive: true })
    write('.claude/skills/notaskill/README.md', 'nothing here')
    expect(discoverRepoSkills(repo)).toEqual([])
  })

  it('ignores dotted directories', () => {
    write('.codex/skills/.system/SKILL.md', '---\nname: system\n---\n')
    expect(discoverRepoSkills(repo)).toEqual([])
  })

  it('never reaches outside the working path', () => {
    // The distinction from discoverCodexSkills(), which deliberately also
    // enumerates $CODEX_HOME because it builds the *seal* list. This builds the
    // *offer* list, shown under a heading reading "what this repository asks
    // for" — the user's own machine-global skills do not belong there.
    const home = mkdtempSync(join(scratch, 'codex-home-'))
    mkdirSync(join(home, 'skills', 'personal'), { recursive: true })
    writeFileSync(join(home, 'skills', 'personal', 'SKILL.md'), '---\nname: personal\n---\n')

    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    try {
      expect(discoverRepoSkills(repo)).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  })

  it('offers one checkbox when a repo ships the same skill twice', () => {
    write('.codex/skills/dup/SKILL.md', '---\nname: dup\ndescription: From codex.\n---\n')
    write('.claude/skills/dup/SKILL.md', '---\nname: dup\ndescription: From claude.\n---\n')

    const skills = discoverRepoSkills(repo)
    expect(skills).toHaveLength(1)
    // The Codex-native one wins, so approving it gets the better mechanism.
    expect(skills[0].root).toBe('.codex/skills')
    expect(skills[0].codexNative).toBe(true)
  })
})

describe('frontmatter that is not what we hoped', () => {
  it('keeps a skill with no frontmatter at all', () => {
    // The directory name and the file on disk are what make a skill usable.
    // Frontmatter affects neither, so bad frontmatter must not remove it —
    // silently dropping a skill the user approved is worse than a blank
    // description.
    write('.claude/skills/plain/SKILL.md', '# Plain\n\nJust prose.')
    const skills = discoverRepoSkills(repo)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('plain')
    expect(skills[0].description).toBe('')
  })

  it('does not throw on an unterminated frontmatter block', () => {
    write('.claude/skills/broken/SKILL.md', '---\nname: broken\ndescription: Never closed.')
    expect(() => discoverRepoSkills(repo)).not.toThrow()
    expect(discoverRepoSkills(repo)[0].description).toBe('Never closed.')
  })

  it('strips one layer of quoting', () => {
    write('.claude/skills/quoted/SKILL.md', '---\ndescription: "Quoted, with a comma."\n---\n')
    expect(discoverRepoSkills(repo)[0].description).toBe('Quoted, with a comma.')
  })

  it('ignores a description outside the frontmatter block', () => {
    write('.claude/skills/late/SKILL.md', '---\nname: late\n---\n\ndescription: too late\n')
    expect(discoverRepoSkills(repo)[0].description).toBe('')
  })
})
