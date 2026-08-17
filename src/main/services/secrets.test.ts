import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The single encryption boundary. Everything here runs against a real temp
 * directory so file mode and on-disk contents are genuinely asserted — the
 * point of this module is what does and doesn't land on disk.
 *
 * safeStorage itself is faked (it needs a real OS keychain), but the fake is
 * deliberately *reversible-but-not-plaintext* so "ciphertext must not contain
 * the secret" is still a meaningful assertion.
 */

let userData: string
let encryptionAvailable = true

const fakeSafeStorage = {
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (plain: string) => Buffer.from(`v10${Buffer.from(plain).toString('base64')}`),
  decryptString: (buf: Buffer) => {
    const raw = buf.toString()
    if (!raw.startsWith('v10')) throw new Error('not ciphertext this keychain can read')
    return Buffer.from(raw.slice(3), 'base64').toString()
  }
}

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  get safeStorage() {
    return fakeSafeStorage
  }
}))

const {
  getSecret,
  setSecret,
  deleteSecret,
  hasSecret,
  isSecretStorageAvailable,
  secretUnreadable
} = await import('./secrets')

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pr-secrets-'))
  encryptionAvailable = true
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

const tokenPath = (): string => join(userData, 'secrets', 'github_token.bin')

describe('round trip', () => {
  it('stores and reads back a secret', () => {
    setSecret('github_token', 'gho_realtoken123')
    expect(getSecret('github_token')).toBe('gho_realtoken123')
  })

  it('reports absence before anything is stored', () => {
    expect(hasSecret('github_token')).toBe(false)
    expect(getSecret('github_token')).toBeNull()
  })

  it('overwrites rather than appending on a re-store', () => {
    setSecret('github_token', 'first')
    setSecret('github_token', 'second')
    expect(getSecret('github_token')).toBe('second')
  })

  it('keeps the three secret kinds independent', () => {
    setSecret('github_token', 'gh')
    setSecret('anthropic_api_key', 'ant')
    expect(getSecret('github_token')).toBe('gh')
    expect(getSecret('anthropic_api_key')).toBe('ant')
    expect(hasSecret('openai_api_key')).toBe(false)
  })
})

describe('on-disk shape', () => {
  it('never writes the plaintext secret to disk', () => {
    setSecret('github_token', 'gho_supersecret_value')
    const raw = readFileSync(tokenPath()).toString('binary')
    expect(raw).not.toContain('gho_supersecret_value')
  })

  it('writes owner-only file permissions', () => {
    setSecret('github_token', 'gho_x')
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600)
  })

  it('writes to userData/secrets, never near the database', () => {
    setSecret('github_token', 'gho_x')
    expect(existsSync(tokenPath())).toBe(true)
    expect(existsSync(join(userData, 'switchboard.db'))).toBe(false)
  })
})

describe('deletion', () => {
  it('removes the secret', () => {
    setSecret('github_token', 'gho_x')
    deleteSecret('github_token')
    expect(hasSecret('github_token')).toBe(false)
    expect(getSecret('github_token')).toBeNull()
  })

  it('is a no-op when nothing is stored', () => {
    expect(() => deleteSecret('github_token')).not.toThrow()
  })
})

describe('unavailable OS keychain', () => {
  it('refuses to write rather than degrading to plaintext', () => {
    encryptionAvailable = false
    // Storing in the clear would be worse than failing — a Linux box with no
    // keyring must get an error the UI can surface, not a silent downgrade.
    expect(() => setSecret('github_token', 'gho_x')).toThrow(/plaintext/i)
    expect(existsSync(tokenPath())).toBe(false)
  })

  it('reads return null instead of throwing', () => {
    setSecret('github_token', 'gho_x')
    encryptionAvailable = false
    expect(getSecret('github_token')).toBeNull()
  })

  it('reports availability to callers', () => {
    expect(isSecretStorageAvailable()).toBe(true)
    encryptionAvailable = false
    expect(isSecretStorageAvailable()).toBe(false)
  })
})

describe('undecryptable ciphertext', () => {
  // The real scenario is not exotic: on macOS, safeStorage binds ciphertext to
  // the app's code signature, and every rebuilt dev Electron is a new ad-hoc
  // signature — so a secret written by one build is routinely unreadable by
  // the next AND readable again by the first. The old behavior deleted the
  // file here, which turned that recoverable mismatch into 'my GitHub token
  // keeps getting invalidated'.
  it('keeps the file — the build that wrote it can still read it', () => {
    setSecret('github_token', 'gho_x')
    writeFileSync(tokenPath(), Buffer.from('garbage from another keychain'))

    expect(getSecret('github_token')).toBeNull()
    expect(hasSecret('github_token')).toBe(true)
    expect(existsSync(tokenPath())).toBe(true)
  })

  it('reports the key as unreadable, and only that key', () => {
    setSecret('github_token', 'gho_x')
    setSecret('anthropic_api_key', 'sk-ant')
    writeFileSync(tokenPath(), Buffer.from('garbage'))

    getSecret('github_token')
    expect(secretUnreadable('github_token')).toBe(true)
    expect(secretUnreadable('anthropic_api_key')).toBe(false)
  })

  it('clears the mark when the ciphertext becomes readable again', () => {
    // The dev-worktree round trip: build A wrote it, build B failed, build A
    // reads it again.
    setSecret('github_token', 'gho_x')
    const good = readFileSync(tokenPath())
    writeFileSync(tokenPath(), Buffer.from('garbage'))
    getSecret('github_token')
    expect(secretUnreadable('github_token')).toBe(true)

    writeFileSync(tokenPath(), good)
    expect(getSecret('github_token')).toBe('gho_x')
    expect(secretUnreadable('github_token')).toBe(false)
  })

  it('clears the mark on a fresh setSecret', () => {
    setSecret('github_token', 'gho_x')
    writeFileSync(tokenPath(), Buffer.from('garbage'))
    getSecret('github_token')

    setSecret('github_token', 'gho_new')
    expect(secretUnreadable('github_token')).toBe(false)
    expect(getSecret('github_token')).toBe('gho_new')
  })
})
