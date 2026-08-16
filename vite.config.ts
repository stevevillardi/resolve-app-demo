import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * NOT used by the app itself — electron-vite reads electron.vite.config.ts,
 * not this file. This exists solely because the shadcn/ui CLI's framework
 * detection doesn't recognize electron-vite's config filename and needs a
 * conventional vite.config.ts to identify the project as Vite + verify the
 * Tailwind/alias setup before `shadcn add ...` will run. Keep the alias/
 * plugin config here in sync with electron.vite.config.ts's renderer block.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()]
})
