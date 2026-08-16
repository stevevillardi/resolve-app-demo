import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
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
  eslintConfigPrettier
)
