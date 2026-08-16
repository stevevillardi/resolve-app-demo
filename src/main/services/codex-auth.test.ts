import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceFlowState } from '../../shared/ipc-contract'

/**
 * Codex auth. The device-code parsing is tested against output captured from
 * the real `codex login --device-auth` during Phase 3 — including its ANSI
 * colouring, which is the thing most likely to break a naive regex.
 *
 * Spawning is faked: the binary is ~220MB and a real login would need a
 * browser. What matters here is the parsing and the status mapping.
 */

let spawnSyncResult: { status: number | null; stdout?: string } = { status: 1 }
const spawnSyncCalls: Array<{ args: string[]; input?: string }> = []
/** Whether the vendored binary is present for this platform. */
let binaryExists = true

vi.mock('electron', () => ({ app: { getAppPath: () => '/app' } }))

vi.mock('fs', () => ({ existsSync: () => binaryExists }))

vi.mock('child_process', () => ({
  spawnSync: (_bin: string, args: string[], opts?: { input?: string }) => {
    spawnSyncCalls.push({ args, input: opts?.input })
    return { ...spawnSyncResult, stdout: Buffer.from(spawnSyncResult.stdout ?? '') }
  },
  spawn: () => ({ stdout: null, stderr: null, on: () => {}, kill: () => {} })
}))

const secretStore = new Map<string, string>()
let encryptionAvailable = true

vi.mock('./secrets', () => ({
  getSecret: (k: string) => secretStore.get(k) ?? null,
  setSecret: (k: string, v: string) => void secretStore.set(k, v),
  hasSecret: (k: string) => secretStore.has(k),
  isSecretStorageAvailable: () => encryptionAvailable
}))

/**
 * Fresh module per test: the binary path is memoized and the login state
 * machine is module-level, so a shared import would leak state between cases.
 */
type CodexModule = typeof import('./codex-auth')
let codex: CodexModule

beforeEach(async () => {
  secretStore.clear()
  spawnSyncCalls.length = 0
  encryptionAvailable = true
  binaryExists = true
  spawnSyncResult = { status: 1 }
  vi.resetModules()
  codex = await import('./codex-auth')
})

// Verbatim from the real CLI, with its ANSI escapes written as \u001b so no
// invisible control bytes live in this file.
const E = '\u001b'
const REAL_DEVICE_AUTH_OUTPUT = [
  '',
  `Welcome to Codex [v${E}[90m0.147.0${E}[0m]`,
  `${E}[90mOpenAI's command-line coding agent${E}[0m`,
  '',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  `   ${E}[94mhttps://auth.openai.com/codex/device${E}[0m`,
  '',
  `2. Enter this one-time code ${E}[90m(expires in 15 minutes)${E}[0m`,
  `   ${E}[94mUHHW-B1Z5X${E}[0m`,
  ''
].join('\n')

const IDLE: DeviceFlowState = { status: 'idle' }
const NOW = 1_700_000_000_000

describe('applyDeviceAuthOutput', () => {
  it('extracts the URL and code from real CLI output', () => {
    const next = codex.applyDeviceAuthOutput(REAL_DEVICE_AUTH_OUTPUT, IDLE, NOW)
    expect(next).toMatchObject({
      status: 'awaiting_authorization',
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'UHHW-B1Z5X'
    })
  })

  it('strips ANSI colouring out of both fields', () => {
    const next = codex.applyDeviceAuthOutput(REAL_DEVICE_AUTH_OUTPUT, IDLE, NOW)
    // A value still carrying its escape sequence is unusable — the user would
    // copy invisible bytes into the browser.
    for (const field of [next?.userCode, next?.verificationUri]) {
      expect(field).not.toContain(E)
      expect(field).not.toContain('[94m')
      expect(field).not.toContain('[0m')
    }
  })

  it('sets a 15-minute expiry matching what the CLI advertises', () => {
    const next = codex.applyDeviceAuthOutput(REAL_DEVICE_AUTH_OUTPUT, IDLE, NOW)
    expect(next?.expiresAt).toBe(NOW + 15 * 60 * 1000)
  })

  it('returns null for chunks carrying neither field', () => {
    // Must leave state alone rather than blanking a code already on screen.
    expect(codex.applyDeviceAuthOutput('Welcome to Codex\n', IDLE, NOW)).toBeNull()
    expect(codex.applyDeviceAuthOutput('', IDLE, NOW)).toBeNull()
  })

  it('merges fields that arrive in separate chunks', () => {
    // stdout chunk boundaries are arbitrary; the URL and code are on different
    // lines and routinely land in different reads.
    const first = codex.applyDeviceAuthOutput(
      `   ${E}[94mhttps://auth.openai.com/codex/device${E}[0m\n`,
      IDLE,
      NOW
    )
    expect(first?.userCode).toBeUndefined()

    const second = codex.applyDeviceAuthOutput(`   ${E}[94mUHHW-B1Z5X${E}[0m\n`, first!, NOW)
    expect(second).toMatchObject({
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'UHHW-B1Z5X'
    })
  })

  it('keeps the original expiry when a later chunk arrives', () => {
    const first = codex.applyDeviceAuthOutput(REAL_DEVICE_AUTH_OUTPUT, IDLE, NOW)
    const second = codex.applyDeviceAuthOutput('   ABCD-1234\n', first!, NOW + 5000)
    // The clock started when the code was issued, not when we last read stdout.
    expect(second?.expiresAt).toBe(first?.expiresAt)
  })

  it('accepts both code lengths the CLI emits', () => {
    expect(codex.applyDeviceAuthOutput('ABCD-1234', IDLE, NOW)?.userCode).toBe('ABCD-1234')
    expect(codex.applyDeviceAuthOutput('UHHW-B1Z5X', IDLE, NOW)?.userCode).toBe('UHHW-B1Z5X')
  })

  it('does not mistake prose for a code', () => {
    expect(
      codex.applyDeviceAuthOutput('Continue only if you started this login', IDLE, NOW)
    ).toBeNull()
  })
})

describe('getCodexAuthStatus', () => {
  it('reports authenticated when `login status` exits 0', () => {
    spawnSyncResult = { status: 0, stdout: 'Logged in using ChatGPT' }
    expect(codex.getCodexAuthStatus()).toMatchObject({ authenticated: true, source: 'cli' })
  })

  it('reports the api_key source when the CLI says so', () => {
    spawnSyncResult = { status: 0, stdout: 'Logged in using an API key' }
    expect(codex.getCodexAuthStatus()).toMatchObject({ authenticated: true, source: 'api_key' })
  })

  it('reports unauthenticated when `login status` exits non-zero', () => {
    // Exit code rather than the presence of ~/.codex/auth.json, so an expired
    // or malformed credential reads as logged out instead of connected.
    spawnSyncResult = { status: 1, stdout: 'Not logged in' }
    expect(codex.getCodexAuthStatus()).toMatchObject({ authenticated: false, source: null })
  })

  it('asks the CLI for status rather than reading the credential file', () => {
    spawnSyncResult = { status: 0, stdout: 'Logged in using ChatGPT' }
    codex.getCodexAuthStatus()
    expect(spawnSyncCalls.at(-1)?.args).toEqual(['login', 'status'])
  })
})

describe('setOpenAiApiKey', () => {
  it('passes the key on stdin, never in argv', () => {
    // argv is world-readable via `ps`; stdin is not.
    spawnSyncResult = { status: 0, stdout: 'Logged in using an API key' }
    codex.setOpenAiApiKey('sk-secret-key')

    const call = spawnSyncCalls.find((c) => c.args.includes('--with-api-key'))
    expect(call?.args).toEqual(['login', '--with-api-key'])
    expect(call?.args.join(' ')).not.toContain('sk-secret-key')
    expect(call?.input).toBe('sk-secret-key')
  })

  it('stores the key in the keychain', () => {
    spawnSyncResult = { status: 0, stdout: 'Logged in using an API key' }
    codex.setOpenAiApiKey('  sk-trimmed  ')
    expect(secretStore.get('openai_api_key')).toBe('sk-trimmed')
  })

  it('reports rejection when the CLI refuses the key', () => {
    spawnSyncResult = { status: 1 }
    expect(codex.setOpenAiApiKey('sk-bad')).toMatchObject({
      authenticated: false,
      error: expect.stringMatching(/rejected/i)
    })
  })

  it('refuses to store when the OS keychain is unavailable', () => {
    encryptionAvailable = false
    expect(codex.setOpenAiApiKey('sk-x')).toMatchObject({ authenticated: false })
    expect(secretStore.has('openai_api_key')).toBe(false)
  })
})

describe('missing platform binary', () => {
  it('reports an actionable error rather than throwing', async () => {
    binaryExists = false
    vi.resetModules()
    const isolated = await import('./codex-auth')

    expect(isolated.resolveCodexBinary()).toBeNull()
    expect(isolated.getCodexAuthStatus()).toMatchObject({
      authenticated: false,
      error: expect.stringMatching(/no codex binary/i)
    })
    expect(isolated.startCodexLogin()).toMatchObject({ status: 'error' })
  })
})
