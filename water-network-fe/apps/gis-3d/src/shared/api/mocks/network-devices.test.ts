import { describe, expect, it } from 'vitest'
import { CATALOG_ITEMS } from '@wn/map-runtime-3d'
import { deviceCode, valveCode } from '@/pages/gis/ui/component-style'
import { buildLegacyFullSeed } from './legacy-full-seed'

type Rec = Record<string, unknown>
const seed = buildLegacyFullSeed() as Rec & {
  pipes: Array<Rec & { id: string; from: string; to: string }>
  nodes: Array<Rec & { id: string; kind: string; z: number }>
  valves: Array<Rec & { kind: string }>
  hydrants: Array<Rec & { status: string }>
  sourceDevices: Array<Rec & { id: string; deviceType: string; status: string; hostPipeId?: string; hostNodeId?: string }>
  connections: Rec[]
  telemetry: Record<string, { values: number[]; unit: string }>
  LAYERS: Array<{ id: string; on: boolean; count?: number }>
}

describe('demo network completeness', () => {
  it('carries every component in the catalog', () => {
    const present = new Set<string>([
      'Pipe',
      'CustomerMeter', // connection dots
      'Source', 'Reservoir', 'PumpStation', // plant / reservoirs / pumps
      ...(seed.hydrants.length ? ['Hydrant'] : []),
      ...seed.nodes.map(n => n.kind),
      ...seed.valves.map(v => valveCode(v.kind)),
      ...seed.sourceDevices.map(d => deviceCode(d.deviceType) ?? d.deviceType),
    ])
    const missing = CATALOG_ITEMS.map(c => c.code).filter(code => !present.has(code))
    expect(missing).toEqual([])
  })

  it('connects every pipe to a node at both ends', () => {
    const ids = new Set(seed.nodes.map(n => n.id))
    for (const p of seed.pipes) {
      expect(ids.has(p.from)).toBe(true)
      expect(ids.has(p.to)).toBe(true)
    }
    for (const n of seed.nodes) expect(n.z).toBeGreaterThan(0)
  })

  it('hosts every device on a known pipe or node, with a live status', () => {
    const pipes = new Set(seed.pipes.map(p => p.id))
    const nodes = new Set(seed.nodes.map(n => n.id))
    for (const d of seed.sourceDevices) {
      expect(['normal', 'warning', 'critical', 'offline']).toContain(d.status)
      if (d.hostPipeId) expect(pipes.has(d.hostPipeId)).toBe(true)
      if (d.hostNodeId) expect(nodes.has(d.hostNodeId)).toBe(true)
    }
  })

  it('ships 24 h of 15-minute telemetry for loggers, bulk meters and level sensors', () => {
    const metered = seed.sourceDevices.filter(d => ['PressureSensor', 'BulkMeter', 'LevelSensor'].includes(d.deviceType))
    expect(metered.length).toBeGreaterThan(10)
    for (const d of metered) {
      const t = seed.telemetry[d.id]!
      expect(t).toBeDefined()
      expect(t.values.length).toBe(d.status === 'offline' ? 40 : 96)
    }
    const p = seed.telemetry[metered.find(d => d.deviceType === 'PressureSensor' && d.status === 'normal')!.id]!
    expect(p.unit).toBe('bar')
    const night = p.values[12]!, evening = p.values[76]!
    expect(night).toBeGreaterThan(evening) // pressure is highest at night, lowest at the evening peak
  })

  it('lists devices as their own layer and shows hydrants', () => {
    const device = seed.LAYERS.find(l => l.id === 'device')!
    expect(device.on).toBe(true)
    expect(device.count).toBe(seed.sourceDevices.length)
    expect(seed.LAYERS.find(l => l.id === 'hydrant')!.on).toBe(true)
    expect(seed.LAYERS.find(l => l.id === 'node')!.count).toBe(seed.nodes.length)
    expect(seed.connections.length).toBeGreaterThan(100)
  })

  it('is deterministic', () => {
    expect(JSON.stringify((buildLegacyFullSeed() as Rec).sourceDevices)).toBe(JSON.stringify(seed.sourceDevices))
  })
})
