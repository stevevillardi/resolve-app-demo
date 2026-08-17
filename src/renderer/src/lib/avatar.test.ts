import { describe, expect, it } from 'vitest'
import { botttsDataUri, normalizeHex } from './avatar'

/**
 * The property the whole feature rests on: the same persona renders the same
 * robot on every surface and every launch. If DiceBear ever made generation
 * time- or call-order-dependent, avatars would flicker between views — worse
 * than initials ever were.
 */
describe('botttsDataUri', () => {
  it('is deterministic for a given seed and color', () => {
    expect(botttsDataUri('persona-code-reviewer', '#2a78d6')).toBe(
      botttsDataUri('persona-code-reviewer', '#2a78d6')
    )
  })

  it('renders different personas as different robots', () => {
    expect(botttsDataUri('persona-code-reviewer', '#2a78d6')).not.toBe(
      botttsDataUri('persona-refactor-buddy', '#2a78d6')
    )
  })

  it('carries the persona color into the SVG', () => {
    const uri = decodeURIComponent(botttsDataUri('persona-code-reviewer', '#2a78d6'))
    expect(uri).toContain('2a78d6')
  })

  it('re-tints rather than re-rolls when only the color changes', () => {
    // The color input is a tint control, not an identity control: both URIs
    // must exist (no crash) and differ only by palette. Cheapest observable
    // proxy: both are valid data URIs and they differ.
    const blue = botttsDataUri('persona-x', '#2a78d6')
    const green = botttsDataUri('persona-x', '#1baf7a')
    expect(blue.startsWith('data:image/svg+xml')).toBe(true)
    expect(green.startsWith('data:image/svg+xml')).toBe(true)
    expect(blue).not.toBe(green)
  })

  it('survives a non-hex color instead of crashing', () => {
    // avatarColor is free-form (the fallback var(--muted) reaches here for
    // orphaned rows); DiceBear must fall back to its own palette.
    expect(botttsDataUri('persona-x', 'var(--muted)').startsWith('data:image/svg+xml')).toBe(true)
  })
})

describe('normalizeHex', () => {
  it('strips the hash and expands shorthand', () => {
    expect(normalizeHex('#2a78d6')).toBe('2a78d6')
    expect(normalizeHex('2a78d6')).toBe('2a78d6')
    expect(normalizeHex('#abc')).toBe('aabbcc')
  })

  it('returns null for anything that is not hex', () => {
    expect(normalizeHex('var(--muted)')).toBeNull()
    expect(normalizeHex('rebeccapurple')).toBeNull()
    expect(normalizeHex('')).toBeNull()
  })
})
