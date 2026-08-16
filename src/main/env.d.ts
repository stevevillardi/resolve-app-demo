/// <reference types="electron-vite/node" />

/**
 * Build-time config reaching the main process. electron-vite only exposes
 * `.env` keys prefixed MAIN_VITE_ here — see .env.example.
 */
interface ImportMetaEnv {
  /** GitHub OAuth App client ID. Not a secret: device flow has no client secret. */
  readonly MAIN_VITE_GITHUB_CLIENT_ID?: string
  /** Space/comma separated. Defaults to "repo read:user". */
  readonly MAIN_VITE_GITHUB_SCOPES?: string
  /** Unprefixed aliases, allowed via envPrefix in electron.vite.config.ts. */
  readonly GITHUB_CLIENT_ID?: string
  readonly GITHUB_SCOPES?: string
  /** Dev-only escape hatch; the OS keychain takes precedence. */
  readonly MAIN_VITE_ANTHROPIC_API_KEY?: string
  /** Dev-only escape hatch; the OS keychain takes precedence. */
  readonly MAIN_VITE_OPENAI_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
