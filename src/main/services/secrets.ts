import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * The single encryption boundary for the whole app (blueprint §11, "Secret
 * storage: Electron safeStorage"). This is the ONLY module permitted to import
 * `safeStorage` — enforced by a no-restricted-imports rule in eslint.config.mjs
 * so a later phase can't quietly scatter keychain access across the codebase.
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

export function getSecret(key: SecretKey): string | null {
  const path = secretPath(key)
  if (!existsSync(path)) return null
  if (!isSecretStorageAvailable()) return null

  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    // Wrong keychain (restored backup, copied profile) or a corrupt file.
    // Drop it so the user is re-prompted instead of hitting an auth error on
    // every subsequent call with no way to recover from the UI.
    deleteSecret(key)
    return null
  }
}

export function setSecret(key: SecretKey, value: string): void {
  if (!isSecretStorageAvailable()) {
    throw new Error('OS secret storage is unavailable; refusing to store credentials in plaintext.')
  }
  writeFileSync(secretPath(key), safeStorage.encryptString(value), { mode: 0o600 })
}

export function deleteSecret(key: SecretKey): void {
  rmSync(secretPath(key), { force: true })
}
