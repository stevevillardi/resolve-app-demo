import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * The single encryption boundary for the whole app: secrets are stored through
 * Electron's `safeStorage`, and this is the ONLY module permitted to import it
 * — enforced by a no-restricted-imports rule in eslint.config.mjs, so keychain
 * access cannot quietly scatter across the codebase later.
 *
 * Ciphertext is written to individual files under userData/secrets rather than
 * into SQLite, so that "no token is in the database" is true by construction
 * rather than by review.
 */
export type SecretKey = 'github_token' | 'anthropic_api_key' | 'openai_api_key'

function secretsDir(): string {
  const dir = join(app.getPath('userData'), 'secrets')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function secretPath(key: SecretKey): string {
  return join(secretsDir(), `${key}.bin`)
}

/**
 * Where the ciphertext lives, so the OS sandbox can be told to keep agents out
 * of it — `AdapterConfig.denyReadPaths`, resolved in adapter-host.ts.
 *
 * safeStorage encrypts against the OS keychain, so reading one of these files
 * is not the same as reading a token. But an agent has no business in this
 * directory at all, and "encrypted at rest" is a weaker guarantee than "not
 * reachable": on a Linux box with no keyring, `setSecret` refuses to write
 * rather than writing plaintext, which is exactly the case where a stray read
 * would matter most if that rule ever slipped.
 *
 * Does not create the directory. Every other path helper here does, because
 * they are about to write to it; this one is asked at session start, and
 * conjuring an empty directory just to name it in a deny list is a side effect
 * no caller wants.
 */
export function secretsPathForDenyList(): string {
  return join(app.getPath('userData'), 'secrets')
}

/**
 * False on Linux without an available keyring. Callers must surface this to the
 * user rather than silently degrading to plaintext — we would sooner store
 * nothing than store a token in the clear.
 */
export function isSecretStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function hasSecret(key: SecretKey): boolean {
  return existsSync(secretPath(key))
}

/**
 * Keys whose ciphertext exists but could not be decrypted by *this* process.
 *
 * Module-level memory, not persisted: the verdict belongs to the running
 * build. On macOS, safeStorage binds ciphertext to the app's code signature —
 * every rebuilt dev Electron is a new ad-hoc signature, so a secret written by
 * one build is routinely unreadable by the next *and readable again by the
 * first*. Which is exactly why this must never delete: dropping the file on a
 * decrypt failure turns that recoverable mismatch into a permanent loss, and
 * presents to the user as "my GitHub token keeps getting invalidated" with
 * GitHub never involved.
 */
const unreadable = new Set<SecretKey>()

/** True while the stored ciphertext defeats this build's keychain access. */
export function secretUnreadable(key: SecretKey): boolean {
  return unreadable.has(key)
}

export function getSecret(key: SecretKey): string | null {
  const path = secretPath(key)
  if (!existsSync(path)) return null
  if (!isSecretStorageAvailable()) {
    // Ciphertext exists and cannot be read, which is what `unreadable` means —
    // so mark it here too. Returning null without the mark sends every status
    // surface reaching for the wrong sentence: "Connect GitHub first" about a
    // credential that is stored and intact. `secretStorageAvailable` carries
    // the distinct "no keyring on this machine at all" meaning separately.
    unreadable.add(key)
    return null
  }

  try {
    const value = safeStorage.decryptString(readFileSync(path))
    unreadable.delete(key)
    return value
  } catch {
    // Wrong keychain identity (a rebuilt dev binary, a restored backup, a
    // copied profile) or a corrupt file. The file is deliberately KEPT — the
    // build that wrote it can still read it — and the failure is recorded so
    // status surfaces can say "reconnect to re-save under this build" instead
    // of pretending nothing was ever stored.
    unreadable.add(key)
    return null
  }
}

export function setSecret(key: SecretKey, value: string): void {
  if (!isSecretStorageAvailable()) {
    throw new Error(
      'This computer has no secure place to keep credentials, so Switchboard will not save them.'
    )
  }
  writeFileSync(secretPath(key), safeStorage.encryptString(value), { mode: 0o600 })
  // Freshly written by this build, so this build can read it again.
  unreadable.delete(key)
}

export function deleteSecret(key: SecretKey): void {
  rmSync(secretPath(key), { force: true })
  unreadable.delete(key)
}
