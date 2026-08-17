import { readFileSync } from 'fs'
import { resolve } from 'path'
import { inflateSync } from 'zlib'
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
 * Most of these read the IHDR rather than decoding, because they are about the
 * file's shape. The icon-grid check is the exception and has to look at pixels:
 * "the artwork is inset" is invisible in the header, and it is the one that has
 * been wrong twice — a full-bleed icon renders ~24% larger than every neighbour
 * in the Dock, which nobody notices until they see the Dock.
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

/**
 * The opaque region of an 8-bit RGBA PNG, as a symmetric margin in pixels.
 *
 * Enough of a PNG decoder to answer one question: inflate the IDAT stream,
 * undo the per-scanline filters, and find the first and last row and column
 * carrying any alpha. Only the colour type Chromium writes is handled, and the
 * assertion below fails loudly if that ever changes.
 */
function opaqueMargin(path: string): { left: number; top: number; right: number; bottom: number } {
  const buffer = readFileSync(resolve(ROOT, path))
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  expect(buffer.readUInt8(24)).toBe(8) // bit depth
  expect(buffer.readUInt8(25)).toBe(6) // colour type: RGBA
  expect(buffer.readUInt8(28)).toBe(0) // interlace: none

  // Walk the chunk list and concatenate every IDAT; encoders are free to split
  // the compressed stream across several of them.
  const idat: Buffer[] = []
  for (let at = 8; at + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(at)
    const type = buffer.subarray(at + 4, at + 8).toString('ascii')
    if (type === 'IDAT') idat.push(buffer.subarray(at + 8, at + 8 + length))
    if (type === 'IEND') break
    at += length + 12 // length + type + data + CRC
  }
  const raw = inflateSync(Buffer.concat(idat))

  const bpp = 4
  const stride = width * bpp
  const previous = Buffer.alloc(stride)
  const line = Buffer.alloc(stride)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const filter = raw.readUInt8(y * (stride + 1))
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? line[i - bpp] : 0
      const up = previous[i]
      const upLeft = i >= bpp ? previous[i - bpp] : 0
      switch (filter) {
        case 1:
          line[i] = (line[i] + left) & 0xff
          break
        case 2:
          line[i] = (line[i] + up) & 0xff
          break
        case 3:
          line[i] = (line[i] + ((left + up) >> 1)) & 0xff
          break
        case 4: {
          // Paeth: the neighbour closest to left + up - upLeft.
          const estimate = left + up - upLeft
          const dLeft = Math.abs(estimate - left)
          const dUp = Math.abs(estimate - up)
          const dUpLeft = Math.abs(estimate - upLeft)
          const nearest = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
          line[i] = (line[i] + nearest) & 0xff
          break
        }
        default:
          break // 0: unfiltered
      }
    }
    for (let x = 0; x < width; x++) {
      // 8/255 rather than 0: the rasteriser leaves a faint antialiased halo
      // around the artwork's curves, and a margin measured to the last
      // non-zero pixel would be measuring the halo.
      if (line[x * bpp + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    line.copy(previous)
  }

  expect(maxX).toBeGreaterThanOrEqual(0) // a fully transparent icon is a bug too
  return { left: minX, top: minY, right: width - 1 - maxX, bottom: height - 1 - maxY }
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

  // The Linux BrowserWindow icon, and app.dock.setIcon in dev
  // (src/main/index.ts).
  it('ships a 512px window icon', () => {
    expect(pngHeader('resources/icon.png')).toEqual({ width: 512, height: 512, hasAlpha: true })
  })

  // Apple's icon grid: artwork over 824 of 1024, centred, the rest transparent.
  // Both of these land on a Dock or a taskbar, which scale every icon to the
  // same box regardless of how much of it is drawn — so an icon that skips the
  // margin is simply bigger than its neighbours. One pixel of slack for the
  // rounding in `Math.round(size * contentScale)`.
  it.each([
    ['build/icon.png', 100],
    ['resources/icon.png', 50]
  ])('%s leaves a %ipx transparent margin for the icon grid', (path, expected) => {
    const margin = opaqueMargin(path)
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      expect(margin[side], `${side} margin of ${path}`).toBeGreaterThanOrEqual(expected - 1)
      expect(margin[side], `${side} margin of ${path}`).toBeLessThanOrEqual(expected + 1)
    }
  })
})
