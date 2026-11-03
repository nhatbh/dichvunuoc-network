import { describe, expect, it } from 'vitest'
import { gisPixelToLonLat, type GisData } from '@/pages/gis/lib/gis-data'
import { parseLegacyGisData } from '@/pages/gis/lib/legacy-gis-data'
import { buildLegacyFullSeed } from './legacy-full-seed'

describe('buildLegacyFullSeed', () => {
  it('is a valid legacy payload whose pipes all fall inside the geo bbox', () => {
    const data = parseLegacyGisData(buildLegacyFullSeed()) as GisData
    expect(data.pipes.length).toBeGreaterThan(700)
    const [minLon, minLat, maxLon, maxLat] = data.geo!.bbox
    for (const pipe of data.pipes) {
      for (const [x, y] of pipe.pts) {
        const [lon, lat] = gisPixelToLonLat(data, x, y)!
        expect(lon).toBeGreaterThanOrEqual(minLon)
        expect(lon).toBeLessThanOrEqual(maxLon)
        expect(lat).toBeGreaterThanOrEqual(minLat)
        expect(lat).toBeLessThanOrEqual(maxLat)
      }
    }
  })
  it('seeds hydraulics: every pipe has a flow direction and a pressure that varies across the network', () => {
    const data = parseLegacyGisData(buildLegacyFullSeed()) as GisData
    const bars = data.pipes.map(p => p.pressure!)
    expect(data.pipes.every(p => p.flowDir === 'forward' || p.flowDir === 'reverse')).toBe(true)
    expect(data.pipes.some(p => p.flowDir === 'reverse')).toBe(true)
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...bars)).toBeLessThanOrEqual(6.5)
    expect(Math.max(...bars) - Math.min(...bars)).toBeGreaterThan(1.5)
    // the copy in pipeBy stays in sync
    const first = data.pipes[0]!
    expect(data.pipeBy[first.id]!.pressure).toBe(first.pressure)
  })
  it('is a central-Hanoi network: six DMAs, trunk mains, fittings and a plant on the Red River side', () => {
    const data = parseLegacyGisData(buildLegacyFullSeed()) as GisData
    const [lon, lat] = data.geo!.center
    expect(lon).toBeGreaterThan(105.82)
    expect(lon).toBeLessThan(105.89)
    expect(lat).toBeGreaterThan(21.0)
    expect(lat).toBeLessThan(21.06)
    expect(data.dmas).toHaveLength(6)
    expect(data.pipes.filter(p => p.trunk).length).toBeGreaterThan(20)
    expect(Math.max(...data.pipes.map(p => p.dn))).toBeGreaterThanOrEqual(500)
    expect(data.valves.some(v => v.kind === 'boundary')).toBe(true)
    expect(data.hydrants.length).toBeGreaterThan(20)
    expect(data.DASH.pipeCount).toBe(data.pipes.length)
    expect(data.DASH.pipeKm).toBeGreaterThan(100)
  })
  it('is one connected network (no orphan islands) apart from closed-valve isolation', () => {
    const data = parseLegacyGisData(buildLegacyFullSeed()) as GisData
    const key = (p: [number, number]) => `${Math.round(p[0] / 3)},${Math.round(p[1] / 3)}`
    const parent = new Map<string, string>()
    const find = (k: string): string => {
      if (!parent.has(k)) parent.set(k, k)
      const v = parent.get(k)!
      if (v === k) return k
      const r = find(v)
      parent.set(k, r)
      return r
    }
    for (const p of data.pipes) parent.set(find(key(p.pts[0]!)), find(key(p.pts[p.pts.length - 1]!)))
    const roots = new Set([...parent.keys()].map(find))
    expect(roots.size).toBe(1)
  })
  it('ships an asset record for every pipe, valve and hydrant (inspector and search read them)', () => {
    const data = parseLegacyGisData(buildLegacyFullSeed()) as GisData
    expect(data.assets.length).toBe(data.pipes.length + data.valves.length + data.hydrants.length)
    const first = data.pipes[0]!
    const asset = data.assets.find(a => a.id === first.id)!
    expect(asset.type).toBe('pipe')
    expect(asset.code).toBe(first.code)
    expect(asset.attrs['Đường kính (DN)']).toBe(first.dn)
  })
})
