import { describe, it, expect } from 'vitest'
import type { GisData } from '../lib/gis-data'
import {
  ED_U2M,
  edDmaAt,
  edOffsetPts,
  edPolyLen,
  edRules,
  genImportFeatures,
  type Draft,
} from './model'

/* Minimal GisData fixture — only the members the model layer reads. */
function fixture(): GisData {
  return {
    nodes: [
      { id: 'ND-1', x: 0, y: 0 },
      { id: 'ND-2', x: 500, y: 500 },
      { id: 'ND-60', x: 300, y: 300 },
      { id: 'ND-70', x: 360, y: 300 },
      { id: 'ND-80', x: 420, y: 300 },
      { id: 'ND-61', x: 300, y: 360 },
      { id: 'ND-71', x: 360, y: 360 },
      { id: 'ND-81', x: 420, y: 360 },
    ],
    pipes: [{ id: 'P-1', pts: [[0, 0], [500, 500]], dn: 300, material: 'HDPE', dma: 'DMA-01' }],
    valves: [],
    dmas: [
      { id: 'DMA-03', col: '#0969DA', poly: [[280, 280], [440, 280], [440, 380], [280, 380]] },
    ],
  } as unknown as GisData
}

const ALL_ON = { dangling: true, boundaryValve: true, eam: true, material: true, dn: true, overlap: true, connectivity: true }

describe('editor geometry', () => {
  it('edPolyLen sums segment lengths', () => {
    expect(edPolyLen([[0, 0], [3, 4]])).toBe(5)
    expect(edPolyLen([[0, 0], [3, 4], [3, 4]])).toBe(5)
  })

  it('edOffsetPts keeps vertex count', () => {
    const out = edOffsetPts([[0, 0], [10, 0]], 2)
    expect(out).toHaveLength(2)
  })

  it('edDmaAt resolves a point inside a DMA polygon, else DMA-01', () => {
    const G = fixture()
    expect(edDmaAt(G, 360, 330)).toBe('DMA-03')
    expect(edDmaAt(G, 9999, 9999)).toBe('DMA-01')
  })
})

describe('editor rule engine', () => {
  it('flags a floating pipe: dangling + eam errors', () => {
    const G = fixture()
    const draft: Draft = { id: 'DRF-001', op: 'add', kind: 'pipe', geom: 'line', pts: [[100, 100], [200, 100]], dn: 200, material: 'HDPE', dma: 'DMA-01', eam: null }
    const issues = edRules(G, [draft], ALL_ON)
    expect(issues.some((i) => i.rule === 'dangling' && i.sev === 'error')).toBe(true)
    expect(issues.some((i) => i.rule === 'eam' && i.sev === 'error')).toBe(true)
    expect(issues.some((i) => i.rule === 'connectivity' && i.sev === 'warn')).toBe(true)
  })

  it('eam rule clears once an asset record is attached', () => {
    const G = fixture()
    const base: Draft = { id: 'DRF-002', op: 'add', kind: 'pipe', geom: 'line', pts: [[100, 100], [200, 100]], dn: 200, material: 'HDPE', dma: 'DMA-01', eam: null }
    const attached: Draft = { ...base, eam: { code: 'EAM-ONG-1', kind: 'pipe', name: 'x', serial: 's', maker: 'm', year: 2024 } }
    expect(edRules(G, [base], ALL_ON).some((i) => i.rule === 'eam')).toBe(true)
    expect(edRules(G, [attached], ALL_ON).some((i) => i.rule === 'eam')).toBe(false)
  })

  it('respects disabled rule flags', () => {
    const G = fixture()
    const draft: Draft = { id: 'DRF-003', op: 'add', kind: 'pipe', geom: 'line', pts: [[100, 100], [200, 100]], dn: 200, material: 'HDPE', dma: 'DMA-01', eam: null }
    const issues = edRules(G, [draft], { ...ALL_ON, eam: false })
    expect(issues.some((i) => i.rule === 'eam')).toBe(false)
  })
})

describe('genImportFeatures', () => {
  it('produces imported pipe + valve drafts from survey node pairs', () => {
    const G = fixture()
    const feats = genImportFeatures(G)
    expect(feats.length).toBeGreaterThan(0)
    expect(feats.every((f) => f.imported)).toBe(true)
    expect(feats.some((f) => f.kind === 'pipe')).toBe(true)
    expect(feats.some((f) => f.kind === 'valve')).toBe(true)
    const pipe = feats.find((f) => f.kind === 'pipe')!
    expect(pipe.lenM).toBe(Math.round(edPolyLen(pipe.pts!) * ED_U2M))
  })
})
