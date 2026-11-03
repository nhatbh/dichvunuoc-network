import { expect, test } from '@playwright/test'

/**
 * Read-only smoke test for a *deployed* environment (no login, no writes):
 *
 *   E2E_PROD_URL=https://gis.example.com npm run test:e2e:3d -- prod-smoke
 *
 * Checks the shell loads, runtime config and static assets are served, the MapLibre worker and
 * CSS are reachable and nothing throws on the login page.
 */
test.skip(!process.env.E2E_PROD_URL, 'set E2E_PROD_URL to smoke-test a deployed environment')

test('deployed app serves its shell, config and 3D assets without errors', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const failed: string[] = []
  page.on('response', r => {
    if (r.status() >= 400 && new URL(r.url()).origin === new URL(page.url() || process.env.E2E_PROD_URL!).origin) failed.push(`${r.status()} ${r.url()}`)
  })

  const res = await page.goto('/')
  expect(res!.status()).toBeLessThan(400)
  await page.waitForLoadState('networkidle')
  expect(failed, 'same-origin requests that failed').toEqual([])
  expect(errors).toEqual([])

  const cfg = await request.get('/config.json')
  expect(cfg.ok()).toBe(true)
  const html = await (await request.get('/')).text()
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]!)
  expect(assets.length).toBeGreaterThan(0)
  for (const a of assets) expect((await request.get(a)).ok(), a).toBe(true)
})
