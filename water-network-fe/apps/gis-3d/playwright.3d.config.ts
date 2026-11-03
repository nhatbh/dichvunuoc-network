import { defineConfig, devices } from '@playwright/test'

/**
 * E2E for the 3D map, run against a *built* (minified) bundle served by `vite preview` —
 * not the dev server — so bundling problems (workers, CSS, chunking) show up here.
 *
 *   npm run test:e2e:3d
 *
 * Mode `e2e` = production build + mock auth + test hooks (see .env.e2e). Data comes from
 * `e2e/.generated/full.json`, served by the tests (e2e/helpers/open-map.ts); no backend needed.
 * Chromium only: the 3D map needs WebGL, forced here onto the software renderer so CI without a GPU works.
 *
 * To smoke-test a deployed environment instead, see e2e/prod-smoke.spec.ts (`E2E_PROD_URL`).
 */
const PORT = 4174

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/map-3d*.spec.ts', '**/prod-smoke.spec.ts'],
  fullyParallel: false, // software WebGL is CPU-bound; keep runs deterministic
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-3d', open: 'never' }]],
  globalSetup: './e2e/helpers/global-setup.ts',
  use: {
    baseURL: process.env.E2E_PROD_URL || `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1360, height: 840 },
    launchOptions: {
      // CI images or sandboxes whose installed Chromium differs from Playwright's pinned build
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 840 } } }],
  webServer: process.env.E2E_PROD_URL
    ? undefined
    : {
        command: `npm run build:e2e && npx vite preview --mode e2e --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: process.env.PW_REUSE_EXISTING_SERVER === '1',
        timeout: 300_000,
      },
})
