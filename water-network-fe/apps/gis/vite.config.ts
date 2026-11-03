import path from 'path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    server: { port: 4500, strictPort: true },
    preview: { port: 4500, strictPort: true },
    plugins: [
      tanstackRouter({
        target: 'solid',
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        autoCodeSplitting: true,
      }),
      solid(),
      isProduction &&
        visualizer({
          open: false,
          gzipSize: true,
          brotliSize: true,
          filename: 'dist/stats.html',
          template: 'treemap',
        }),
    ].filter(Boolean),
    resolve: {
      // Workspace packages consumed via file: (e.g. @wn/map-runtime) ship their
      // own node_modules/solid-js. Dedupe so the whole app shares ONE solid-js
      // (and one QueryClient runtime) — otherwise cross-package reactivity breaks.
      dedupe: ['solid-js', 'solid-js/web', 'solid-js/store', '@tanstack/solid-query'],
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@/app': path.resolve(__dirname, './src/app'),
        '@/pages': path.resolve(__dirname, './src/pages'),
        '@/widgets': path.resolve(__dirname, './src/widgets'),
        '@/features': path.resolve(__dirname, './src/features'),
        '@/entities': path.resolve(__dirname, './src/entities'),
        '@/shared': path.resolve(__dirname, './src/shared'),
        // Strip mock auth from production builds
        ...(isProduction
          ? {
              './shared/lib/mock-auth': path.resolve(
                __dirname,
                './src/shared/lib/mock-auth.prod-stub.ts',
              ),
            }
          : {}),
      },
    },
    build: {
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks: {
            'solid-core': ['solid-js', 'solid-js/web', 'solid-js/store'],
            router: ['@tanstack/solid-router'],
            query: ['@tanstack/solid-query'],
            'ui-kobalte': ['@kobalte/core'],
            forms: ['@modular-forms/solid', 'zod'],
            auth: ['keycloak-js'],
          },
        },
      },
    },
  }
})
