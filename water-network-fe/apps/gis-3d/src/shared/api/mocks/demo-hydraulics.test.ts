/* The demo network's water must make sense from the plant to the tap: these check the precomputed
   EPANET run (demo-hydraulics.json) against the network the seed builds today. */
import { describe, expect, it } from 'vitest'
import hyd from './demo-hydraulics.json'
import { buildLegacyFullSeed } from './legacy-full-seed'
import type { DemoHydraulics } from './demo-hydraulics'

const H = hyd as unknown as DemoHydraulics
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const seed = buildLegacyFullSeed() as any

describe('demo hydraulics', () => {
  it('was solved for the network the seed builds (else run `npm run demo:hydraulics`)', () => {
    expect(seed.networkSignature).toBe(H.signature)
    expect(seed.hydraulics?.summary).toBeTruthy()
  })

  it('supplies every customer at service pressure with sensible velocities', () => {
    const s = H.summary
    expect(s.unsuppliedNodes).toBe(0)
    expect(s.minPressureM).toBeGreaterThanOrEqual(10)
    expect(Math.min(...Object.values(H.nodes))).toBeGreaterThanOrEqual(10)
    expect(s.maxVelocity).toBeLessThan(2)
    expect(s.medianPressureM).toBeGreaterThan(15)
    expect(s.medianPressureM).toBeLessThan(45)
  })

  it('flows from the sources to the taps: only the plant and storage outlets have nothing flowing in', () => {
    const key = (p: number[]) => `${Math.round(p[0]! / 3)},${Math.round(p[1]! / 3)}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const end = (p: any, e: 0 | 1): string => (e ? p.to : p.from) ?? key(e ? p.pts[p.pts.length - 1] : p.pts[0])
    const into = new Set<string>()
    const from = new Set<string>()
    for (const p of seed.pipes) {
      const q = H.pipes[p.id]?.[0]
      if (!q || Math.abs(q) < 1e-3) continue
      from.add(end(p, q > 0 ? 0 : 1))
      into.add(end(p, q > 0 ? 1 : 0))
    }
    const heads = [...from].filter(k => !into.has(k))
    expect(heads.length).toBeGreaterThan(0)
    expect(heads.length).toBeLessThanOrEqual(1 + Object.keys(H.summary.tanks).length)
  })

  it('balances: production = consumption + leakage, and each DMA inflow = use + storage', () => {
    const s = H.summary
    expect(Math.abs(s.productionM3d - s.consumptionM3d - s.leakageM3d) / s.productionM3d).toBeLessThan(0.02)
    expect(s.nrwPct).toBeGreaterThan(10)
    expect(s.nrwPct).toBeLessThan(35)
    expect(s.balanceError).toBeLessThan(0.02)
    for (const d of s.dmas) {
      expect(d.inflowLps).toHaveLength(24)
      d.inflowLps.forEach((q, h) => expect(Math.abs(q - d.demandLps[h]! - d.storageLps[h]!)).toBeLessThan(Math.max(1, 0.02 * d.demandLps[h]!)))
      // night use is well below the morning peak
      expect(d.mnfLps).toBeLessThan(Math.max(...d.demandLps) * 0.7)
    }
  })

  it('follows the day: plant output peaks in the morning and evening, storage cycles back', () => {
    const p = H.summary.plantLps
    expect(Math.max(...p.slice(6, 10))).toBeGreaterThan(1.4 * Math.min(...p.slice(1, 5)))
    for (const [id, levels] of Object.entries(H.summary.tanks)) {
      expect(Math.min(...levels), id).toBeGreaterThan(0.5)
      expect(Math.abs(levels[23]! - levels[0]!), id).toBeLessThan(1)
    }
  })

  it('gives every logger and meter a day of readings from the model', () => {
    const devices = seed.sourceDevices as Array<{ id: string; deviceType: string; status: string }>
    for (const d of devices.filter(x => x.deviceType === 'PressureSensor' || x.deviceType === 'BulkMeter')) {
      const t = H.telemetry[d.id]
      expect(t, d.id).toBeTruthy()
      expect(t!.values.length, d.id).toBe(H.status[d.id] === 'offline' ? 40 : 96)
      if (d.deviceType === 'PressureSensor') expect(Math.min(...t!.values), d.id).toBeGreaterThanOrEqual(1)
      expect(d.status).toBe(H.status[d.id])
    }
  })

  it('shows the leaks on the devices that would catch them, and nothing else', () => {
    for (const e of H.events) {
      const meters = e.seenBy.filter(id => H.telemetry[id]?.unit === 'm³/h')
      expect(meters.length, e.nodeId).toBeGreaterThan(0)
      expect(meters.some(id => H.status[id] === (e.kind === 'burst' ? 'critical' : 'warning')), e.nodeId).toBe(true)
    }
    const flagged = Object.values(H.status).filter(s => s === 'critical' || s === 'warning').length
    expect(flagged).toBeLessThan(10)
  })
})
