import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public', 'scratch', 'scripts']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        URL: 'readonly',
      },
    },
    rules: {
      'no-empty': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.vite.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '**/lib/db',
              '**/lib/db.ts',
              '**/lib/repository',
              '**/lib/repository.ts',
              '@/lib/db',
              '@/lib/repository',
            ],
            message: 'Acesso direto ao banco pelo frontend foi removido. Use src/lib/api.ts e rotas do BFF.',
          },
        ],
      }],
    },
  },
])
