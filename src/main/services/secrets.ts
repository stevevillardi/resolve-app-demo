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
