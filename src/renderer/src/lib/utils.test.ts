import { describe, expect, it } from 'vitest'
import { cn } from './utils'

/**
 * `cn` merges Tailwind classes, and merging means *dropping* the ones it
 * decides are overridden. Everything here is about it dropping the right ones.
 *
 * This exists because it once dropped the wrong one, silently, across the whole
 * app: `text-meta` is a custom size, `text-scope-safe` is a custom colour, and
 * tailwind-merge could not tell them apart — so every ScopeChip rendered at the
 * body's 16px instead of 11px, with no warning and no class in the DOM to
 * explain it.
 *
 * Note the shape these are written in. A DOM-level check cannot catch this: the
 * failure removes the class entirely, so anything that looks for elements
 * carrying `text-meta` finds nothing wrong. It has to be asserted on the string
 * `cn` returns.
 */

const SIZES = ['text-micro', 'text-meta', 'text-code', 'text-row', 'text-title']

describe('cn', () => {
  describe('custom size tokens survive a colour on the same element', () => {
    it.each(SIZES)('%s is not dropped by a custom colour', (size) => {
      const result = cn(size, 'text-scope-safe')
      expect(result).toContain(size)
      expect(result).toContain('text-scope-safe')
    })

    it.each(SIZES)('%s is not dropped by a built-in colour', (size) => {
      const result = cn(size, 'text-muted-foreground')
      expect(result).toContain(size)
      expect(result).toContain('text-muted-foreground')
    })

    it('survives the order the chip actually writes them in', () => {
      // ScopeChip puts the size in its base string and the colour in a variant
      // appended after it, which is the order that loses.
      const result = cn('rounded-full font-mono text-meta leading-none', 'text-scope-safe')
      expect(result).toContain('text-meta')
    })
  })

  describe('still resolves genuine conflicts', () => {
    it('lets a later custom size win over an earlier one', () => {
      expect(cn('text-meta', 'text-row')).toBe('text-row')
    })

    it('lets a later custom size win over a built-in one', () => {
      // The point of registering them: they have to be in the same group as
      // Tailwind's own sizes, not merely absent from the colour group.
      expect(cn('text-xs', 'text-meta')).toBe('text-meta')
      expect(cn('text-meta', 'text-xs')).toBe('text-xs')
    })

    it('lets a later colour win over an earlier one', () => {
      expect(cn('text-muted-foreground', 'text-scope-safe')).toBe('text-scope-safe')
    })
  })

  it('keeps behaving like clsx for conditionals', () => {
    const off = false as boolean
    expect(cn('a', off && 'b', undefined, 'c')).toBe('a c')
  })
})
