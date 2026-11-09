// Phase 0 gate check: the SYSTEM 3D app, served by `npm run dev:local-stack`, loads the network
// from the real BFF. Signs in with the mock login, opens the map, and records every /api/gis
// call, console errors and a screenshot.
//
//   node scripts/local-stack/smoke.mjs [--app http://localhost:4610] [--out <dir>]
//
// Exit code 0 = gate passed: /bootstrap and /map answered 200 from the BFF with features,
// the app shows the canonical map, topology isolates a pipe (topology-rs through the BFF,
// decision 0029), and no page errors.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const APP = arg('app', 'http://localhost:4610').replace(/\/$/, '')
const OUT = path.resolve(arg('out', 'local-stack-smoke'))
mkdirSync(OUT, { recursive: true })

const report = { app: APP, at: new Date().toISOString(), api: [], pageErrors: [], consoleErrors: [], checks: {} }
const browser = await chromium.launch(process.env.WN_CHROMIUM ? { executablePath: process.env.WN_CHROMIUM } : {})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => report.pageErrors.push(String(e)))
  page.on('console', (m) => {
    // basemap tiles from the internet are not part of the gate
    if (m.type() === 'error' && !/tile|arcgisonline|maptiler|openstreetmap|ERR_TUNNEL|ERR_FAILED|Failed to load resource/i.test(m.text()))
      report.consoleErrors.push(m.text())
  })
  page.on('response', async (r) => {
    const u = new URL(r.url())
    if (!u.pathname.startsWith('/api/gis')) return
    const entry = { method: r.request().method(), path: u.pathname, status: r.status() }
    if (u.pathname === '/api/gis/map' && r.ok()) {
      try {
        const body = await r.json()
        entry.features = body.features?.length ?? 0
        entry.kinds = {}
        for (const f of body.features ?? []) {
          const k = f.properties?.assetType ?? f.properties?.kind ?? f.geometry?.type
          entry.kinds[k] = (entry.kinds[k] ?? 0) + 1
          if (!report.pipeId && f.geometry?.type === 'LineString') report.pipeId = String(f.id)
        }
      } catch { /* body not JSON: keep the status only */ }
    }
    if (u.pathname === '/api/gis/bootstrap' && r.ok()) {
      try { entry.counts = (await r.json()).counts } catch { /* keep the status only */ }
    }
    report.api.push(entry)
  })

  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' })
  const email = page.locator('input[type=email], input[name=email]')
  if (await email.count()) {
    await email.first().fill('demo@example.com')
    await page.locator('input[type=password]').first().fill('password123')
    await page.locator('button[type=submit]').first().click()
  }
  await page.waitForURL(/\/gis/, { timeout: 20_000 }).catch(() => {})
  await page.waitForResponse((r) => new URL(r.url()).pathname === '/api/gis/map', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(5000)
  await page.screenshot({ path: path.join(OUT, 'map.png') })
  report.url = page.url()
  // isolation through the dev server's /api/gis proxy (it adds the dev token)
  report.topology = report.pipeId
    ? await page.evaluate(async (pipeId) => {
        const r = await fetch('/api/gis/topology/isolation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pipeId }),
        })
        const body = await r.json().catch(() => null)
        return { status: r.status, graphReady: body?.graphReady, isolatedPipes: body?.isolatedPipes?.length, valvesToClose: body?.valvesToClose?.length }
      }, report.pipeId)
    : null

  const boot = report.api.find((a) => a.path === '/api/gis/bootstrap')
  const map = report.api.filter((a) => a.path === '/api/gis/map')
  report.checks = {
    signedIn: /\/gis/.test(page.url()),
    bootstrap200: boot?.status === 200,
    bootstrapHasData: (boot?.counts?.total ?? 0) > 0,
    map200: map.length > 0 && map.every((m) => m.status === 200),
    mapHasFeatures: map.some((m) => (m.features ?? 0) > 0),
    topologyIsolates: report.topology?.status === 200 && report.topology.graphReady === true && report.topology.isolatedPipes > 0,
    noPageErrors: report.pageErrors.length === 0,
  }
} finally {
  await browser.close()
}

report.passed = Object.values(report.checks).every(Boolean)
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, api: report.api }, null, 2))
process.exit(report.passed ? 0 : 1)
