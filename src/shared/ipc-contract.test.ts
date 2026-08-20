import { describe, expect, it } from 'vitest'
import { ipcContract, deviceFlowStateSchema } from './ipc-contract'

/**
 * The contract is the one artifact both processes compile against, so a
 * malformed entry breaks the boundary in a way types alone won't catch —
 * registerProcedure parses `.input` and `.output` at runtime, and a missing
 * schema would only surface on the first real invoke.
 */

describe('contract shape', () => {
  it('gives every procedure both an input and an output schema', () => {
    for (const [name, entry] of Object.entries(ipcContract)) {
      expect(entry.input, `${name}.input`).toBeDefined()
      expect(entry.output, `${name}.output`).toBeDefined()
      expect(typeof entry.input.parse, `${name}.input.parse`).toBe('function')
      expect(typeof entry.output.parse, `${name}.output.parse`).toBe('function')
    }
  })

  it('registers every procedure the UI depends on', () => {
    // Guards against a rename landing in main but not in the renderer.
    expect(Object.keys(ipcContract)).toEqual(
      expect.arrayContaining([
        'auth.getStatus',
        'auth.setAnthropicApiKey',
        'auth.setOpenAiApiKey',
        'auth.completeOnboarding',
        'codex.startLogin',
        'codex.getLoginState',
        'codex.cancelLogin',
        'github.startDeviceFlow',
        'github.getDeviceFlowState',
        'github.cancelDeviceFlow',
        'github.disconnect',
        'shell.openExternal',
        // Data layer
        'skills.list',
        'skills.get',
        'skills.create',
        'skills.update',
        'skills.delete',
        'personas.list',
        'personas.get',
        'personas.create',
        'personas.update',
        'personas.delete',
        'contacts.list',
        'contacts.get',
        'contacts.create',
        'groups.list',
        // Messaging, runs and spend
        'messages.list',
        'messages.previews',
        'messages.send',
        'messages.cancel',
        'runs.list',
        'usage.list',
        'models.listForBackend',
        // Group coordination
        'groups.getForRepo',
        'groupMessages.list',
        'groupMessages.previews',
        'groups.mention',
        // Worktree isolation and its branches
        'contacts.delete',
        'branches.list',
        'branches.targets',
        'branches.preview',
        'branches.merge',
        'branches.discard',
        // Repo trust
        'contacts.setRepoTrust',
        'contacts.repoOffers',
        // Audit trail
        'audit.list'
      ])
    )
  })
})

describe('repo trust', () => {
  it('is its own procedure, not a field on the contact update', () => {
    // Renaming a contact and granting its repository the right to instruct it
    // are different decisions. Keeping them apart at the Zod boundary is what
    // stops the second happening as a side effect of the first.
    const update = ipcContract['contacts.update'].input
    expect(() => update.parse({ id: 'c1', displayName: 'Reviewer' })).not.toThrow()

    const parsed = update.parse({
      id: 'c1',
      displayName: 'Reviewer',
      trust: { instructions: true, skills: [] }
    }) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('trust')
  })

  it('takes an allowlist of names rather than a boolean', () => {
    // A human approves the skills that were there when they looked. "Trust this
    // repo's skills" would silently extend to one committed tomorrow.
    const input = ipcContract['contacts.setRepoTrust'].input
    expect(() =>
      input.parse({ id: 'c1', trust: { instructions: false, skills: ['release-notes'] } })
    ).not.toThrow()
    expect(() => input.parse({ id: 'c1', trust: { instructions: true, skills: true } })).toThrow()
  })

  it('lets the offers list be null for a contact that is gone', () => {
    expect(() => ipcContract['contacts.repoOffers'].output.parse(null)).not.toThrow()
  })
})

describe('data-layer procedures', () => {
  it('rejects a create that supplies its own id', () => {
    // Ids are minted in main; the draft schemas are what enforce that at the
    // boundary rather than leaving it to each handler to remember.
    const withId = { id: 'attacker-chosen', name: 'Style', description: '', content: '' }
    const parsed = ipcContract['skills.create'].input.parse(withId)
    expect('id' in parsed).toBe(false)
  })

  it('requires an id on update', () => {
    expect(() =>
      ipcContract['skills.update'].input.parse({ name: 'Style', description: '', content: '' })
    ).toThrow()
  })

  it('allows get to answer null for a missing row', () => {
    expect(() => ipcContract['skills.get'].output.parse(null)).not.toThrow()
    expect(() => ipcContract['personas.get'].output.parse(null)).not.toThrow()
    expect(() => ipcContract['contacts.get'].output.parse(null)).not.toThrow()
  })

  it('rejects a persona list containing an invalid backend', () => {
    expect(() =>
      ipcContract['personas.list'].output.parse([
        {
          id: 'p1',
          name: 'X',
          avatarColor: '#000',
          backend: 'cursor',
          systemPrompt: '',
          skillIds: [],
          sandbox: 'read_only',
          githubScope: 'read_only'
        }
      ])
    ).toThrow()
  })

  it('has no groups.create — a group is implied by its repo', () => {
    expect(Object.keys(ipcContract)).not.toContain('groups.create')
  })
})

describe('auth.getStatus output', () => {
  const valid = {
    claude: { authenticated: true, source: 'cli' },
    codex: { authenticated: false, source: null },
    github: { connected: false, configured: true },
    onboardingCompleted: false,
    secretStorageAvailable: true
  }

  it('accepts a fully populated status', () => {
    expect(() => ipcContract['auth.getStatus'].output.parse(valid)).not.toThrow()
  })

  it('requires source to be explicitly null rather than omitted', () => {
    // Distinguishes "not authenticated" from "authenticated, source unknown".
    expect(() =>
      ipcContract['auth.getStatus'].output.parse({
        ...valid,
        claude: { authenticated: valid.claude.authenticated }
      })
    ).toThrow()
  })

  it('rejects an unknown auth source', () => {
    expect(() =>
      ipcContract['auth.getStatus'].output.parse({
        ...valid,
        claude: { authenticated: true, source: 'telepathy' }
      })
    ).toThrow()
  })

  it('rejects a missing backend', () => {
    expect(() =>
      ipcContract['auth.getStatus'].output.parse({
        claude: valid.claude,
        codex: valid.codex,
        onboardingCompleted: valid.onboardingCompleted,
        secretStorageAvailable: valid.secretStorageAvailable
      })
    ).toThrow()
  })
})

describe('api key input', () => {
  it.each(['auth.setAnthropicApiKey', 'auth.setOpenAiApiKey'] as const)(
    '%s rejects an empty key',
    (procedure) => {
      expect(() => ipcContract[procedure].input.parse({ apiKey: '' })).toThrow()
      expect(() => ipcContract[procedure].input.parse({})).toThrow()
      expect(() => ipcContract[procedure].input.parse({ apiKey: 'sk-x' })).not.toThrow()
    }
  )
})

describe('deviceFlowState', () => {
  it('accepts the bare idle state', () => {
    expect(() => deviceFlowStateSchema.parse({ status: 'idle' })).not.toThrow()
  })

  it('accepts a fully populated awaiting state', () => {
    expect(() =>
      deviceFlowStateSchema.parse({
        status: 'awaiting_authorization',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresAt: 1_700_000_000_000
      })
    ).not.toThrow()
  })

  it('covers every status both providers can report', () => {
    for (const status of ['idle', 'starting', 'awaiting_authorization', 'success', 'error']) {
      expect(() => deviceFlowStateSchema.parse({ status })).not.toThrow()
    }
  })

  it('rejects an unknown status', () => {
    expect(() => deviceFlowStateSchema.parse({ status: 'polling' })).toThrow()
  })
})

describe('shell.openExternal input', () => {
  it('rejects anything that is not a URL', () => {
    expect(() => ipcContract['shell.openExternal'].input.parse({ url: 'not a url' })).toThrow()
  })

  it('accepts a well-formed URL', () => {
    expect(() =>
      ipcContract['shell.openExternal'].input.parse({ url: 'https://github.com/login/device' })
    ).not.toThrow()
  })
})

describe('audit.list', () => {
  it('accepts no input at all', () => {
    expect(() => ipcContract['audit.list'].input.parse(undefined)).not.toThrow()
  })

  it('accepts each optional filter individually', () => {
    expect(() => ipcContract['audit.list'].input.parse({ contactId: 'c1' })).not.toThrow()
    expect(() => ipcContract['audit.list'].input.parse({ repoPath: '~/code/app' })).not.toThrow()
  })

  it('validates a real audit event row', () => {
    expect(() =>
      ipcContract['audit.list'].output.parse([
        {
          id: 'a1',
          createdAt: 1_700_000_000_000,
          action: 'contact_repo_trust_changed',
          actorKind: 'user',
          contactId: 'c1',
          repoPath: '~/code/app',
          summary: 'Changed repo trust for Reviewer'
        }
      ])
    ).not.toThrow()
  })

  it('rejects an unknown action', () => {
    expect(() =>
      ipcContract['audit.list'].output.parse([
        {
          id: 'a1',
          createdAt: 1_700_000_000_000,
          action: 'contact_teleported',
          actorKind: 'user',
          contactId: null,
          repoPath: '~/code/app',
          summary: 'nonsense'
        }
      ])
    ).toThrow()
  })
})
