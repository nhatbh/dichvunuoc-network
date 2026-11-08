// @vitest-environment node
/* Editor operations against the real services (design-be + gis-be through the BFF).
   Skipped unless WN_LIVE_BFF points at a running BFF with the demo network seeded, e.g.
     WN_LIVE_BFF=http://localhost:8083 npx vitest run src/pages/gis/editor/revision-ops.live.test.ts
   (local stack: scripts/local-stack). Saves, validates, submits and approves one revision. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { server } from '@/shared/api/mocks/server'
// @ts-expect-error -- plain .mjs helper shared with the local-stack scripts
import { devToken } from '../../../../scripts/local-stack/dev-token.mjs'
import { draftsToOperations, type Projector } from './revision-ops'
import type { Draft } from './model'
import type { Edit, Revision, State } from '../network-editor/model'

const BFF = process.env.WN_LIVE_BFF?.replace(/\/$/, '')
const proj: Projector = {
  toLonLat: (x, y) => [105.8 + x * 1e-5, 21.05 - y * 1e-5],
  toPixel: (lon, lat) => [(lon - 105.8) / 1e-5, (21.05 - lat) / 1e-5],
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: T }> {
  const token = (devToken as () => string)()
  const r = await fetch(`${BFF}/api/gis/editor${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  return { status: r.status, json: (text ? JSON.parse(text) : null) as T }
}

describe.skipIf(!BFF)('editor operations on the real design-be (live)', () => {
  // the test setup answers /editor/* with the mock service; this test talks to the real one
  beforeAll(() => server.close())
  afterAll(() => server.listen({ onUnhandledRequest: 'bypass' }))

  it('saves, validates, submits and approves drafts built by the editor bridge', async () => {
    const base = (await call<State>('/assets')).json
    const pipes = Object.entries(base).filter(([, v]) => v.asset.kind === 'Pipe')
    expect(pipes.length).toBeGreaterThan(2)
    const [splitId, split] = pipes[0]!
    const [modId, mod] = pipes[1]!
    const end = base[split.asset.toRef!]!.asset.geometry.coordinates[0]!
    const [ex, ey] = proj.toPixel(end[0], end[1])
    const mid = split.asset.geometry.coordinates
    const [sx, sy] = proj.toPixel((mid[0]![0] + mid[1]![0]) / 2, (mid[0]![1] + mid[1]![1]) / 2)
    const stamp = Date.now().toString(36).toUpperCase()
    const drafts: Draft[] = [
      // a new pipe from an existing node out to open ground (a junction is added at the far end)
      { id: `L${stamp}-1`, op: 'add', kind: 'pipe', geom: 'line', pts: [[ex + 0.3, ey], [ex + 40, ey + 25]], dn: 150, material: 'Gang dẻo', year: 2026, cond: 'good', trunk: false, dma: 'DMA-01', eam: null },
      { id: `L${stamp}-2`, op: 'add', kind: 'valve', geom: 'point', x: ex + 20, y: ey + 12.5, dn: 150, vkind: 'gate', state: 'open', dma: 'DMA-01', eam: null, onPipe: `L${stamp}-1` },
      { id: `L${stamp}-3`, op: 'add', kind: 'hydrant', geom: 'point', x: ex + 41, y: ey + 26, dma: 'DMA-01', htype: 'pillar', eam: null },
      // a node dropped on a published pipe splits it
      { id: `L${stamp}-4`, op: 'add', kind: 'node', geom: 'point', x: sx, y: sy, dma: 'DMA-01', ntype: 'Nút tách', z: 10, eam: null, splitOf: splitId },
      // a published pipe re-sized
      { id: `L${stamp}-5`, op: 'mod', baseId: modId, kind: 'pipe', geom: 'line', pts: mod.asset.geometry.coordinates.map(([lon, lat]) => proj.toPixel(lon, lat)), dn: 250, material: 'HDPE', dma: 'DMA-01', eam: null },
    ]
    const ops: Edit[] = draftsToOperations(drafts, proj, base)

    const project = await call<{ id: string }>('/projects', 'POST', { name: `Live ${stamp}` })
    expect(project.status).toBeLessThan(300)
    const created = await call<{ id: string }>(`/projects/${project.json.id}/revisions`, 'POST', {})
    expect(created.status).toBeLessThan(300)
    const rev = (await call<Revision>(`/revisions/${created.json.id}`)).json
    const saved = await call<Revision & { errors: unknown[] }>(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: ops })
    expect(saved.status, JSON.stringify(saved.json)).toBe(200)
    expect(saved.json.errors, JSON.stringify(saved.json.errors)).toEqual([])
    const validated = await call<{ isValid: boolean; errors?: unknown[] }>(`/revisions/${rev.id}/validate`, 'POST', {})
    expect(validated.json, JSON.stringify(validated.json)).toMatchObject({ isValid: true })
    expect((await call(`/revisions/${rev.id}/submit`, 'POST', {})).status).toBeLessThan(300)
    const approved = await call(`/revisions/${rev.id}/approve`, 'POST', {})
    expect(approved.status, JSON.stringify(approved.json)).toBeLessThan(300)

    // gis-be publishes asynchronously (outbox → event → consumer)
    let after: State = {}
    for (let i = 0; i < 30; i++) {
      after = (await call<State>('/assets')).json
      if (Object.values(after).some(v => v.asset.assetCode === `ONG-L${stamp}-1`)) break
      await new Promise(r => setTimeout(r, 1000))
    }
    expect(Object.values(after).some(v => v.asset.assetCode === `ONG-L${stamp}-1`)).toBe(true)
    expect(after[modId]!.asset.attributes.diameterMm).toBe('250')
  }, 90_000)
})
