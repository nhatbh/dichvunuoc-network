// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { resetEditorStore } from './editor-handlers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
type Json = Record<string, any>
const BASE = 'http://localhost/api/gis/editor'
const call = async (path: string, method = 'GET', body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: (await r.json()) as Json }
}
const newRevision = async () => {
  const p = await call('/projects', 'POST', { name: 'Test' })
  const r = await call(`/projects/${p.json.id}/revisions`, 'POST')
  return (await call(`/revisions/${r.json.id}`)).json
}
const add = (id: string, kind: string, coordinates: [number, number][], attributes: Record<string, string>, refs: Json = {}) => ({
  id, action: 'Add', kind, targetId: null, expectedVersion: null, before: null,
  after: { draftAssetId: id, clientRef: id, kind, assetCode: 'X-' + id, geometry: { type: kind === 'Pipe' ? 'LineString' : 'Point', coordinates }, attributes, fromRef: null, toRef: null, hostRef: null, ...refs },
})
const LINE: [number, number][] = [[105.85, 21.03], [105.851, 21.03]]
/** A new pipe between two new junctions, in the server's terms. */
const segment = (id: string, coords = LINE, attrs: Record<string, string> = {}) => [
  add(id + '-A', 'Node', [coords[0]!], { componentCode: 'Junction' }),
  add(id + '-B', 'Node', [coords[coords.length - 1]!], { componentCode: 'Junction' }),
  add(id, 'Pipe', coords, { diameterMm: '200', material: 'HDPE', dma: 'DMA-01', ...attrs }, { fromRef: id + '-A', toRef: id + '-B' }),
]

beforeEach(() => resetEditorStore())

describe('mock design-revision service', () => {
  it('runs save → validate → submit → approve and publishes onto /full', async () => {
    const rev = await newRevision()
    expect(rev.status).toBe('Draft')
    const saved = await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: segment('DRF-1') })
    expect(saved.status).toBe(200)
    expect(saved.json.version).toBe(rev.version + 1)
    expect((await call(`/revisions/${rev.id}/submit`, 'POST', {})).status).toBe(409) // not validated yet
    expect((await call(`/revisions/${rev.id}/validate`, 'POST', {})).json).toEqual({ isValid: true, errors: [] })
    expect((await call(`/revisions/${rev.id}/submit`, 'POST', {})).status).toBe(200)
    expect((await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version + 1, operations: [] })).status).toBe(409) // locked
    expect((await call(`/revisions/${rev.id}/approve`, 'POST', {})).status).toBe(200)
    expect((await call(`/revisions/${rev.id}`)).json.status).toBe('Published')
    const assets = (await call('/assets')).json
    expect(assets['DRF-1'].version).toBe(1)
    const full = (await (await fetch('http://localhost/api/gis/full')).json()) as { pipeBy: Record<string, { dn: number }> }
    expect(full.pipeBy['DRF-1']?.dn).toBe(200)
  })

  it('rejects a stale revision version with 409', async () => {
    const rev = await newRevision()
    await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: [] })
    expect((await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: [] })).status).toBe(409)
  })

  it('reports rule violations and stale base assets on validate', async () => {
    const rev = await newRevision()
    const assets = (await call('/assets')).json
    const [pid, base] = Object.entries(assets).find(([, v]) => (v as Json).asset.kind === 'Pipe') as [string, Json]
    const stale = { id: 'DRF-2', action: 'Update', kind: 'Pipe', targetId: pid, expectedVersion: base.version + 5, before: null, after: base.asset }
    // a stale base version refuses the save, as design-be does
    const refused = await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: [stale] })
    expect(refused.status).toBe(409)
    expect(refused.json.errors.map((e: Json) => e.code)).toEqual(['TARGET_CONFLICT'])
    // the editor's old shapes: dn instead of diameterMm, a label instead of a material code, no end nodes
    const old = add('DRF-3', 'Pipe', LINE, { dn: '200', material: 'Gang dẻo' })
    const ops = [...segment('DRF-1', LINE, { diameterMm: '20.5' }), old]
    const saved = await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: ops })
    expect(saved.status).toBe(200)
    const v = (await call(`/revisions/${rev.id}/validate`, 'POST', {})).json
    expect(v.isValid).toBe(false)
    expect(v.errors.map((e: { code: string }) => e.code).sort()).toEqual(['DIAMETER', 'DIAMETER', 'INVALID_PROPERTIES'])
  })

  it('requires a reason to reject', async () => {
    const rev = await newRevision()
    await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: segment('DRF-1') })
    await call(`/revisions/${rev.id}/validate`, 'POST', {})
    await call(`/revisions/${rev.id}/submit`, 'POST', {})
    expect((await call(`/revisions/${rev.id}/reject`, 'POST', {})).status).toBe(400)
    expect((await call(`/revisions/${rev.id}/reject`, 'POST', { reason: 'Sai DN' })).status).toBe(200)
    expect((await call(`/revisions/${rev.id}`)).json).toMatchObject({ status: 'Draft', reason: 'Sai DN' })
  })
})
