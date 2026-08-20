import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'

/**
 * Claude auth detection. The SDK is faked — a real probe spawns the bundled
 * Claude Code CLI — so what's under test is the mapping from AccountInfo onto
 * our status shape, the caching, and the failure handling.
 *
 * Confirmed against the real SDK: accountInfo() resolves without consuming a
 * turn, which is why detection is free enough to run at launch.
 */

let accountInfoImpl: () => Promise<AccountInfo>
let closeCalls = 0
let queryOptions: Record<string, unknown> | undefined

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    queryOptions = options
    return {
      accountInfo: () => accountInfoImpl(),
      close: () => {
        closeCalls++
      }
    }
  }
}))

const secretStore = new Map<string, string>()
let encryptionAvailable = true

/**
 * Captures what `resolveClaudeBinary` asks for, so the package naming can be
 * asserted without a packaged app on disk. The search itself — and the asar
 * rule that is the actual bug guard — belongs to `vendored-binaries.test.ts`.
 */
let requested: string[] = []
vi.mock('./vendored-binaries', () => ({
  resolveVendored: (relative: string) => {
    requested.push(relative)
    return relative.includes('darwin-arm64') ? `/unpacked/${relative}` : null
  }
}))

vi.mock('./secrets', () => ({
  getSecret: (k: string) => secretStore.get(k) ?? null,
  setSecret: (k: string, v: string) => void secretStore.set(k, v),
  deleteSecret: (k: string) => void secretStore.delete(k),
  isSecretStorageAvailable: () => encryptionAvailable
}))

type ClaudeModule = typeof import('./claude-auth')
let claude: ClaudeModule

beforeEach(async () => {
  secretStore.clear()
  requested = []
  closeCalls = 0
  queryOptions = undefined
  encryptionAvailable = true
  accountInfoImpl = async () => ({})
  vi.stubEnv('MAIN_VITE_ANTHROPIC_API_KEY', '')
  // The status is cached for the process lifetime, so each test needs its own
  // module instance rather than a shared one.
  vi.resetModules()
  claude = await import('./claude-auth')
})

describe('detecting existing CLI auth', () => {
  it('maps an OAuth login to the cli source with account details', async () => {
    accountInfoImpl = async () => ({
      email: 'steve@villardi.io',
      organization: "steve@villardi.io's Organization",
      subscriptionType: 'Claude Pro',
      apiKeySource: 'oauth',
      apiProvider: 'firstParty'
    })

    expect(await claude.getClaudeAuthStatus()).toEqual({
      authenticated: true,
      source: 'cli',
      email: 'steve@villardi.io',
      organization: "steve@villardi.io's Organization",
      subscriptionType: 'Claude Pro'
    })
  })

  it('treats an empty AccountInfo as not authenticated', async () => {
    accountInfoImpl = async () => ({})
    expect(await claude.getClaudeAuthStatus()).toEqual({ authenticated: false, source: null })
  })

  it('counts a third-party provider as authenticated despite having no email', async () => {
    // Bedrock/Vertex authenticate externally via AWS creds or gcloud ADC and
    // report none of the first-party fields, but are perfectly usable.
    accountInfoImpl = async () => ({ apiProvider: 'bedrock' })
    expect(await claude.getClaudeAuthStatus()).toMatchObject({ authenticated: true })
  })

  it('always tears down the probe session', async () => {
    accountInfoImpl = async () => ({ email: 'x@y.z' })
    await claude.getClaudeAuthStatus()
    expect(closeCalls).toBe(1)
  })

  it('tears down the session even when the probe throws', async () => {
    // Otherwise a failed check leaks a CLI subprocess on every launch.
    accountInfoImpl = async () => {
      throw new Error('boom')
    }
    await claude.getClaudeAuthStatus()
    expect(closeCalls).toBe(1)
  })
})

describe('subprocess environment', () => {
  it('spreads process.env rather than replacing it', async () => {
    // options.env REPLACES the subprocess environment; dropping process.env
    // would strip PATH and HOME and break the CLI entirely.
    await claude.getClaudeAuthStatus()
    expect((queryOptions?.env as Record<string, string>).PATH).toBe(process.env.PATH)
  })

  it('injects a stored API key', async () => {
    secretStore.set('anthropic_api_key', 'sk-ant-stored')
    await claude.getClaudeAuthStatus()
    expect((queryOptions?.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('sk-ant-stored')
  })

  it('prefers the keychain over the dev-only env escape hatch', async () => {
    vi.stubEnv('MAIN_VITE_ANTHROPIC_API_KEY', 'sk-ant-from-dotenv')
    secretStore.set('anthropic_api_key', 'sk-ant-from-keychain')
    await claude.getClaudeAuthStatus()
    expect((queryOptions?.env as Record<string, string>).ANTHROPIC_API_KEY).toBe(
      'sk-ant-from-keychain'
    )
  })
})

describe('caching', () => {
  it('probes once and reuses the result', async () => {
    accountInfoImpl = async () => ({ email: 'x@y.z' })
    await claude.getClaudeAuthStatus()
    await claude.getClaudeAuthStatus()
    // Spawning the CLI on every status read would make the app crawl.
    expect(closeCalls).toBe(1)
  })

  it('re-probes when explicitly refreshed', async () => {
    accountInfoImpl = async () => ({ email: 'x@y.z' })
    await claude.getClaudeAuthStatus()
    await claude.getClaudeAuthStatus(true)
    expect(closeCalls).toBe(2)
  })
})

describe('failure handling', () => {
  it('distinguishes a failed probe from being logged out', async () => {
    // Telling a user to re-enter a key that was never the problem is worse
    // than saying detection failed.
    accountInfoImpl = async () => {
      throw new Error('CLI unavailable')
    }
    expect(await claude.getClaudeAuthStatus()).toMatchObject({
      authenticated: false,
      error: 'CLI unavailable'
    })
  })

  it('still reports authenticated on probe failure when a key is stored', async () => {
    secretStore.set('anthropic_api_key', 'sk-ant-x')
    accountInfoImpl = async () => {
      throw new Error('network down')
    }
    expect(await claude.getClaudeAuthStatus()).toMatchObject({
      authenticated: true,
      source: 'api_key'
    })
  })
})

describe('setAnthropicApiKey', () => {
  it('stores the trimmed key and re-probes', async () => {
    accountInfoImpl = async () => ({ email: 'x@y.z', apiKeySource: 'user' })
    const status = await claude.setAnthropicApiKey('  sk-ant-new  ')

    expect(secretStore.get('anthropic_api_key')).toBe('sk-ant-new')
    expect(status).toMatchObject({ authenticated: true, source: 'api_key' })
  })

  it('invalidates the cached status', async () => {
    accountInfoImpl = async () => ({})
    expect(await claude.getClaudeAuthStatus()).toMatchObject({ authenticated: false })

    accountInfoImpl = async () => ({ email: 'x@y.z', apiKeySource: 'user' })
    await claude.setAnthropicApiKey('sk-ant-new')
    expect(await claude.getClaudeAuthStatus()).toMatchObject({ authenticated: true })
  })

  it('refuses to store when the OS keychain is unavailable', async () => {
    encryptionAvailable = false
    const status = await claude.setAnthropicApiKey('sk-ant-x')

    expect(status).toMatchObject({ authenticated: false })
    expect(status.error).toMatch(/secret storage/i)
    expect(secretStore.has('anthropic_api_key')).toBe(false)
  })
})

describe('clearAnthropicApiKey', () => {
  it('removes the stored key and re-probes past the cache', async () => {
    secretStore.set('anthropic_api_key', 'sk-ant-stored')
    accountInfoImpl = async () => ({ email: 'x@y.z' })
    await claude.getClaudeAuthStatus()

    accountInfoImpl = async () => ({})
    const status = await claude.clearAnthropicApiKey()

    expect(secretStore.has('anthropic_api_key')).toBe(false)
    // Cached "authenticated" must not survive the clear — the whole point of
    // the button is that the status tells the truth afterwards.
    expect(status.authenticated).toBe(false)
  })

  it('leaves a CLI login reported as authenticated', async () => {
    // The key is ours to remove; the Claude Code browser login is not.
    accountInfoImpl = async () => ({ email: 'cli@user.dev', apiKeySource: 'oauth' })
    const status = await claude.clearAnthropicApiKey()
    expect(status).toMatchObject({ authenticated: true, source: 'cli' })
  })
})

/**
 * Which package the vendored `claude` executable is expected in.
 *
 * Mirrors the SDK's own resolution, read out of its bundled source rather than
 * guessed: `claude-agent-sdk-<platform>-<arch>` with the binary at the package
 * root, musl preferred on linux, and `.exe` on Windows. Codex differs on every
 * one of those points — it nests under `vendor/<triple>/bin/` — which is
 * exactly why the two resolvers are separate and why copying one to make the
 * other would have been wrong.
 */
describe('resolveClaudeBinary', () => {
  const on = (platform: NodeJS.Platform, arch: string): void => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    vi.spyOn(process, 'arch', 'get').mockReturnValue(arch as NodeJS.Architecture)
  }

  afterEach(() => vi.restoreAllMocks())

  it('asks for the platform package with the binary at its root', () => {
    on('darwin', 'arm64')
    expect(claude.resolveClaudeBinary()).toBe(
      '/unpacked/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'
    )
    expect(requested).toEqual(['@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'])
  })

  // Two packages ship for linux and only one is installed, so both spellings
  // are tried — musl first, matching the SDK.
  it('prefers musl on linux and falls back to glibc', () => {
    on('linux', 'x64')
    expect(claude.resolveClaudeBinary()).toBeNull()
    expect(requested).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
      '@anthropic-ai/claude-agent-sdk-linux-x64/claude'
    ])
  })

  it('asks for claude.exe on Windows', () => {
    on('win32', 'x64')
    claude.resolveClaudeBinary()
    expect(requested).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe'])
  })

  // Null is a supported answer all the way through: the adapter simply omits
  // `pathToClaudeCodeExecutable` and the SDK looks for itself, which is the
  // correct behaviour in dev and on an unpackaged run.
  it('is null when the package is not installed', () => {
    on('freebsd', 'x64')
    expect(claude.resolveClaudeBinary()).toBeNull()
  })
})
