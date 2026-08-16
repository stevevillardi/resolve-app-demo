import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // electron-vite exposes only MAIN_VITE_-prefixed vars to the main process
    // by default. `GITHUB_` is allowed too so a plain GITHUB_CLIENT_ID in .env
    // works without a rename — see .env.example. Nothing secret is inlined:
    // the device-flow client ID has no accompanying client secret, and real
    // credentials live in the OS keychain (src/main/services/secrets.ts).
    envPrefix: ['MAIN_VITE_', 'GITHUB_']
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // shadcn/ui's CLI and generated components expect a plain `@/*` alias.
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
