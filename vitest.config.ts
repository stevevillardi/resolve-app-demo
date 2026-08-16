import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Deliberately separate from vite.config.ts — that file is a decoy kept only
 * for the shadcn CLI's framework detection, and picking it up here would drag
 * in the React/Tailwind plugins these tests don't need.
 *
 * Two projects because the code under test straddles the process boundary:
 * main-process services run in node (and mock `electron`), renderer helpers
 * need a DOM for matchMedia/documentElement.
 *
 * E2E lives in e2e/ and is Playwright's, not Vitest's — see playwright.config.ts.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts']
        }
      },
      {
        resolve: {
          alias: { '@': resolve('src/renderer/src') }
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['src/main/**', 'src/shared/**', 'src/renderer/src/lib/**'],
      // Thin side-effect-only modules: procedure files are one-line
      // registrations covered via registerProcedure, and index.ts is wiring.
      exclude: ['src/main/ipc/procedures/**', 'src/main/index.ts', '**/*.d.ts']
    }
  }
})
