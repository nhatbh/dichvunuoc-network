/* Editing the published network (plan EDT-3): updates keep what the editor does not show,
   catalog properties travel with the draft, moving a node takes its pipes' ends along. */
import { inspectNetworkEdits, type EditState } from '@wn/contracts/network-edits'
import { describe, expect, it } from 'vitest'
import type { Draft } from './model'
import { draftFromBase, draftsToOperations, operationsToDrafts, type Projector } from './revision-ops'
import type { Asset } from './revision-model'

const proj: Projector = {
  toLonLat: (x, y) => [105.5 + x * 1e-5, 21.17 - y * 1e-5],
  toPixel: (lon, lat) => [(lon - 105.5) / 1e-5, (21.17 - lat) / 1e-5],
}
const ll = (x: number, y: number) => proj.toLonLat(x, y)
const asset = (id: string, kind: Asset['kind'], pts: [number, number][], attributes: Record<string, string>, refs: Partial<Asset> = {}): Asset => ({
  draftAssetId: id, kind, assetCode: `C-${id}`, clientRef: null,
  geometry: { type: kind === 'Pipe' ? 'LineString' : 'Point', coordinates: pts.map(([x, y]) => ll(x, y)) },
  attributes, fromRef: null, toRef: null, hostRef: null, ...refs,
})
/** a —P1— tee —P2— b, tee —P3— c; a gate valve on P1. */
const base: EditState = {
  a: { asset: asset('a', 'Node', [[0, 0]], { componentCode: 'Junction', dn: '160' }), version: 1 },
  tee: { asset: asset('tee', 'Node', [[100, 0]], { componentCode: 'ReducingTee', dn: '160', dn2: '110', material: 'HDPE', componentFrom: 'geometry' }), version: 3 },
  b: { asset: asset('b', 'Node', [[200, 0]], { componentCode: 'Junction', dn: '160' }), version: 1 },
  c: { asset: asset('c', 'Node', [[100, 80]], { componentCode: 'Junction', dn: '110' }), version: 1 },
  P1: { asset: asset('P1', 'Pipe', [[0, 0], [100, 0]], { diameterMm: '160', material: 'HDPE', lengthM: '100' }, { fromRef: 'a', toRef: 'tee' }), version: 2 },
  P2: { asset: asset('P2', 'Pipe', [[100, 0], [200, 0]], { diameterMm: '160', material: 'HDPE' }, { fromRef: 'tee', toRef: 'b' }), version: 1 },
  P3: { asset: asset('P3', 'Pipe', [[100, 0], [100, 80]], { diameterMm: '110', material: 'HDPE' }, { fromRef: 'tee', toRef: 'c' }), version: 1 },
  V1: { asset: asset('V1', 'Device', [[50, 0]], { componentCode: 'GateValve', dn: '160', state: 'open', manufacturer: 'AVK' }, { hostRef: 'P1' }), version: 1 },
}

describe('editing the published network', () => {
  it('keeps the attributes an update does not touch', () => {
    const drafts: Draft[] = [{ id: 'M-V1', op: 'mod', baseId: 'V1', kind: 'valve', geom: 'point', x: 50, y: 0, dn: 160, vkind: 'gate', state: 'closed', dma: '', onPipe: 'P1' }]
    const [op] = draftsToOperations(drafts, proj, base)
    expect(op!.after!.attributes).toMatchObject({ componentCode: 'GateValve', state: 'closed', manufacturer: 'AVK', dn: '160' })
    expect(inspectNetworkEdits(base, [op!]).errors).toEqual([])
  })

  it('carries catalog properties edited on the draft', () => {
    const drafts: Draft[] = [{ id: 'M-T', op: 'mod', baseId: 'tee', kind: 'node', geom: 'point', x: 100, y: 0, ntype: 'ReducingTee', dma: '', props: { dn2: '90' } }]
    const [op] = draftsToOperations(drafts, proj, base)
    expect(op!.after!.attributes).toMatchObject({ componentCode: 'ReducingTee', dn: '160', dn2: '90', material: 'HDPE' })
  })

  it('moving a node moves the ends of the pipes on it, and the result validates', () => {
    const drafts: Draft[] = [{ id: 'M-T', op: 'mod', baseId: 'tee', kind: 'node', geom: 'point', x: 100, y: 10, ntype: 'ReducingTee', dma: '' }]
    const ops = draftsToOperations(drafts, proj, base)
    const moved = ll(100, 10).map(v => Math.round(v * 1e8) / 1e8)
    const pipe = (id: string) => ops.find(o => o.targetId === id && o.kind === 'Pipe')!
    expect(pipe('P1').after!.geometry.coordinates.at(-1)).toEqual(moved)
    expect(pipe('P2').after!.geometry.coordinates[0]).toEqual(moved)
    expect(pipe('P3').after!.geometry.coordinates[0]).toEqual(moved)
    expect(pipe('P1').after!.toRef).toBe('tee')
    expect(ops.filter(o => o.action === 'Add')).toEqual([]) // no stray junctions
    expect(inspectNetworkEdits(base, ops).errors).toEqual([])
  })

  it('a moved node’s pipes are not drafts when the revision is reopened', () => {
    const drafts: Draft[] = [{ id: 'M-T', op: 'mod', baseId: 'tee', kind: 'node', geom: 'point', x: 100, y: 10, ntype: 'ReducingTee', dma: '' }]
    const reopened = operationsToDrafts(draftsToOperations(drafts, proj, base), proj)
    expect(reopened.map(d => d.id)).toEqual(['M-T'])
    expect(reopened[0]!.props).toMatchObject({ dn: '160', dn2: '110', material: 'HDPE' })
  })

  it('starts a "Sửa" draft from the published asset', () => {
    const tee = draftFromBase('tee', base.tee!.asset, proj)
    expect(tee).toMatchObject({ id: 'DRF-Mtee', op: 'mod', baseId: 'tee', kind: 'node', ntype: 'ReducingTee', props: { dn: '160', dn2: '110', material: 'HDPE' } })
    expect([Math.round(tee.x!), Math.round(tee.y!)]).toEqual([100, 0])
    const valve = draftFromBase('V1', base.V1!.asset, proj)
    expect(valve).toMatchObject({ kind: 'valve', vkind: 'gate', dn: 160, state: 'open', onPipe: 'P1', props: { manufacturer: 'AVK' } })
    // saved untouched, it is the same asset again
    const [op] = draftsToOperations([valve], proj, base)
    expect(op!.after!.attributes).toMatchObject(base.V1!.asset.attributes)
  })
})
