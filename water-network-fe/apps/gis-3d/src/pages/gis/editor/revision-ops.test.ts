import { describe, expect, it } from 'vitest'
import type { Draft } from './model'
import { draftsToOperations, operationsToDrafts, serverIssues, type Projector } from './revision-ops'

// 1 px = 1e-5° around Hanoi; exact inverse so round trips are lossless
const proj: Projector = {
  toLonLat: (x, y) => [105.8 + x * 1e-5, 21.05 - y * 1e-5],
  toPixel: (lon, lat) => [(lon - 105.8) / 1e-5, (21.05 - lat) / 1e-5],
}

const drafts: Draft[] = [
  { id: 'DRF-A1', op: 'add', kind: 'pipe', geom: 'line', pts: [[10, 20], [110, 20]], dn: 200, material: 'HDPE', year: 2026, cond: 'good', trunk: false, dma: 'DMA-02', eam: null },
  { id: 'DRF-V1', op: 'add', kind: 'valve', geom: 'point', x: 60, y: 20, dn: 200, vkind: 'gate', state: 'open', dma: 'DMA-02', eam: { code: 'EAM-9', kind: 'valve', name: 'Van 9', serial: 'S9', maker: 'AVK', year: 2026 }, onPipe: 'P-0007' },
  { id: 'DRF-M1', op: 'mod', baseId: 'P-0001', kind: 'pipe', geom: 'line', pts: [[0, 0], [50, 0]], dn: 300, material: 'Gang dẻo', year: 2014, cond: 'fair', trunk: true, dma: 'DMA-01', eam: null },
  { id: 'DRF-DH-1', op: 'del', baseId: 'H-0003', kind: 'hydrant', geom: 'point', dma: 'DMA-01' },
]

describe('revision-ops', () => {
  const ops = draftsToOperations(drafts, proj, { 'P-0001': 4, 'H-0003': 2 }, (_k, id) => (id === 'P-0001' ? 'ONG_GANG_DN300' : undefined))

  it('maps adds, updates and deletes to revision operations', () => {
    expect(ops.map(o => [o.action, o.kind, o.targetId, o.expectedVersion])).toEqual([
      ['Add', 'Pipe', null, null],
      ['Add', 'Device', null, null],
      ['Update', 'Pipe', 'P-0001', 4],
      ['Delete', 'Device', 'H-0003', 2],
    ])
    expect(ops[0]!.after!.geometry).toEqual({ type: 'LineString', coordinates: [[105.8001, 21.0498], [105.8011, 21.0498]] })
    expect(ops[1]!.after!.hostRef).toBe('P-0007')
    expect(ops[1]!.after!.attributes).toMatchObject({ deviceType: 'valve', valveKind: 'gate', eamCode: 'EAM-9' })
    expect(ops[2]!.after!.assetCode).toBe('ONG_GANG_DN300')
    expect(ops[3]!.after).toBeNull()
  })

  it('round-trips back to the same drafts', () => {
    const back = operationsToDrafts(ops, proj, id => (id === 'H-0003' ? 'hydrant' : undefined))
    expect(back).toEqual(drafts)
  })

  it('rejects drafts without geometry or base reference', () => {
    expect(() => draftsToOperations([{ id: 'X', op: 'add', kind: 'pipe', geom: 'line', pts: [[0, 0]], dma: 'D' }], proj)).toThrow()
    expect(() => draftsToOperations([{ id: 'Y', op: 'mod', kind: 'node', geom: 'point', x: 1, y: 1, dma: 'D' }], proj)).toThrow()
  })

  it('turns server issues into change-set rows', () => {
    expect(serverIssues([{ code: 'pipe.dn', operationId: 'DRF-A1', field: 'dn', message: 'DN không hợp lệ' }])).toEqual([
      { sev: 'error', rule: 'server', msg: '[DRF-A1] DN không hợp lệ' },
    ])
  })
})
