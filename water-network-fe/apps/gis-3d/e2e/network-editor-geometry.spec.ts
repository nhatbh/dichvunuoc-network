import { test, expect, type Page } from '@playwright/test'
import type { Asset, Edit, Revision, State } from '../src/pages/gis/network-editor/model'

// Coordinates in projected metres make pointer destinations and delta assertions deterministic.
const R = 6378137
const origin = [11800000, 1200000]
const geographic = ([x, y]: number[]): [number, number] => [
  ((x / R) * 180) / Math.PI,
  ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
]
const projected = ([x, y]: number[]) => [
  ((x * Math.PI) / 180) * R,
  Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360)) * R,
]
const xy = (x: number, y: number) => geographic([origin[0] + x, origin[1] + y])
const line = [xy(-200, 0), xy(200, 0)]
const multi = [xy(-200, 0), xy(-100, 100), xy(100, 100), xy(200, 0)]
function asset(
  id: string,
  kind: Asset['kind'],
  coordinates: [number, number][],
  refs: [string | null, string | null] = [null, null]
): Asset {
  return {
    draftAssetId: id,
    clientRef: id,
    assetCode: id,
    kind,
    geometry: { type: kind === 'Pipe' ? 'LineString' : 'Point', coordinates },
    attributes: {},
    fromRef: refs[0],
    toRef: refs[1],
    hostRef: null,
  }
}
async function fixture(page: Page) {
  const assets = [
    asset('n1', 'Node', [line[0]]),
    asset('n2', 'Node', [line[1]]),
    asset('n3', 'Node', [xy(0, 100)]),
    asset('p1', 'Pipe', line, ['n1', 'n2']),
    asset('p2', 'Pipe', multi, ['n1', 'n2']),
  ]
  const state: State = Object.fromEntries(assets.map(a => [a.assetCode, { asset: a, version: 1 }]))
  let revision: Revision = { id: 'geometry-fixture', version: 1, status: 'Draft', operations: [] }
  const saves: { expectedVersion: number; operations: Edit[] }[] = []
  await page.route('**/config.json', route =>
    route.fulfill({
      json: {
        apiUrl: '/api/gis',
        gisDataSource: 'canonical',
        gisViewerMode: 'rich',
        organization: { context: 'optional' },
        flags: { newEditor: true },
      },
    })
  )
  await page.route('**/api/gis/editor/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      expect(body.expectedVersion).toBe(revision.version)
      saves.push(body)
      revision = { ...revision, version: revision.version + 1, operations: body.operations }
      await route.fulfill({ json: { ...revision, errors: [] } })
    } else
      await route.fulfill({
        json: path.endsWith('/assets')
          ? state
          : path.endsWith('/revisions')
            ? [{ ...revision, updatedAt: '2026-10-14T00:00:00Z' }]
            : revision,
      })
  })
  // Cookie-session fixture supplies an explicit tenant, which local mock auth lacks.
  const session = {
    user: {
      id: 'geometry-user',
      email: 'demo@example.com',
      tenantId: 'geometry-tenant',
      organizationAlias: 'geometry_tenant',
      permissions: ['network-design:write'],
      roles: ['user'],
    },
    session: { token: 'session-cookie', expiresAt: Date.now() + 3600000 },
  }
  await page.route('**/api/gis/auth/**', route =>
    route.fulfill({
      json: route.request().url().endsWith('/csrf') ? { csrfToken: 'fixture-csrf' } : session,
    })
  )
  await page.goto('/gis#editor')
  await page.getByLabel('Mở bản nháp biên tập').selectOption(revision.id)
  await expect(page.getByRole('button', { name: 'Lưu nháp', exact: true })).toBeEnabled()
  return { saves, state }
}
async function select(page: Page, id: string) {
  await page.getByLabel('Chọn đối tượng mạng').selectOption(id)
  await page.getByRole('button', { name: 'Sửa đỉnh', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Nút đầu', exact: true })).toHaveValue('n1')
  await expect(page.getByRole('combobox', { name: 'Nút cuối', exact: true })).toHaveValue('n2')
}
async function pixel(page: Page, points: number[][], point: number[]) {
  const box = (await page.getByLabel('Bản đồ biên tập mạng').boundingBox())!
  const p = points.map(projected),
    q = projected(point)
  const minX = Math.min(...p.map(a => a[0])),
    maxX = Math.max(...p.map(a => a[0]))
  const minY = Math.min(...p.map(a => a[1])),
    maxY = Math.max(...p.map(a => a[1]))
  const resolution = Math.max(
    (maxX - minX) / (box.width - 140),
    (maxY - minY) / (box.height - 140),
    156543.03392804097 / 2 ** 20
  )
  return {
    x: box.x + box.width / 2 + (q[0] - (minX + maxX) / 2) / resolution,
    y: box.y + box.height / 2 - (q[1] - (minY + maxY) / 2) / resolution,
  }
}
async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  cancel = false
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}
async function save(page: Page, saves: { operations: Edit[] }[]) {
  const count = saves.length
  await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
  await expect.poll(() => saves.length).toBe(count + 1)
  await expect(page.getByRole('button', { name: 'Lưu nháp', exact: true })).toBeEnabled()
  return saves.at(-1)!.operations
}
function pipe(operations: Edit[], id: string) {
  return operations.find(e => e.targetId === id)?.after!.geometry.coordinates
}

// Strict segment interiors exclude shared endpoint contacts and collinear overlap.
function transverseIntersections(first: number[][], second: number[][]) {
  const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0]
  const intersections: number[][] = []
  const a = first.map(projected),
    b = second.map(projected)
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const r = [a[i + 1][0] - a[i][0], a[i + 1][1] - a[i][1]]
      const v = [b[j + 1][0] - b[j][0], b[j + 1][1] - b[j][1]]
      const denominator = cross(r, v)
      if (Math.abs(denominator) < 1e-8) continue
      const offset = [b[j][0] - a[i][0], b[j][1] - a[i][1]]
      const t = cross(offset, v) / denominator,
        u = cross(offset, r) / denominator
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6)
        intersections.push([a[i][0] + t * r[0], a[i][1] + t * r[1]])
    }
  }
  return intersections
}

test('canonical canvas geometry gestures preserve topology and survive revision reopen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 })
  const { saves } = await fixture(page)
  await select(page, 'p1')
  await page.getByRole('checkbox', { name: 'Bắt điểm nút' }).uncheck()
  const endpoint = await pixel(page, line, line[0])
  await drag(page, endpoint, 30, -30)
  await drag(page, await pixel(page, line, line[1]), -30, -30)
  expect(await save(page, saves)).toEqual([])
  // Dragging the midpoint inserts a real vertex; endpoint handles remain locked.
  const midpoint = await pixel(page, line, xy(0, 0))
  // Public canvas rendering: the midpoint handle visibly appears when the vertex tool activates.
  const clip = { x: midpoint.x - 12, y: midpoint.y - 12, width: 24, height: 24 }
  await page.getByRole('button', { name: 'Chọn', exact: true }).click()
  const withoutHandle = await page.screenshot({ clip })
  await page.getByRole('button', { name: 'Sửa đỉnh', exact: true }).click()
  expect(await page.screenshot({ clip })).not.toEqual(withoutHandle)
  await drag(page, midpoint, 0, -60)
  let operations = await save(page, saves)
  let coords = pipe(operations, 'p1')!
  expect(coords).toHaveLength(3)
  expect(coords[0]).toEqual(line[0])
  expect(coords.at(-1)).toEqual(line[1])
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  expect(await save(page, saves)).toEqual([])
  await page.getByRole('button', { name: 'Làm lại', exact: true }).click()
  expect(pipe(await save(page, saves), 'p1')).toEqual(coords)
  // View stays at original fitted extent after a gesture.
  const vertex = { x: midpoint.x, y: midpoint.y - 60 }
  await drag(page, vertex, 25, -20)
  coords = pipe(await save(page, saves), 'p1')!
  expect(coords).toHaveLength(3)
  await page.mouse.click(vertex.x + 25, vertex.y - 20)
  await expect(page.getByRole('button', { name: 'Xóa đỉnh', exact: true })).toBeEnabled()
  await page.keyboard.down('Alt')
  await page.mouse.click(vertex.x + 25, vertex.y - 20)
  await page.keyboard.up('Alt')
  expect(pipe(await save(page, saves), 'p1')).toEqual(line)
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  expect(pipe(await save(page, saves), 'p1')).toEqual(coords)
  await page.getByRole('button', { name: 'Làm lại', exact: true }).click()
  expect(pipe(await save(page, saves), 'p1')).toEqual(line)
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  await page.mouse.click(vertex.x + 25, vertex.y - 20)
  await page.getByRole('button', { name: 'Xóa đỉnh', exact: true }).click()
  expect(pipe(await save(page, saves), 'p1')).toEqual(line)
  await page.getByRole('button', { name: 'Kéo đoạn', exact: true }).click()
  await drag(page, midpoint, 0, -40, true)
  expect(pipe(await save(page, saves), 'p1')).toEqual(line)
  await page.getByRole('button', { name: 'Kéo đoạn', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Bắt điểm nút' }).check()
  const snapTarget = await pixel(page, line, xy(0, 100))
  await drag(page, midpoint, 4, snapTarget.y - midpoint.y + 4)
  coords = pipe(await save(page, saves), 'p1')!
  expect(coords).toHaveLength(4)
  expect(coords[0]).toEqual(line[0])
  expect(coords[3]).toEqual(line[1])
  const a = projected(coords[1]),
    b = projected(coords[2]),
    start = projected(line[0]),
    end = projected(line[1])
  expect(a[0] - start[0]).toBeCloseTo(b[0] - end[0], 5)
  expect(a[1] - start[1]).toBeCloseTo(b[1] - end[1], 5)
  expect((a[0] + b[0]) / 2).toBeCloseTo(origin[0], 5)
  expect((a[1] + b[1]) / 2).toBeCloseTo(origin[1] + 100, 5)
  await select(page, 'p2')
  await page.getByRole('button', { name: 'Kéo đoạn', exact: true }).click()
  const middle = await pixel(page, multi, xy(0, 100))
  await page.getByRole('checkbox', { name: 'Bắt điểm nút' }).check()
  await drag(page, middle, 4, -4)
  operations = await save(page, saves)
  // Snap anchors to n3: a sub-tolerance snapped gesture must remain a no-op.
  expect(pipe(operations, 'p2')).toBeUndefined()
  await page.getByRole('checkbox', { name: 'Bắt điểm nút' }).uncheck()
  const crossing = await pixel(page, multi, xy(0, 150))
  await drag(page, middle, crossing.x - middle.x, crossing.y - middle.y)
  operations = await save(page, saves)
  const edited = pipe(operations, 'p2')!
  expect(edited).toHaveLength(4)
  expect(edited[0]).toEqual(multi[0])
  expect(edited[3]).toEqual(multi[3])
  const movedA = projected(edited[1]),
    movedB = projected(edited[2])
  expect(movedA[1]).toBeGreaterThan(origin[1] + 100)
  expect(movedA[0] - projected(multi[1])[0]).toBeCloseTo(movedB[0] - projected(multi[2])[0], 5)
  expect(movedA[1] - projected(multi[1])[1]).toBeCloseTo(movedB[1] - projected(multi[2])[1], 5)
  const intersections = transverseIntersections(pipe(operations, 'p1')!, edited)
  expect(intersections).toHaveLength(2)
  for (const intersection of intersections) {
    expect(intersection[1]).toBeCloseTo(origin[1] + 100, 5)
    expect(intersection[0]).toBeGreaterThan(origin[0] - 200)
    expect(intersection[0]).toBeLessThan(origin[0] + 200)
  }
  console.log('Transverse interior intersections (EPSG:3857):', JSON.stringify(intersections))
  await testInfo.attach('transverse-intersections.json', {
    body: JSON.stringify({ intersections, p1: pipe(operations, 'p1'), p2: edited }),
    contentType: 'application/json',
  })
  expect(operations.every(e => e.kind === 'Pipe')).toBe(true)
  for (const operation of operations) {
    expect(operation.after?.fromRef).toBe('n1')
    expect(operation.after?.toRef).toBe('n2')
    expect(operation.expectedVersion).toBe(1)
  }
  await page.reload()
  await page.getByLabel('Mở bản nháp biên tập').selectOption('geometry-fixture')
  await expect(page.getByRole('button', { name: 'Lưu nháp', exact: true })).toBeEnabled()
  await select(page, 'p2')
  expect(pipe(await save(page, saves), 'p2')).toEqual(edited)
  await page.getByRole('button', { name: 'Phóng to', exact: true }).click()
  await page.getByRole('button', { name: 'Thu nhỏ', exact: true }).click()
  const map = (await page.getByLabel('Bản đồ biên tập mạng').boundingBox())!
  await drag(page, { x: map.x + 30, y: map.y + 30 }, 50, 20)
  expect(pipe(await save(page, saves), 'p2')).toEqual(edited)
  await select(page, 'p2')
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  await page.screenshot({ path: testInfo.outputPath('network-editor-geometry.png') })
})
