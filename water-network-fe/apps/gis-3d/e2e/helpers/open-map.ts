import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { loginAsMockDemoUser } from './mock-login'

const HERE = dirname(fileURLToPath(import.meta.url))

const SEED = () => readFileSync(resolve(HERE, '../.generated/full.json'), 'utf8')

export interface MapProbe {
  getView(): { center: { lon: number; lat: number }; zoom: number }
  setView(v: { center?: { lon: number; lat: number }; zoom?: number }, o?: { animate?: boolean }): void
  getCamera(): { pitch: number; bearing: number }
  setCamera(c: { pitch?: number; bearing?: number }, o?: { animate?: boolean }): void
  getFlowAnimation(): boolean
  getBuildings(): boolean
  getTerrain(): { enabled: boolean }
  getVisibleBbox(): [number, number, number, number]
}
declare global {
  interface Window {
    __networkMap?: MapProbe
  }
}

/** Errors worth failing a test for: everything except unreachable third-party basemap tiles / fonts. */
const IGNORED = /basemaps|cartocdn|tile|fonts\.(googleapis|gstatic)|ERR_(TUNNEL|CONNECTION|NAME|INTERNET|FAILED|BLOCKED)|Failed to load resource|AJAXError|WebGL.*(swiftshader|performance)|GPU stall|GL Driver/i

export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error' && !IGNORED.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`)
  })
  return errors
}

/** Serve runtime config + the Hanoi network from the test process (the build has no MSW). */
export async function stubBackend(page: Page): Promise<string[]> {
  const unhandled: string[] = []
  await page.route('**/config.json', async route => {
    const real = (await (await route.fetch()).json()) as Record<string, unknown>
    const origin = new URL(page.url() === 'about:blank' ? route.request().url() : page.url()).origin
    await route.fulfill({ json: { ...real, apiUrl: `${origin}/api/gis`, gisDataSource: 'legacy', gisViewerMode: 'rich' } })
  })
  await page.route('**/api/gis/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/full')) return route.fulfill({ contentType: 'application/json', body: SEED() })
    unhandled.push(`${route.request().method()} ${url.pathname}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  return unhandled
}

/** Sign in (mock auth), open the map workspace and wait until the 3D engine is live. */
export async function openMap(page: Page): Promise<void> {
  await loginAsMockDemoUser(page)
  await page.goto('/gis')
  await page.getByText('Mở bản đồ').first().click()
  await page.waitForFunction(() => !!window.__networkMap, null, { timeout: 60_000 })
  await expect(page.getByTestId('map-3d-controls')).toBeVisible()
  await page.waitForTimeout(1500)
}

/** Run `fn` in the page against the live engine (`fn` must be self-contained; pass data via `arg`). */
export function probe<T, A = undefined>(page: Page, fn: (m: MapProbe, arg: A) => T, arg?: A): Promise<T> {
  return page.evaluate(({ src, a }) => (0, eval)(`(${src})`)(window.__networkMap, a), { src: fn.toString(), a: arg }) as Promise<T>
}

/** Keep the current centre, change only the zoom. */
export const setZoom = (page: Page, zoom: number) => probe(page, (m, z) => m.setView({ center: m.getView().center, zoom: z }, { animate: false }), zoom)

/** The generated Hanoi payload, for picking known pipes. */
export function loadSeed(): { pipes: Array<{ id: string; code: string; dn: number; pts: number[][] }>; geo: { bbox: number[]; inset: number; unitsToMeters: number; metersPerDegreeLon: number; metersPerDegreeLat: number } } {
  return JSON.parse(SEED())
}

/** Pixel-plane point → lon/lat, the same affine the app uses (`gisPixelToLonLat` in gis-data.tsx). */
export function pxToLonLat(geo: ReturnType<typeof loadSeed>['geo'], x: number, y: number): { lon: number; lat: number } {
  return { lon: geo.bbox[0]! + ((x - geo.inset) * geo.unitsToMeters) / geo.metersPerDegreeLon, lat: geo.bbox[3]! - ((y - geo.inset) * geo.unitsToMeters) / geo.metersPerDegreeLat }
}

/** Screen position (page coordinates) of a lon/lat on a flat, north-up map, from the engine's visible bbox. */
export async function lonLatToScreen(page: Page, lon: number, lat: number): Promise<{ x: number; y: number }> {
  const [w, south, e, north] = await probe(page, m => m.getVisibleBbox())
  const box = (await page.locator('canvas').first().boundingBox())!
  const merc = (deg: number) => Math.log(Math.tan(Math.PI / 4 + (deg * Math.PI) / 360))
  return {
    x: box.x + ((lon - w) / (e - w)) * box.width,
    y: box.y + ((merc(north) - merc(lat)) / (merc(north) - merc(south))) * box.height,
  }
}
