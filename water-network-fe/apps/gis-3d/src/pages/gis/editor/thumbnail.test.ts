import { describe, expect, it } from 'vitest'
import type { GisData } from '../lib/gis-data'
import type { Draft } from './model'
import { renderBranchThumb, thumbFrame } from './thumbnail'

const G = {
  pipes: [
    { id: 'P1', pts: [[0, 0], [1000, 0]], trunk: true, status: 'active' },
    { id: 'P2', pts: [[0, 0], [0, 500]], trunk: false, status: 'active' },
  ],
  pipeBy: {},
  valves: [],
  hydrants: [],
  nodes: [],
  dmas: [],
} as unknown as GisData

describe('branch thumbnail', () => {
  it('frames the whole network when there are no drafts, at the requested aspect', () => {
    const f = thumbFrame(G, [], 16 / 9)!
    expect(f.minX).toBeLessThan(0)
    expect(f.maxX).toBeGreaterThan(1000)
    expect((f.maxX - f.minX) / (f.maxY - f.minY)).toBeCloseTo(16 / 9, 5)
  })

  it('zooms to the drafts but keeps some surrounding network', () => {
    const d: Draft = { id: 'D1', op: 'add', kind: 'pipe', geom: 'line', pts: [[900, 400], [910, 410]], dma: 'DMA-01' }
    const f = thumbFrame(G, [d], 16 / 9)!
    expect(f.minX).toBeLessThan(900)
    expect(f.maxX).toBeGreaterThan(910)
    expect(f.maxX - f.minX).toBeGreaterThanOrEqual(1000 * 0.22) // not closer than ~22% of the network
    expect(f.maxX - f.minX).toBeLessThan(1000)
  })

  it('returns null where Canvas 2D is unavailable (e.g. jsdom) instead of throwing', () => {
    expect(() => renderBranchThumb(G, [])).not.toThrow()
  })
})
