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
const pipe = (id: string, coords: [number, number][], attrs: Record<string, string> = {}) => ({
  id, action: 'Add', kind: 'Pipe', targetId: null, expectedVersion: null, before: null,
  after: { draftAssetId: id, clientRef: id, kind: 'Pipe', assetCode: 'ONG-' + id, geometry: { type: 'LineString', coordinates: coords }, attributes: { dn: '200', material: 'HDPE', dma: 'DMA-01', ...attrs }, fromRef: null, toRef: null, hostRef: null },
})
const LINE: [number, number][] = [[105.85, 21.03], [105.851, 21.03]]

beforeEach(() => resetEditorStore())

describe('mock design-revision service', () => {
  it('runs save → validate → submit → approve and publishes onto /full', async () => {
    const rev = await newRevision()
    expect(rev.status).toBe('Draft')
    const saved = await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: [pipe('DRF-1', LINE)] })
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
    const ops = [pipe('DRF-1', LINE, { dn: '9999', material: 'Gỗ' }), stale, pipe('DRF-3', [[0, 0], [1, 1]])]
    await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: ops })
    const v = (await call(`/revisions/${rev.id}/validate`, 'POST', {})).json
    expect(v.isValid).toBe(false)
    expect(v.errors.map((e: { code: string }) => e.code).sort()).toEqual(['geometry.extent', 'pipe.dn', 'pipe.material', 'target.conflict'])
  })

  it('requires a reason to reject', async () => {
    const rev = await newRevision()
    await call(`/revisions/${rev.id}`, 'PUT', { expectedVersion: rev.version, operations: [pipe('DRF-1', LINE)] })
    await call(`/revisions/${rev.id}/validate`, 'POST', {})
    await call(`/revisions/${rev.id}/submit`, 'POST', {})
    expect((await call(`/revisions/${rev.id}/reject`, 'POST', {})).status).toBe(400)
    expect((await call(`/revisions/${rev.id}/reject`, 'POST', { reason: 'Sai DN' })).status).toBe(200)
    expect((await call(`/revisions/${rev.id}`)).json).toMatchObject({ status: 'Rejected', reason: 'Sai DN' })
  })
})
