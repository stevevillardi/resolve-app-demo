/**
 * Rasterises the checked-in SVG icon sources into the PNGs Electron and
 * electron-builder actually load.
 *
 * Usage:
 *   npm run icons
 *
 * The PNGs are committed, not built on demand: `electron-vite` resolves them
 * through `?asset` at bundle time and electron-builder reads build/icon.png
 * before any script of ours runs, so a generated-at-package-time asset would
 * have to exist already anyway. This script is how they get regenerated when
 * the SVG changes — do not hand-edit the PNGs.
 *
 * Chromium (via the Playwright browser already installed for the E2E suite) is
 * the rasteriser because it is the one SVG engine this project is guaranteed to
 * have. macOS ships no `rsvg-convert`, `sips` cannot read SVG, and adding
 * `sharp` would mean a native dependency for six files that change once a year.
 *
 * Every size is rendered from the vector at that size rather than downscaled
 * from the largest, which is the difference between a crisp 16px tray icon and
 * a grey smudge.
 *
 * Deliberately not generated: build/icon.icns and build/icon.ico.
 * electron-builder derives both from build/icon.png (1024x1024 is its preferred
 * input), and a hand-rolled ICO writer is a corrupt-file risk with nothing to
 * gain.
 */

import { chromium, type Browser } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..')

interface Target {
  /** SVG source, relative to the repository root. */
  from: string
  /** PNG output, relative to the repository root. */
  to: string
  /** Rendered edge length in pixels; the source is assumed square. */
  size: number
}

const TARGETS: Target[] = [
  // electron-builder's input for every packaged platform icon.
  { from: 'resources/icon.svg', to: 'build/icon.png', size: 1024 },
  // The BrowserWindow `icon` on Linux, where the WM wants a real image rather
  // than a bundle resource (src/main/index.ts).
  { from: 'resources/icon.svg', to: 'resources/icon.png', size: 512 },
  // Menu bar, both scale factors. tray.ts adds these as explicit
  // representations, so the @2x name is documentation rather than a lookup key.
  { from: 'resources/tray-idle.svg', to: 'resources/trayTemplate.png', size: 16 },
  { from: 'resources/tray-idle.svg', to: 'resources/trayTemplate@2x.png', size: 32 },
  { from: 'resources/tray-active.svg', to: 'resources/trayActiveTemplate.png', size: 16 },
  { from: 'resources/tray-active.svg', to: 'resources/trayActiveTemplate@2x.png', size: 32 }
]

async function render(browser: Browser, svg: string, size: number): Promise<Buffer> {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1
  })
  try {
    // The SVG is inlined rather than loaded as an <img> so its own width/height
    // attributes cannot win over the size we are asking for, and so a data: URI
    // does not have to be escaped. `overflow: hidden` on the page keeps a
    // stroke that grazes the edge from adding a scrollbar and shifting layout.
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
         svg { display: block; width: ${size}px; height: ${size}px; }
       </style>
       ${svg}`,
      { waitUntil: 'load' }
    )
    return await page.screenshot({ omitBackground: true, type: 'png' })
  } finally {
    await page.close()
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    for (const target of TARGETS) {
      const svg = readFileSync(resolve(ROOT, target.from), 'utf8')
      const png = await render(browser, svg, target.size)
      writeFileSync(resolve(ROOT, target.to), png)
      console.log(`${target.to.padEnd(38)} ${target.size}x${target.size}  ${png.length} bytes`)
    }
  } finally {
    await browser.close()
  }

  console.log(
    '\nbuild/icon.icns and build/icon.ico are derived by electron-builder from build/icon.png.'
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
