import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Finding the native binaries the two agent SDKs shell out to.
 *
 * Both SDKs vendor a platform-specific executable in a sibling package
 * (`@openai/codex-darwin-arm64`, `@anthropic-ai/claude-agent-sdk-darwin-arm64`)
 * and locate it with `require.resolve`. That works in dev and is actively
 * dangerous in a packaged app, for a reason worth stating precisely because
 * nothing about it is obvious:
 *
 * `require.resolve` from inside `app.asar` returns a path *inside the archive*.
 * Electron patches `fs` to read through asar, so the SDK's own
 * `existsSync` check on that path **succeeds** — and it then spawns it.
 * `spawn` is a real syscall with no asar awareness, so the OS tries to walk
 * into `app.asar` as a directory, finds a file, and fails with `ENOTDIR`.
 *
 * The exists-check passing is what makes this so quiet: every guard the SDK has
 * says the binary is there, right up until the moment it is executed. Measured
 * directly against a packaged build:
 *
 *     path:  …/Contents/Resources/app.asar/node_modules/@anthropic-ai/…/claude
 *     spawn: ENOTDIR
 *
 * So the rule this module enforces is not "look in the right place first" —
 * ordering luck is what the codex resolver was relying on. It is that a path
 * which cannot be spawned is never returned at all.
 */

/**
 * Whether a path lies inside an asar archive, and therefore cannot be executed.
 *
 * `app.asar.unpacked/` is deliberately *not* inside one: it is the real
 * directory electron-builder extracts to, and matching on `.asar` followed by
 * a separator is what tells the two apart — in `app.asar.unpacked/` the `.asar`
 * is followed by a dot.
 */
export function isInsideAsar(path: string): boolean {
  return /\.asar[/\\]/.test(path)
}

/**
 * Where an unpacked `node_modules` can be, most specific first.
 *
 * Three entries because the answer differs between a packaged app and a dev
 * run, and `app.getAppPath()` is `…/app.asar` in the former — which is exactly
 * the trap above, and why every candidate is filtered rather than trusted.
 */
export function unpackedSearchRoots(): string[] {
  const appPath = app.getAppPath()
  return [
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules'),
    join(appPath.replace(/\.asar$/, '.asar.unpacked'), 'node_modules'),
    join(appPath, 'node_modules')
  ]
}

/**
 * The first candidate that exists *and* can actually be executed.
 *
 * `exists` is injectable so the asar rule can be tested without a packaged
 * build — and testing it matters, because the production failure is invisible
 * to a filesystem check by construction.
 */
export function firstSpawnable(
  candidates: readonly string[],
  exists: (path: string) => boolean = existsSync
): string | null {
  for (const candidate of candidates) {
    // Order matters: reject before asking, so a lying exists() on an in-asar
    // path can never produce a return value.
    if (isInsideAsar(candidate)) continue
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Resolves `relative` (a path under some `node_modules`) against every root.
 *
 * The shared half of the two resolvers. It exists because the codex one was
 * written, correct, and then not repeated for Claude — and the missing copy
 * was a packaged app that could not start a Claude session at all. One
 * function means the next SDK cannot be forgotten the same way.
 */
export function resolveVendored(
  relative: string,
  exists: (path: string) => boolean = existsSync
): string | null {
  return firstSpawnable(
    unpackedSearchRoots().map((root) => join(root, relative)),
    exists
  )
}
