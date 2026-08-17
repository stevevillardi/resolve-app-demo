import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the icon assets tray.ts and electron-builder load, because every way
 * they can be wrong is silent.
 *
 * A missing `@2x` does not throw — `trayImage` skips absent files and the icon
 * simply renders blurry on every Retina Mac, which is all of them. A tray PNG at
 * the wrong size is scaled by the OS into a smear. And the two tray variants are
 * generated from a six-row table in scripts/build-icons.ts where a copy-paste
 * slip would point both at the same SVG, leaving "a turn is running" with
 * nothing to show for it.
 *
 * Reading the IHDR rather than decoding: these assertions are about the file's
 * shape, and a pixel decoder would be more machinery than the claim needs.
 */

const ROOT = resolve(__dirname, '../..')

/** width, height, and whether the colour type carries alpha, from the IHDR. */
function pngHeader(path: string): { width: number; height: number; hasAlpha: boolean } {
  const buffer = readFileSync(resolve(ROOT, path))

  // 8-byte signature, then the IHDR chunk: 4 length + 4 type + width + height
  // + bit depth + colour type.
  expect([...buffer.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR')

  const colourType = buffer.readUInt8(25)
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    // 4 is greyscale+alpha, 6 is RGBA. Anything else is opaque, which for a
    // menu-bar template image means a black rectangle.
    hasAlpha: colourType === 4 || colourType === 6
  }
}

describe('icon assets', () => {
  it.each([
    ['resources/trayTemplate.png', 16],
    ['resources/trayTemplate@2x.png', 32],
    ['resources/trayActiveTemplate.png', 16],
    ['resources/trayActiveTemplate@2x.png', 32]
  ])('%s is a square %ipx PNG with alpha', (path, size) => {
    expect(pngHeader(path)).toEqual({ width: size, height: size, hasAlpha: true })
  })

  it('ships a distinct active variant, not a second copy of idle', () => {
    for (const suffix of ['', '@2x']) {
      const idle = readFileSync(resolve(ROOT, `resources/trayTemplate${suffix}.png`))
      const active = readFileSync(resolve(ROOT, `resources/trayActiveTemplate${suffix}.png`))
      expect(idle.equals(active)).toBe(false)
    }
  })

  // electron-builder derives .icns and .ico from this one, and warns-then-ships
  // a default icon if it is smaller than 512. 1024 is what it wants for the
  // largest icns representation.
  it('gives electron-builder a 1024px source to derive icns and ico from', () => {
    expect(pngHeader('build/icon.png')).toEqual({ width: 1024, height: 1024, hasAlpha: true })
  })

  // The Linux BrowserWindow icon (src/main/index.ts).
  it('ships a 512px window icon', () => {
    expect(pngHeader('resources/icon.png')).toEqual({ width: 512, height: 512, hasAlpha: true })
  })
})
