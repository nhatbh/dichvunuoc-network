import { inspectNetworkEdits, type EditState } from '@wn/contracts/network-edits'
import { describe, expect, it } from 'vitest'
import type { Draft } from './model'
import { draftsToOperations, operationsToDrafts, serverIssues, type Projector } from './revision-ops'
import type { Asset } from '../network-editor/model'

// 1 px = 1e-5° (~1 m) around Hanoi; exact inverse so round trips are lossless
const proj: Projector = {
  toLonLat: (x, y) => [105.8 + x * 1e-5, 21.05 - y * 1e-5],
  toPixel: (lon, lat) => [(lon - 105.8) / 1e-5, (21.05 - lat) / 1e-5],
}
const ll = (x: number, y: number) => proj.toLonLat(x, y)

const node = (id: string, x: number, y: number): Asset => ({
  draftAssetId: id, kind: 'Node', assetCode: `N-${id}`, clientRef: null,
  geometry: { type: 'Point', coordinates: [ll(x, y)] }, attributes: { nodeType: 'Junction' }, fromRef: null, toRef: null, hostRef: null,
})
const pipe = (id: string, from: string, to: string, pts: [number, number][]): Asset => ({
  draftAssetId: id, kind: 'Pipe', assetCode: `ONG-${id}`, clientRef: null,
  geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => ll(x, y)) },
  attributes: { diameterMm: '150', material: 'DuctileIron' }, fromRef: from, toRef: to, hostRef: null,
})
/** Published network: n1 —P-0001— n2 —P-0007— n3, and hydrant H-0003 on n2. */
const base: EditState = {
  n1: { asset: node('n1', 0, 0), version: 1 },
  n2: { asset: node('n2', 50, 0), version: 1 },
  n3: { asset: node('n3', 150, 0), version: 1 },
  'P-0001': { asset: pipe('P-0001', 'n1', 'n2', [[0, 0], [50, 0]]), version: 4 },
  'P-0007': { asset: pipe('P-0007', 'n2', 'n3', [[50, 0], [150, 0]]), version: 1 },
  'H-0003': { asset: { ...node('H-0003', 50, 0), kind: 'Device', assetCode: 'TRU-3', attributes: { deviceType: 'Hydrant' }, hostRef: 'n2' }, version: 2 },
}

const drafts: Draft[] = [
  { id: 'DRF-A1', op: 'add', kind: 'pipe', geom: 'line', pts: [[150, 0.5], [150, 80]], dn: 200, material: 'HDPE', year: 2026, cond: 'good', trunk: false, dma: 'DMA-02', eam: null },
  { id: 'DRF-V1', op: 'add', kind: 'valve', geom: 'point', x: 100, y: 0, dn: 150, vkind: 'gate', state: 'open', dma: 'DMA-02', eam: { code: 'EAM-9', kind: 'valve', name: 'Van 9', serial: 'S9', maker: 'AVK', year: 2026 }, onPipe: 'P-0007' },
  { id: 'DRF-M1', op: 'mod', baseId: 'P-0001', kind: 'pipe', geom: 'line', pts: [[0, 0], [25, 10], [50, 0]], dn: 300, material: 'Gang dẻo', year: 2014, cond: 'fair', trunk: true, dma: 'DMA-01', eam: null },
  { id: 'DRF-DH-1', op: 'del', baseId: 'H-0003', kind: 'hydrant', geom: 'point', dma: 'DMA-01' },
]

describe('revision-ops', () => {
  const ops = draftsToOperations(drafts, proj, base)

  it('builds operations the server accepts (gis-be validator port)', () => {
    expect(inspectNetworkEdits(base, ops).errors).toEqual([])
  })

  it('maps adds, updates and deletes; existing assets keep their code and version', () => {
    expect(ops.slice(0, 4).map(o => [o.action, o.kind, o.targetId, o.expectedVersion])).toEqual([
      ['Add', 'Pipe', null, null],
      ['Add', 'Device', null, null],
      ['Update', 'Pipe', 'P-0001', 4],
      ['Delete', 'Device', 'H-0003', 2],
    ])
    expect(ops[2]!.after!.assetCode).toBe('ONG-P-0001')
    expect(ops.every(o => !o.after || o.after.draftAssetId === o.id)).toBe(true)
  })

  it('speaks the server vocabulary: diameterMm, material codes, device types', () => {
    expect(ops[0]!.after!.attributes).toMatchObject({ diameterMm: '200', material: 'HDPE' })
    expect(ops[2]!.after!.attributes).toMatchObject({ diameterMm: '300', material: 'DuctileIron' })
    expect(ops[1]!.after!.attributes).toMatchObject({ deviceType: 'Valve', valveKind: 'gate', eamCode: 'EAM-9' })
    expect(ops[1]!.after!.hostRef).toBe('P-0007')
  })

  it('connects pipe ends: snaps to a node within reach, adds a junction otherwise', () => {
    const a = ops[0]!.after!
    expect(a.fromRef).toBe('n3')
    expect(a.geometry.coordinates[0]).toEqual(base.n3!.asset.geometry.coordinates[0])
    const junction = ops.find(o => o.id === a.toRef)!
    expect(junction).toMatchObject({ action: 'Add', kind: 'Node' })
    expect(junction.after!.attributes).toMatchObject({ nodeType: 'Junction', derived: 'endpoint' })
    expect(ops[2]!.after!.fromRef).toBe('n1')
    expect(ops[2]!.after!.toRef).toBe('n2')
  })

  it('splits a pipe at a node dropped on it', () => {
    const split: Draft[] = [{ id: 'DRF-N1', op: 'add', kind: 'node', geom: 'point', x: 100, y: 0.4, dma: 'DMA-02', ntype: 'Nút tách', z: 12, eam: null, splitOf: 'P-0007' }]
    const out = draftsToOperations(split, proj, base)
    expect(inspectNetworkEdits(base, out).errors).toEqual([])
    const first = out.find(o => o.targetId === 'P-0007')!
    const rest = out.find(o => o.action === 'Add' && o.kind === 'Pipe')!
    expect(first.after!.toRef).toBe('DRF-N1')
    expect(rest.after).toMatchObject({ fromRef: 'DRF-N1', toRef: 'n3' })
    expect(out[0]!.after!.attributes).toMatchObject({ nodeType: 'Junction', fitting: 'Nút tách' })
    // reopening shows only what was drawn
    expect(operationsToDrafts(out, proj).map(d => d.id)).toEqual(['DRF-N1'])
  })

  it('hosts a new hydrant on the nearest node, or on a node of its own', () => {
    const h: Draft[] = [
      { id: 'DRF-H1', op: 'add', kind: 'hydrant', geom: 'point', x: 51, y: 1, dma: 'DMA-01', htype: 'pillar', eam: null },
      { id: 'DRF-H2', op: 'add', kind: 'hydrant', geom: 'point', x: 90, y: 30, dma: 'DMA-01', htype: 'pillar', eam: null },
    ]
    const out = draftsToOperations(h, proj, base)
    expect(inspectNetworkEdits(base, out).errors).toEqual([])
    expect(out[0]!.after!.hostRef).toBe('n2')
    expect(out.find(o => o.id === out[1]!.after!.hostRef)!.after!.attributes.nodeType).toBe('Hydrant')
  })

  it('round-trips back to the same drafts', () => {
    const back = operationsToDrafts(ops, proj, id => (id === 'H-0003' ? 'hydrant' : undefined))
    // pipe ends were moved onto their nodes
    const expected = drafts.map(d => (d.id === 'DRF-A1' ? { ...d, pts: [[150, 0], [150, 80]] } : d))
    expect(back).toEqual(expected)
  })

  it('rejects drafts without geometry or base reference', () => {
    expect(() => draftsToOperations([{ id: 'X', op: 'add', kind: 'pipe', geom: 'line', pts: [[0, 0]], dma: 'D' }], proj)).toThrow()
    expect(() => draftsToOperations([{ id: 'Y', op: 'mod', kind: 'node', geom: 'point', x: 1, y: 1, dma: 'D' }], proj)).toThrow()
  })

  it('turns server issues into change-set rows', () => {
    expect(serverIssues([{ code: 'DIAMETER', operationId: 'DRF-A1', field: 'diameterMm', message: 'DN không hợp lệ' }])).toEqual([
      { sev: 'error', rule: 'server', msg: '[DRF-A1] DN không hợp lệ' },
    ])
  })
})
