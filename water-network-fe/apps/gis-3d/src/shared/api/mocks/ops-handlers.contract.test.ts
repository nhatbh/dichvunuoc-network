/* The demo /ops handlers against the @wn/contracts/ops schemas: every route answers with a body
   the contract accepts (the typed client throws otherwise), and the marker routes follow the
   contract's lifecycle. A real BFF must pass the same checks. */
import { MARKER_TRANSITIONS } from '@wn/contracts/ops'
import { beforeEach, describe, expect, it } from 'vitest'
import { opsApi } from '../ops-client'
import { resetOpsDemo } from './ops-handlers'

describe('ops API contract (demo handlers)', () => {
  beforeEach(() => resetOpsDemo())

  it('answers every read route with a body the contract accepts', async () => {
    const sensors = await opsApi.sensors()
    expect(sensors.sensors.length).toBeGreaterThan(0)
    const readings = await opsApi.readings()
    expect(readings.series.map(s => s.sensorId).sort()).toEqual(sensors.sensors.map(s => s.id).sort())
    expect((await opsApi.events()).length).toBeGreaterThan(0)
    expect((await opsApi.alarms()).length).toBeGreaterThan(0)
    expect((await opsApi.markers()).length).toBeGreaterThan(0)
    expect((await opsApi.dmaBalance()).length).toBeGreaterThan(0)
    expect((await opsApi.production()).plan).toHaveLength(24)
    const net = await opsApi.networkState()
    expect(net.pressureDm).toHaveLength(24)
  })

  it('creates a marker by hand and moves it only along the contract lifecycle', async () => {
    const m = await opsApi.createMarker({ kind: 'suspected_leak', title: 'test', x: 1, y: 2, note: 'seen on site' })
    expect(m).toMatchObject({ origin: 'manual', state: 'suspected' })
    await expect(opsApi.updateMarker(m.id, { action: 'repaired' })).rejects.toBeTruthy()
    const reviewed = await opsApi.updateMarker(m.id, { action: 'review' })
    expect(reviewed.state).toBe(MARKER_TRANSITIONS.suspected.review)
    const ordered = await opsApi.updateMarker(m.id, { action: 'confirm', note: 'confirmed' })
    expect(ordered.state).toBe('work_ordered')
    expect(ordered.workOrderRef).toBeTruthy()
    expect((await opsApi.markers()).find(x => x.id === m.id)?.state).toBe('work_ordered')
  })

  it('accepts a 24-hour plan and rejects a short one before sending it', async () => {
    const p = await opsApi.production()
    await expect(opsApi.savePlan({ date: p.planDate, plan: p.plan })).resolves.toBeTruthy()
    await expect(opsApi.savePlan({ date: p.planDate, plan: p.plan.slice(0, 3) })).rejects.toBeTruthy()
  })
})
