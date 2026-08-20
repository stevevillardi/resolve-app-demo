import { createAvatar } from '@dicebear/core'
import * as bottts from '@dicebear/bottts'

/**
 * Bot avatars. A persona is rendered as a DiceBear "bottts" robot: its
 * avatarSeed picks which robot it is (the template's id by default,
 * re-rollable in the persona editor), and the user-chosen avatarColor tints
 * the robot's body — so the same persona looks the same on every surface and
 * every launch.
 *
 * Generation is local and synchronous (no network; CSP already allows
 * `img-src data:`), but not free — an SVG is composed per call — so results
 * are memoized per (seed, color). The cache is unbounded by design: its keys
 * are persona ids crossed with their chosen colors, a set that grows by a
 * handful per user decision, not per render.
 */

const cache = new Map<string, string>()

/** Strips to the 6-digit hex DiceBear wants, or null for non-hex input. */
export function normalizeHex(color: string): string | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim())
  if (!match) return null
  const raw = match[1]
  return raw.length === 3
    ? raw
        .split('')
        .map((c) => c + c)
        .join('')
    : raw
}

export function botttsDataUri(seed: string, color: string): string {
  const key = `${seed}:${color}`
  const cached = cache.get(key)
  if (cached) return cached

  const hex = normalizeHex(color)
  const uri = createAvatar(bottts, {
    seed,
    // Non-hex input (a CSS var, a named color) falls back to DiceBear's own
    // palette rather than crashing — the seed still keeps it stable.
    ...(hex ? { baseColor: [hex] } : {})
  }).toDataUri()

  cache.set(key, uri)
  return uri
}

/**
 * A fresh seed for the robot picker. A UUID, the same shape as the template
 * ids a robot is seeded from by default — same entropy, same aesthetic space.
 */
export function randomAvatarSeed(): string {
  return crypto.randomUUID()
}

/** `count` fresh candidate seeds for the picker grid, none equal to `exclude`. */
export function rollSeedCandidates(count: number, exclude: string): string[] {
  const seeds: string[] = []
  while (seeds.length < count) {
    const seed = randomAvatarSeed()
    if (seed !== exclude) seeds.push(seed)
  }
  return seeds
}

/**
 * Replaces every tile except `keep`, in place. The picker's tiles never
 * reorder — a selection that jumped to slot 1 read as the click not working —
 * so the die refreshes the tiles around the chosen robot instead.
 */
export function rerollOtherSeeds(tiles: string[], keep: string): string[] {
  return tiles.map((tile) => (tile === keep ? tile : randomAvatarSeed()))
}
