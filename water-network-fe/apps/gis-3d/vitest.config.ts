import path from 'path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'solid',
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    solid(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // The http-client builds `fullUrl = VITE_API_URL + path`. With an empty base
    // (the dev default) requests are relative; @mswjs/interceptors' fetch shim
    // rejects relative URLs in the Node test realm (ERR_INVALID_URL). Give tests
    // an absolute origin so requests are well-formed — MSW handlers match by
    // `*/path` wildcard, and production always resolves a real VITE_API_URL.
    env: { VITE_API_URL: 'http://localhost:3000' },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    server: {
      deps: {
        inline: [/solid-js/, /@solidjs\/testing-library/, /@wn\/map-runtime(-3d)?/, /@tanstack\/solid-query/, /@solid-primitives/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 40,
        lines: 50,
      },
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        '**/routeTree.gen.ts',
        '**/index.ts',
      ],
    },
  },
  resolve: {
    conditions: ['development', 'browser'],
    alias: {
      // Force all packages (including symlinked workspace deps) to share the
      // same solid-js instance in tests; without this, map-runtime resolves
      // solid-js from its own node_modules causing "multiple instances" errors.
      'solid-js': path.resolve(__dirname, 'node_modules/solid-js'),
      'solid-js/web': path.resolve(__dirname, 'node_modules/solid-js/web'),
      'solid-js/store': path.resolve(__dirname, 'node_modules/solid-js/store'),
      // Shared MapEnginePort test double, resolved from map-runtime source (no
      // rebuild needed; testing/ is excluded from the published dist).
      '@wn/map-runtime-3d/testing': path.resolve(
        __dirname,
        '../../packages/map-runtime-3d/src/testing/fake-port.ts',
      ),
      '@': path.resolve(__dirname, './src'),
      '@/app': path.resolve(__dirname, './src/app'),
      '@/pages': path.resolve(__dirname, './src/pages'),
      '@/widgets': path.resolve(__dirname, './src/widgets'),
      '@/features': path.resolve(__dirname, './src/features'),
      '@/entities': path.resolve(__dirname, './src/entities'),
      '@/shared': path.resolve(__dirname, './src/shared'),
    },
  },
})
