import { describe, expect, it } from 'vitest'
import type { GroupMessage, PersonaTemplate, Skill } from '../../shared/domain'
import { composeInstructions, orderSkills } from './context'
import type { SessionSpec, SiblingBranch } from './types'

function skill(id: string, name: string, content: string): Skill {
  return { id, name, description: '', content }
}

function persona(skillIds: string[], systemPrompt = 'You review code.'): PersonaTemplate {
  return {
    id: 'p1',
    name: 'Reviewer',
    avatarColor: '#000',
    backend: 'claude',
    model: null,
    systemPrompt,
    skillIds,
    sandbox: 'read_only',
    githubScope: 'read_only'
  }
}

function spec(p: PersonaTemplate, skills: Skill[]): SessionSpec {
  return { persona: p, repoPath: '/tmp/repo', skills }
}

describe('orderSkills', () => {
  it('follows skillIds order, not the order the caller loaded them in', () => {
    const skills = [skill('b', 'B', 'bee'), skill('a', 'A', 'ay')]
    expect(orderSkills(['a', 'b'], skills).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('drops ids with no matching skill instead of producing holes', () => {
    // A persona can reference a skill that was deleted — Phase 4 strips the id
    // on delete, but a stale spec must not become `undefined` in the prompt.
    const skills = [skill('a', 'A', 'ay')]
    expect(orderSkills(['a', 'gone'], skills).map((s) => s.id)).toEqual(['a'])
  })
})

describe('composeInstructions', () => {
  it('returns just the system prompt when no skills are attached', () => {
    expect(composeInstructions(spec(persona([]), []))).toBe('You review code.')
  })

  it('appends each skill under a heading', () => {
    const result = composeInstructions(
      spec(persona(['a', 'b']), [skill('a', 'Style', 'Use tabs.'), skill('b', 'Tests', 'Test it.')])
    )
    expect(result).toContain('You review code.')
    expect(result).toContain('## Skills')
    expect(result).toContain('### Style\n\nUse tabs.')
    expect(result).toContain('### Tests\n\nTest it.')
    expect(result.indexOf('### Style')).toBeLessThan(result.indexOf('### Tests'))
  })

  it('is stable across calls, so the cached prefix stays cached', () => {
    const a = composeInstructions(spec(persona(['a']), [skill('a', 'S', 'x')]))
    const b = composeInstructions(spec(persona(['a']), [skill('a', 'S', 'x')]))
    expect(a).toBe(b)
  })

  it('ignores skills the persona does not reference', () => {
    const result = composeInstructions(spec(persona([]), [skill('a', 'Unused', 'nope')]))
    expect(result).not.toContain('Unused')
  })

  it('trims so an empty system prompt does not leave leading blank lines', () => {
    const result = composeInstructions(spec(persona(['a'], '  '), [skill('a', 'S', 'x')]))
    expect(result.startsWith('## Skills')).toBe(true)
  })

  it('gives both backends byte-identical text', () => {
    // The whole reason this lives in one shared module: Claude passes it as
    // `systemPrompt` and Codex as `developer_instructions`, and the two must
    // not be able to drift.
    const claude = persona(['a'])
    const codex: PersonaTemplate = { ...claude, backend: 'codex' }
    const skills = [skill('a', 'S', 'x')]
    expect(composeInstructions(spec(claude, skills))).toBe(composeInstructions(spec(codex, skills)))
  })
})

describe('group context injection', () => {
  function entry(overrides: Partial<GroupMessage> = {}): GroupMessage {
    return {
      id: 'gm-1',
      groupId: 'g1',
      timestamp: Date.parse('2026-08-15T09:00:00Z'),
      type: 'system_summary',
      content: 'Moved the token read into a module-level cache.',
      category: 'decision',
      durable: true,
      ...overrides
    }
  }

  function withContext(groupContext: GroupMessage[]): string {
    return composeInstructions({ ...spec(persona([]), []), groupContext })
  }

  it('adds nothing at all when the repo has no history', () => {
    // A fresh repo must not carry an empty heading into every prompt.
    expect(composeInstructions(spec(persona([]), []))).toBe('You review code.')
    expect(withContext([])).toBe('You review code.')
  })

  it('injects the summary text', () => {
    expect(withContext([entry()])).toContain('Moved the token read into a module-level cache.')
  })

  it('frames the block as history rather than instructions', () => {
    // Without this personas act on the entries — a reviewer "carrying out" a
    // decision another persona already implemented.
    expect(withContext([entry()])).toContain('not instructions to you')
  })

  it('comes after the skills, keeping the persona prefix stable', () => {
    // Prompt caching is a prefix match: a new summary must not invalidate the
    // persona and its skills.
    const composed = composeInstructions({
      ...spec(persona(['a']), [skill('a', 'A', 'ay')]),
      groupContext: [entry()]
    })
    expect(composed.indexOf('## Skills')).toBeLessThan(
      composed.indexOf('## Recent activity on this repository')
    )
  })

  it('names the branch when a summary reported one', () => {
    // The whole point of carrying branch metadata: work on a branch nobody can
    // see on disk is invisible without it (docs/plan/12-worktree-isolation.md).
    expect(withContext([entry({ branch: 'persona/refactor-buddy' })])).toContain(
      'persona/refactor-buddy'
    )
  })

  it('omits the branch clause entirely when there is none', () => {
    expect(withContext([entry()])).not.toContain('on branch')
  })

  it('labels a routine entry as a note rather than as a category', () => {
    expect(withContext([entry({ category: 'routine', durable: false })])).toContain('**note**')
  })

  it('preserves the order it was given', () => {
    const composed = withContext([
      entry({ id: 'a', content: 'older' }),
      entry({ id: 'b', content: 'newer' })
    ])
    expect(composed.indexOf('older')).toBeLessThan(composed.indexOf('newer'))
  })
})

describe('sibling branches', () => {
  function withSiblings(siblingBranches: SiblingBranch[]): string {
    return composeInstructions({ ...spec(persona([]), []), siblingBranches })
  }

  const buddy: SiblingBranch = {
    branch: 'persona/refactor-buddy-a3f9',
    contactName: 'Refactor Buddy · my-app',
    headSha: '9c2a05c1df58ab5960bd708f63c3e98f273e8335'
  }

  it('is absent when nothing else is in flight', () => {
    expect(composeInstructions(spec(persona([]), []))).not.toContain('other branches')
  })

  it('names the branch and whose it is', () => {
    const composed = withSiblings([buddy])
    expect(composed).toContain('persona/refactor-buddy-a3f9')
    expect(composed).toContain('Refactor Buddy · my-app')
  })

  it('abbreviates the head rather than printing forty characters', () => {
    expect(withSiblings([buddy])).toContain('9c2a05c')
    expect(withSiblings([buddy])).not.toContain(buddy.headSha)
  })

  it('omits the head annotation when the ref could not be read', () => {
    expect(withSiblings([{ ...buddy, headSha: null }])).toContain('persona/refactor-buddy-a3f9')
  })

  // This block exists to rescue blueprint §6, whose "filesystem state is free"
  // stops being true the moment a writer has its own checkout. The rescue is
  // that the object store is still shared — so the block has to say that the
  // work is readable without merging, or the model has no reason to look.
  it('says the work is readable without merging anything', () => {
    const composed = withSiblings([buddy])
    expect(composed).toMatch(/without merging/i)
    expect(composed).toContain('git show <branch>:<path>')
    expect(composed).toContain('git diff <base>...<branch>')
  })

  it('tells the persona not to merge or check them out itself', () => {
    // Layer 3 is human by design: integrating somebody else's branch is a
    // decision, and a persona that merges on its own has made it for them.
    expect(withSiblings([buddy])).toMatch(/do not merge or check out/i)
  })

  // The stable prefix is what keeps prompt caching working; a volatile block in
  // front of the skills would invalidate the cache every time a colleague ran.
  it('comes after the persona and its skills', () => {
    const composed = composeInstructions({
      ...spec(persona(['s1']), [skill('s1', 'Checklist', 'Be thorough.')]),
      siblingBranches: [buddy]
    })

    expect(composed.indexOf('Be thorough.')).toBeLessThan(
      composed.indexOf('persona/refactor-buddy')
    )
  })
})

describe('working context', () => {
  const working = {
    workingPath:
      '/Users/dev/Library/Application Support/persona-router/worktrees/my-app/buddy-a3f9',
    repoPath: '/Users/dev/code/my-app',
    branch: 'persona/buddy-a3f9'
  }

  it('is absent when the session runs in its own repo', () => {
    expect(composeInstructions(spec(persona([]), []))).not.toContain('Where you are working')
  })

  it('names the working directory, the repo and the branch', () => {
    const composed = composeInstructions({
      ...spec(persona([]), []),
      workingContext: working
    })

    expect(composed).toContain(working.workingPath)
    expect(composed).toContain(working.repoPath)
    expect(composed).toContain(working.branch)
  })

  // Not decoration. A worktree session is granted write access to the repo's
  // `.git/worktrees/<name>` so git can lock its index, and a model asked to
  // create a file with a bare relative name resolved it against *that*
  // directory — observed live on two concurrent writers, both refused. Saying
  // where the work goes is what removed the ambiguity.
  it('tells the session to keep out of .git', () => {
    const composed = composeInstructions({
      ...spec(persona([]), []),
      workingContext: working
    })

    expect(composed).toMatch(/never write inside `\.git`/i)
  })

  // Ahead of the volatile blocks and behind the persona, so the cached prefix
  // keeps growing rather than being invalidated by a colleague's summary.
  it('comes before the group context', () => {
    const composed = composeInstructions({
      ...spec(persona([]), []),
      workingContext: working,
      groupContext: [
        {
          id: 'gm1',
          groupId: 'g1',
          timestamp: 1_700_000_000_000,
          type: 'system_summary',
          content: 'a colleague decided something',
          category: 'decision',
          durable: true
        }
      ]
    })

    expect(composed.indexOf(working.branch)).toBeLessThan(
      composed.indexOf('a colleague decided something')
    )
  })
})
