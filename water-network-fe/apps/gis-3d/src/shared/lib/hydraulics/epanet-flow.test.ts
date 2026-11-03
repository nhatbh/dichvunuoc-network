import { describe, expect, it } from 'vitest'
import { buildInp, flowSpeedFromVelocity, solveHydraulics, type HydraulicInput } from './epanet-flow'

// plant ── A ── B ── C   and  A ── D ── C (a loop), C draws water; E is a closed dead end
const pipe = (id: string, a: [number, number], b: [number, number], extra = {}) => ({
  id, dn: 200, lenM: 300, material: 'HDPE', status: 'active', pts: [a, b] as [[number, number], [number, number]], ...extra,
})
const net: HydraulicInput = {
  plant: { x: 0, y: 0 },
  connDots: [{ x: 200, y: 0 }, { x: 200, y: 0 }],
  pipes: [
    pipe('P1', [0, 0], [100, 0]),
    pipe('P2', [100, 0], [200, 0]),
    pipe('P3', [100, 0], [100, 100]),
    pipe('P4', [100, 100], [200, 0]),
    pipe('P5', [200, 0], [300, 0], { noFlow: true }),
    pipe('P6', [200, 0], [100, 0]), // drawn against the flow
  ],
}

describe('epanet-flow', () => {
  it('builds an INP with a reservoir, closed status and no degenerate pipes', () => {
    const { inp, pipeIds } = buildInp({ ...net, pipes: [...net.pipes, pipe('LOOP', [5, 5], [6, 6])] })
    expect(inp).toContain('[RESERVOIRS]')
    expect(inp).toMatch(/P5\tClosed/)
    expect(pipeIds).not.toContain('LOOP')
  })

  it('solves and reports flow direction relative to the drawn line', async () => {
    const r = await solveHydraulics(net)
    expect(r.get('P1')?.flowDir).toBe('forward')
    expect(r.get('P6')?.flowDir).toBe('reverse')
    expect(r.has('P5')).toBe(false)
    expect(r.get('P1')!.velocity).toBeGreaterThan(0)
  })

  it('returns an empty map for an empty network', async () => {
    expect((await solveHydraulics({ ...net, pipes: [] })).size).toBe(0)
  })

  it('maps velocity to a bounded animation speed', () => {
    expect(flowSpeedFromVelocity(0)).toBeCloseTo(0.2)
    expect(flowSpeedFromVelocity(100)).toBeLessThan(1.8)
    expect(flowSpeedFromVelocity(1)).toBeGreaterThan(flowSpeedFromVelocity(0.1))
  })
})
