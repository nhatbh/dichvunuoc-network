import { readFileSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type PluginOption } from 'vite'
import { workspaceAliases } from './workspace-aliases'
import solid from 'vite-plugin-solid'

/**
 * `--mode stack`: the app against the backend services running on this machine.
 * /api/gis is proxied to the BFF with a backend dev JWT (the mock login has no real token),
 * and /config.json comes from deploy/local-stack/config.json. Dev server only.
 */
async function localStack(): Promise<PluginOption> {
  // plain .mjs shared with the seed script; generated per dev-server start
  const { devToken } = (await import(pathToFileURL(path.resolve(__dirname, 'scripts/local-stack/dev-token.mjs')).href)) as {
    devToken: () => string
  }
  const token = devToken()
  const config = readFileSync(path.resolve(__dirname, 'deploy/local-stack/config.json'))
  return {
    name: 'wn-local-stack',
    configureServer(server) {
      server.middlewares.use('/config.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(config)
      })
    },
    config: () => ({
      server: {
        proxy: {
          '/api/gis': {
            target: process.env.WN_BFF_URL ?? 'http://localhost:8083',
            changeOrigin: true,
            configure: proxy => proxy.on('proxyReq', req => req.setHeader('Authorization', `Bearer ${token}`)),
          },
        },
      },
    }),
  }
}

export default defineConfig(async ({ mode, command }) => {
  const isProduction = mode === 'production'
  const localStackPlugin = mode === 'stack' && command === 'serve' ? await localStack() : null
  // Dev server reads the 3D runtime from source, so edits (and pnpm's install-time copy of
  // the package) can never leave the app running a stale dist/.
  const runtime3dSrc = path.resolve(__dirname, '../../packages/map-runtime-3d/src')

  return {
    server: { port: 4600, strictPort: true },
    // Local workspace packages are served from source (aliases below), never pre-bundled: a cached
    // pre-bundle in node_modules/.vite would keep serving an old build. three is still pre-bundled.
    optimizeDeps: {
      exclude: ['@wn/component-models', '@wn/contracts'],
      include: ['@wn/map-runtime-3d > @wn/component-models > three'],
    },
    preview: { port: 4600, strictPort: true },
    plugins: [
      tanstackRouter({
        target: 'solid',
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        autoCodeSplitting: true,
      }),
      solid(),
      localStackPlugin,
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
      alias: [
        // @wn/contracts and @wn/component-models from source (see workspace-aliases.ts)
        ...workspaceAliases(__dirname),
        ...Object.entries({
        // map-runtime-3d from source too: its installed copy goes stale the same way
        '@wn/map-runtime-3d/solid': `${runtime3dSrc}/solid/use-map-runtime.ts`,
        '@wn/map-runtime-3d': `${runtime3dSrc}/index.ts`,
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
                './src/shared/lib/mock-auth.prod-stub.ts'
              ),
            }
          : {}),
        }).map(([find, replacement]) => ({ find, replacement })),
      ],
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
