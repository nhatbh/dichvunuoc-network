/* The P0 screens' "done when" checks that live in the data: statuses at 15:00, alarms, markers and
   their lifecycle, DMA balances, and the production advice. */
import { describe, expect, it } from 'vitest'
import { MARKER_MOVES, moveMarker } from '../ops-markers'
import { statusAt } from '../ops-status'
import hyd from './demo-hydraulics.json'
import { buildLegacyFullSeed } from './legacy-full-seed'
import { buildOpsDemo } from './ops-demo'
import type { DemoHydraulics } from './demo-hydraulics'

const ops = buildOpsDemo(buildLegacyFullSeed() as never, hyd as unknown as DemoHydraulics)
const main = (dma: string) => ops.sensors.find(s => s.main && s.dma === dma)!
const at = (slot: number) => Object.fromEntries(ops.sensors.map(s => [s.id, statusAt(ops.series[s.id]!, slot, ops.events)]))

describe('ops demo data', () => {
  it('at 15:00 shows the burst in DMA-03 red, the background leak in DMA-05 amber, the rest green or grey', () => {
    const st = at(60)
    expect(st[main('DMA-03').id]).toBe('critical')
    expect(st[main('DMA-05').id]).toBe('warning')
    const others = ops.sensors.filter(s => s.id !== main('DMA-03').id && s.id !== main('DMA-05').id)
    for (const s of others) expect(['normal', 'offline'], s.name).toContain(st[s.id])
  })

  it("DMA-03's main meter steps above its baseline band at 14:00", () => {
    const s = ops.series[main('DMA-03').id]!
    expect(s.values[52]!).toBeLessThanOrEqual(s.p90![52]!)
    expect(s.values[58]!).toBeGreaterThan(s.p90![58]! * 2)
    // DMA-05: night flow above the band all night
    const s5 = ops.series[main('DMA-05').id]!
    for (let k = 8; k < 16; k++) expect(s5.values[k]!).toBeGreaterThan(s5.p50![k]!)
  })

  it('stops the offline loggers at their last reading and raises a sensor-fault marker for each', () => {
    const offline = ops.sensors.filter(s => ops.series[s.id]!.values.length < 96)
    expect(offline.length).toBeGreaterThan(0)
    for (const s of offline) {
      expect(statusAt(ops.series[s.id]!, 95)).toBe('offline')
      expect(ops.markers.some(m => m.kind === 'sensor_fault' && m.sensorId === s.id)).toBe(true)
    }
  })

  it('raises one leak marker per event; the burst loses about 3 L/s × 10 h', () => {
    const burst = ops.markers.find(m => m.id === 'MK-EV-1')!
    expect(burst.dma).toBe('DMA-03')
    expect(burst.severity).toBe('high')
    expect(burst.lossM3d).toBe(108)
    expect(burst.evidence?.sensorId).toBe(main('DMA-03').id)
    expect(ops.alarms.some(a => a.sensorId === main('DMA-03').id && a.rule === 'leak' && a.startSlot === 56)).toBe(true)
  })

  it('only offers the lifecycle moves the state allows', () => {
    const m = ops.markers.find(x => x.state === 'suspected')!
    expect(moveMarker(m, 'repaired', 'test', 't')).toBeNull()
    const reviewed = moveMarker(m, 'review', 'test', 't')!
    expect(reviewed.state).toBe('under_review')
    const ordered = moveMarker(reviewed, 'confirm', 'test', 't')!
    expect(ordered.state).toBe('work_ordered')
    expect(ordered.kind).toBe('confirmed_leak')
    expect(ordered.workOrderRef).toBeTruthy()
    expect(MARKER_MOVES.closed).toEqual([])
  })

  it('ranks DMA-05 first by night flow above baseline, and balances every DMA', () => {
    const ranked = [...ops.dmaBalance].sort((a, b) => b.mnfLps - b.mnfBaselineLps - (a.mnfLps - a.mnfBaselineLps))
    expect(ranked[0]!.id).toBe('DMA-05')
    for (const d of ops.dmaBalance) {
      expect(Math.abs(d.inflowM3d - d.useM3d - d.storageM3d), d.id).toBeLessThanOrEqual(Math.max(2, 0.02 * d.useM3d))
    }
  })

  it('advises a production schedule that keeps every critical point at minimum + margin', () => {
    const p = ops.production
    expect(p.plan).toHaveLength(24)
    const healthy = hyd.summary.production.healthyPlantLps.reduce((a, b) => a + b, 0) * 3.6
    const forecast = p.forecastM3h.reduce((a, b) => a + b, 0)
    expect(Math.abs(forecast - healthy) / healthy).toBeLessThan(0.06)
    for (const h of p.plan) expect(h.criticalMinBar).toBeGreaterThanOrEqual(p.serviceMinBar + p.marginBar - 0.005)
    // night setpoints below today's outlet pressure
    for (const h of [1, 2, 3, 4]) expect(p.plan[h]!.setpointBar).toBeLessThan(p.today.outletBar[h]!)
    // no hour today with a critical point below the service minimum
    expect(p.today.criticalMinBar.every(v => v >= p.serviceMinBar)).toBe(true)
    expect(p.mapePct).toBeLessThan(10)
  })
})
