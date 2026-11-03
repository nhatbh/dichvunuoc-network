import { expect, test } from '@playwright/test'
import { collectErrors, loadSeed, lonLatToScreen, openMap, probe, pxToLonLat, setZoom, stubBackend } from './helpers/open-map'

test.describe('3D network map (production bundle)', () => {
  let errors: string[]
  let unhandled: string[]

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page)
    unhandled = await stubBackend(page)
    await openMap(page)
  })

  test.afterEach(() => {
    expect(errors, 'no page or console errors').toEqual([])
  })

  test('opens on central Hanoi with the whole network loaded', async ({ page }) => {
    const view = await probe(page, m => m.getView())
    expect(view.center.lat).toBeGreaterThan(21.0)
    expect(view.center.lat).toBeLessThan(21.06)
    expect(view.center.lon).toBeGreaterThan(105.82)
    expect(view.center.lon).toBeLessThan(105.89)
    // the counters above the map: pipes / valves / connections
    await expect(page.getByText(/Ống\s*[\d.]{3,}/).first()).toBeVisible()
    await expect(page.getByText('6 đối tượng').first()).toBeVisible() // six DMAs
  })

  test('renders pipes on the WebGL canvas', async ({ page }) => {
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box!.width).toBeGreaterThan(400)
    expect(box!.height).toBeGreaterThan(300)
    // the map must show something other than a flat background
    const shot = await page.screenshot({ clip: { x: box!.x, y: box!.y, width: box!.width, height: box!.height } })
    expect(new Set(shot).size).toBeGreaterThan(40)
  })

  test('toggles between 2D and 3D and tilts the camera', async ({ page }) => {
    const controls = page.getByTestId('map-3d-controls')
    const initial = await probe(page, m => m.getCamera().pitch)

    await controls.getByTitle('Nghiêng thêm').click()
    await expect.poll(() => probe(page, m => m.getCamera().pitch)).toBeGreaterThan(initial)

    await controls.getByTitle('Nghiêng bớt').click()
    await controls.getByTitle('Nghiêng bớt').click()
    await expect.poll(() => probe(page, m => m.getCamera().pitch)).toBeLessThan(initial + 1)

    await probe(page, m => m.setCamera({ pitch: 55 }, { animate: false }))
    await controls.getByTitle('Chuyển về 2D').click()
    await expect.poll(() => probe(page, m => m.getCamera().pitch)).toBe(0)
    await controls.getByTitle('Chuyển sang 3D').click()
    await expect.poll(() => probe(page, m => m.getCamera().pitch)).toBeGreaterThan(0)
  })

  test('rotates and resets north', async ({ page }) => {
    const controls = page.getByTestId('map-3d-controls')
    await controls.getByTitle('Xoay phải').click()
    await expect.poll(() => probe(page, m => m.getCamera().bearing)).not.toBe(0)
    await controls.getByTitle('Hướng Bắc').click()
    await expect.poll(async () => Math.abs(normaliseBearing(await probe(page, m => m.getCamera().bearing)))).toBeLessThan(0.5)
  })

  test('building and terrain toggles drive the engine', async ({ page }) => {
    const controls = page.getByTestId('map-3d-controls')
    const b0 = await probe(page, m => m.getBuildings())
    await controls.getByTitle('Toà nhà 3D').click()
    await expect.poll(() => probe(page, m => m.getBuildings())).toBe(!b0)
    const t0 = await probe(page, m => m.getTerrain().enabled)
    await controls.getByTitle('Địa hình').click()
    await expect.poll(() => probe(page, m => m.getTerrain().enabled)).toBe(!t0)
  })

  test('water flow animates, can be switched off, and stands still when off', async ({ page }) => {
    // flat map at street level: the flow shows as dashes sliding along the pipes
    await probe(page, m => m.setCamera({ pitch: 0, bearing: 0 }, { animate: false }))
    await setZoom(page, 16)
    const controls = page.getByTestId('map-3d-controls')
    expect(await probe(page, m => m.getFlowAnimation())).toBe(true)

    const map = page.locator('canvas').first()
    const a = await map.screenshot()
    await page.waitForTimeout(900)
    const b = await map.screenshot()
    expect(Buffer.compare(a, b), 'frames differ while flowing').not.toBe(0)

    await controls.getByTitle('Dòng chảy').click()
    await expect.poll(() => probe(page, m => m.getFlowAnimation())).toBe(false)
    // once the last animation frame and any tile fades have settled, the picture must not change any more
    await expect
      .poll(
        async () => {
          const c = await map.screenshot()
          await page.waitForTimeout(700)
          const d = await map.screenshot()
          return Buffer.compare(c, d)
        },
        { message: 'frames identical when flow is off', timeout: 20_000 }
      )
      .toBe(0)
  })

  test('flow source toggles between EPANET and pressure and keeps the water moving', async ({ page }) => {
    await probe(page, m => m.setCamera({ pitch: 0, bearing: 0 }, { animate: false }))
    await setZoom(page, 16)
    const group = page.getByTestId('flow-source')
    const epanet = group.getByRole('button', { name: /EPANET/ })
    const pressure = group.getByRole('button', { name: 'Áp suất' })
    await expect(epanet).toHaveAttribute('aria-pressed', 'true')
    // the WASM solver has loaded once the "…" loading marker is gone
    await expect(epanet).toHaveText('EPANET')
    const map = page.locator('canvas').first()
    for (const btn of [epanet, pressure, epanet]) {
      await btn.click()
      await expect(btn).toHaveAttribute('aria-pressed', 'true')
      await expect(btn).toHaveText(/EPANET|Áp suất/)
      const a = await map.screenshot()
      await page.waitForTimeout(900)
      const b = await map.screenshot()
      expect(Buffer.compare(a, b), 'frames differ while flowing').not.toBe(0)
    }
  })

  test('close-up 3D tubes render and the map zooms in to level 23, no further', async ({ page }) => {
    await probe(page, m => m.setCamera({ pitch: 60 }, { animate: false }))
    await setZoom(page, 19)
    await page.waitForTimeout(1200)
    await expect(page.locator('canvas').first()).toBeVisible()
    await setZoom(page, 40)
    const z = await probe(page, m => m.getView().zoom)
    expect(z).toBeLessThanOrEqual(23)
    expect(z).toBeGreaterThan(22)
  })

  test('panning moves the visible area and keeps the engine responsive', async ({ page }) => {
    const before = await probe(page, m => m.getVisibleBbox())
    const box = (await page.locator('canvas').first().boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 220, cy + 120, { steps: 12 })
    await page.mouse.up()
    await expect.poll(async () => (await probe(page, m => m.getVisibleBbox()))[0]).not.toBe(before[0])
  })

  test('selecting a pipe on the map opens its inspector', async ({ page }) => {
    const seed = loadSeed()
    const pipe = seed.pipes.find(p => p.dn >= 500 && p.pts.length >= 3)!
    const v = pipe.pts[Math.floor(pipe.pts.length / 2)]!
    await probe(page, m => m.setCamera({ pitch: 0, bearing: 0 }, { animate: false }))
    await probe(page, (m, c) => m.setView({ center: c, zoom: 18 }, { animate: false }), pxToLonLat(seed.geo, v[0]!, v[1]!))
    await page.waitForTimeout(1500)
    const at = pxToLonLat(seed.geo, v[0]!, v[1]!)
    const { x, y } = await lonLatToScreen(page, at.lon, at.lat)
    await page.mouse.click(x, y)
    // some pipe sits under the click (mains run in parallel here): its inspector shows the asset code
    await expect(page.getByText(/ONG_[A-Z]{2}_DN\d+/).first()).toBeVisible()
  })

  test('only requests endpoints the stub knows about', () => {
    expect(unhandled, 'unexpected backend calls').toEqual([])
  })
})

/** Bearing may come back as 0..360 or -180..180. */
function normaliseBearing(b: number): number {
  const n = ((b % 360) + 360) % 360
  return n > 180 ? n - 360 : n
}
