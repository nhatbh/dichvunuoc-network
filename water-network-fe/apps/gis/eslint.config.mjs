import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import importPlugin from 'eslint-plugin-import'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import solidPlugin from 'eslint-plugin-solid'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const fsdRestrictedPaths = (target, fromLayers, message) => ({
  target: `./src/${target}`,
  from: fromLayers.map(layer => `./src/${layer}`),
  message,
})

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'playwright-report',
      'src/routeTree.gen.ts',
      '_bmad/**',
      '**/*.timestamp_*.js',
      '**/*.timestamp-*.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      solid: solidPlugin,
      import: importPlugin,
      boundaries,
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/**' },
        { type: 'pages', pattern: 'src/pages/**' },
        { type: 'widgets', pattern: 'src/widgets/**' },
        { type: 'features', pattern: 'src/features/*', mode: 'folder', capture: ['feature'] },
        { type: 'entities', pattern: 'src/entities/*', mode: 'folder', capture: ['entity'] },
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'routes', pattern: 'src/routes/**' },
        { type: 'bootstrap', pattern: 'src/bootstrap.ts' },
      ],
    },
    rules: {
      ...solidPlugin.configs.typescript.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling'],
            'index',
            'object',
            'type',
          ],
          pathGroups: [
            { pattern: 'solid-js', group: 'external', position: 'before' },
            { pattern: '@/app/**', group: 'internal', position: 'after' },
            { pattern: '@/pages/**', group: 'internal', position: 'after' },
            { pattern: '@/widgets/**', group: 'internal', position: 'after' },
            { pattern: '@/features/**', group: 'internal', position: 'after' },
            { pattern: '@/entities/**', group: 'internal', position: 'after' },
            { pattern: '@/shared/**', group: 'internal', position: 'after' },
          ],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-unresolved': 'error',
      'import/no-duplicates': 'warn',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: ['shared'], allow: [] },
            { from: ['entities'], allow: ['shared'] },
            {
              from: ['features'],
              allow: [
                'shared',
                'entities',
                ['features', { feature: '${from.feature}' }],
              ],
            },
            { from: ['pages'], allow: ['shared', 'entities', 'features', 'widgets'] },
            { from: ['widgets'], allow: ['shared', 'entities', 'features'] },
            { from: ['app'], allow: ['shared', 'entities'] },
            { from: ['routes'], allow: ['shared', 'pages', 'entities', 'features'] },
            { from: ['bootstrap'], allow: ['shared'] },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            fsdRestrictedPaths(
              'shared',
              ['entities', 'features', 'pages', 'app', 'widgets'],
              'shared layer cannot import upper FSD layers'
            ),
          ],
        },
      ],
    },
  },
  {
    files: ['src/entities/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            fsdRestrictedPaths(
              'entities',
              ['features', 'pages', 'app', 'widgets'],
              'entities cannot import features, pages, or app'
            ),
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            fsdRestrictedPaths(
              'features',
              ['pages', 'app', 'widgets'],
              'features cannot import pages or app'
            ),
          ],
        },
      ],
    },
  },
  {
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            fsdRestrictedPaths('pages', ['app'], 'pages cannot import app layer'),
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.config.{ts,js,mjs}', 'postcss.config.js', 'e2e/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'boundaries/element-types': 'off',
      'import/no-restricted-paths': 'off',
    },
  },
  eslintConfigPrettier,
)
