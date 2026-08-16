import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { CodexAuthStatus, DeviceFlowState } from '../../shared/ipc-contract'
import { getSecret, isSecretStorageAvailable, setSecret } from './secrets'

/**
 * Codex backend auth.
 *
 * Blueprint §15A assumed `@openai/codex-sdk` would handle this itself ("its own
 * device-code browser login if none exists"). Verified against v0.147.0: the
 * SDK exports only Codex/Thread/CodexOptions and has NO login API at all — that
 * behaviour belongs to the `codex` CLI. The SDK does vendor that CLI
 * (dependency @openai/codex), so we drive the binary directly.
 *
 * Confirmed by running the vendored binary during Phase 3:
 *   codex login status        -> exit 0 "Logged in using ChatGPT" / exit 1 "Not logged in"
 *   codex login --device-auth -> prints a verification URL and a one-time code,
 *                                exits 0 once the browser side completes
 *   codex login --with-api-key-> reads the key from stdin (never argv)
 */

const CODE_EXPIRY_MS = 15 * 60 * 1000

const PLATFORM_PACKAGE_BY_TRIPLE: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64'
}

function targetTriple(): string | null {
  const { platform, arch } = process
  if (platform === 'linux' || platform === 'android') {
    if (arch === 'x64') return 'x86_64-unknown-linux-musl'
    if (arch === 'arm64') return 'aarch64-unknown-linux-musl'
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return 'x86_64-apple-darwin'
    if (arch === 'arm64') return 'aarch64-apple-darwin'
  }
  if (platform === 'win32') {
    if (arch === 'x64') return 'x86_64-pc-windows-msvc'
    if (arch === 'arm64') return 'aarch64-pc-windows-msvc'
  }
  return null
}

let resolvedBinary: string | null | undefined

/**
 * Mirrors the resolution in @openai/codex's bin/codex.js, but searches explicit
 * roots rather than using require.resolve: in a packaged build the binary lives
 * under app.asar.unpacked (see asarUnpack in electron-builder.yml), which bare
 * module resolution from inside the asar would miss.
 */
export function resolveCodexBinary(): string | null {
  if (resolvedBinary !== undefined) return resolvedBinary

  const triple = targetTriple()
  const platformPackage = triple ? PLATFORM_PACKAGE_BY_TRIPLE[triple] : undefined
  if (!triple || !platformPackage) {
    resolvedBinary = null
    return null
  }

  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const roots = [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules'),
    join(app.getAppPath(), 'node_modules'),
    join(app.getAppPath().replace(/\.asar$/, '.asar.unpacked'), 'node_modules')
  ]

  for (const root of roots) {
    const candidate = join(root, platformPackage, 'vendor', triple, 'bin', exe)
    if (existsSync(candidate)) {
      resolvedBinary = candidate
      return candidate
    }
  }

  resolvedBinary = null
  return null
}

function childEnv(): NodeJS.ProcessEnv {
  const apiKey = getSecret('openai_api_key') ?? import.meta.env.MAIN_VITE_OPENAI_API_KEY
  return { ...process.env, ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}) }
}

export function getCodexAuthStatus(): CodexAuthStatus {
  const bin = resolveCodexBinary()
  if (!bin) {
    return {
      authenticated: false,
      source: null,
      error: `No Codex binary for this platform (${process.platform}/${process.arch}).`
    }
  }

  // `login status` rather than sniffing ~/.codex/auth.json, so an expired or
  // malformed credential reads as logged out instead of as connected.
  const result = spawnSync(bin, ['login', 'status'], { env: childEnv(), timeout: 15_000 })
  if (result.status === 0) {
    const usingApiKey = /api key/i.test(result.stdout?.toString() ?? '')
    return { authenticated: true, source: usingApiKey ? 'api_key' : 'cli' }
  }
  return { authenticated: false, source: null }
}

// --- Device-code login ------------------------------------------------------

let state: DeviceFlowState = { status: 'idle' }
let child: ChildProcess | null = null
let expiryTimer: NodeJS.Timeout | null = null

// eslint-disable-next-line no-control-regex -- stripping real ANSI escapes from CLI output
const ANSI = /\[[0-9;]*m/g
const URL_PATTERN = /https?:\/\/\S+/
const CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/

export function getCodexLoginState(): DeviceFlowState {
  return state
}

function reset(next: DeviceFlowState): DeviceFlowState {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  child = null
  state = next
  return state
}

export function startCodexLogin(): DeviceFlowState {
  // Idempotent: a double-click on Connect must not spawn a second login.
  if (state.status === 'starting' || state.status === 'awaiting_authorization') return state

  const bin = resolveCodexBinary()
  if (!bin) {
    return reset({ status: 'error', error: 'No Codex binary available for this platform.' })
  }

  state = { status: 'starting' }

  const proc = spawn(bin, ['login', '--device-auth'], { env: childEnv() })
  child = proc

  const onOutput = (chunk: Buffer): void => {
    const text = chunk.toString().replace(ANSI, '')
    // The CLI prints the URL and the code on separate lines, and we may get
    // them in separate chunks, so merge into whatever we already have.
    const url = text.match(URL_PATTERN)?.[0]
    const code = text.match(CODE_PATTERN)?.[0]
    if (!url && !code) return

    state = {
      status: 'awaiting_authorization',
      verificationUri: url ?? state.verificationUri,
      userCode: code ?? state.userCode,
      expiresAt: state.expiresAt ?? Date.now() + CODE_EXPIRY_MS
    }
  }

  proc.stdout?.on('data', onOutput)
  proc.stderr?.on('data', onOutput)

  proc.on('error', (error) => {
    if (child !== proc) return
    reset({ status: 'error', error: error.message })
  })

  proc.on('exit', (code) => {
    if (child !== proc) return // superseded by a cancel/restart
    reset(
      code === 0
        ? { status: 'success' }
        : { status: 'error', error: `Codex login exited with code ${code ?? 'unknown'}.` }
    )
  })

  expiryTimer = setTimeout(() => {
    if (child !== proc) return
    proc.kill()
    reset({ status: 'error', error: 'The Codex login code expired. Try again.' })
  }, CODE_EXPIRY_MS)

  return state
}

export function cancelCodexLogin(): DeviceFlowState {
  const proc = child
  child = null // makes the exit handler a no-op for this process
  proc?.kill()
  return reset({ status: 'idle' })
}

export function setOpenAiApiKey(apiKey: string): CodexAuthStatus {
  if (!isSecretStorageAvailable()) {
    return {
      authenticated: false,
      source: null,
      error: 'OS secret storage is unavailable, so the API key cannot be stored securely.'
    }
  }

  const trimmed = apiKey.trim()
  setSecret('openai_api_key', trimmed)

  const bin = resolveCodexBinary()
  if (bin) {
    // --with-api-key reads stdin rather than argv, so the key never appears in
    // the process list. Registering it with the CLI keeps `login status` and
    // the SDK's own auth agreeing with each other.
    const result = spawnSync(bin, ['login', '--with-api-key'], {
      input: trimmed,
      env: childEnv(),
      timeout: 15_000
    })
    if (result.status !== 0) {
      return { authenticated: false, source: null, error: 'Codex rejected that API key.' }
    }
  }

  return getCodexAuthStatus()
}
