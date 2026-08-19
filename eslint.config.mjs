import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  // build/mac-sign.js is a CommonJS hook that electron-builder `require`s at
  // package time, so it cannot be ESM and cannot carry TS annotations.
  { ignores: ['**/node_modules', '**/dist', '**/out', 'build/mac-sign.js'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // shadcn/ui-generated components (src/renderer/src/components/ui/**) are
    // vendored, not hand-written — relax the rules that conflict with their
    // standard shape (variant-config const exported alongside the component;
    // implicit return types) rather than hand-editing generated files.
    files: ['src/renderer/src/components/ui/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    // Process-boundary rule (blueprint §2): the renderer never touches the
    // filesystem, SQLite, the SDKs, or the scheduler directly — only main
    // does, reached exclusively through the IPC layer (src/shared/ipc-contract.ts).
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Matches a path SEGMENT exactly named "main" (e.g. ../../main/db,
              // ../../main), not any path merely containing the substring "main"
              // (e.g. ./assets/main.css) — those must stay importable.
              group: ['**/main', '**/main/*', '**/main/**'],
              message:
                'Renderer must not import from src/main — go through the IPC layer (src/shared/ipc-contract.ts).'
            }
          ]
        }
      ]
    }
  },
  {
    // Encryption boundary (Phase 3, blueprint §11): every safeStorage read and
    // write goes through src/main/services/secrets.ts, so the one place that
    // handles plaintext credentials stays auditable in isolation. Scattering
    // safeStorage calls is exactly what 03-app-auth.md's token-storage section
    // says not to do.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/main/services/secrets.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'safeStorage',
          message:
            'Use src/main/services/secrets.ts — it is the only permitted safeStorage boundary.'
        }
      ]
    }
  },
  eslintConfigPrettier
)
