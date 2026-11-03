import { describe, expect, it } from 'vitest'
import type { GisHomeView } from '@/entities/gis'
import { prepareTenantHomeView } from './tenant-home-view'

function homeView(overrides: Partial<GisHomeView> = {}): GisHomeView {
  return {
    bbox: [105.7, 20.9, 106, 21.1],
    center: { lon: 105.85, lat: 21 },
    source: 'data_extent',
    ...overrides,
  }
}

describe('prepareTenantHomeView', () => {
  it('keeps a valid tenant extent unchanged', () => {
    const prepared = prepareTenantHomeView(homeView())

    expect(prepared).toEqual({
      homeView: homeView(),
      queryBbox: [105.7, 20.9, 106, 21.1],
      initialExtentPartial: false,
    })
  })

  it('orders axes and expands a point extent into a valid BE bbox', () => {
    const prepared = prepareTenantHomeView(
      homeView({
        bbox: [105.8, 21, 105.8, 21],
        center: { lon: 105.8, lat: 21 },
      })
    )

    expect(prepared).not.toBeNull()
    expect(prepared!.queryBbox[0]).toBeLessThan(105.8)
    expect(prepared!.queryBbox[1]).toBeLessThan(21)
    expect(prepared!.queryBbox[2]).toBeGreaterThan(105.8)
    expect(prepared!.queryBbox[3]).toBeGreaterThan(21)
    expect((prepared!.queryBbox[0] + prepared!.queryBbox[2]) / 2).toBeCloseTo(105.8, 10)
    expect((prepared!.queryBbox[1] + prepared!.queryBbox[3]) / 2).toBeCloseTo(21, 10)
    expect(prepared!.initialExtentPartial).toBe(false)
  })

  it('clamps a large initial query below one square degree and preserves its centre', () => {
    const prepared = prepareTenantHomeView(
      homeView({
        bbox: [104, 19, 108, 23],
        center: { lon: 106, lat: 21 },
      })
    )

    expect(prepared).not.toBeNull()
    const [minLon, minLat, maxLon, maxLat] = prepared!.queryBbox
    expect((maxLon - minLon) * (maxLat - minLat)).toBeLessThan(1)
    expect((minLon + maxLon) / 2).toBeCloseTo(106, 10)
    expect((minLat + maxLat) / 2).toBeCloseTo(21, 10)
    expect(prepared!.homeView.bbox).toEqual([104, 19, 108, 23])
    expect(prepared!.initialExtentPartial).toBe(true)
  })

  it('normalizes reversed coordinates without changing the declared centre', () => {
    const prepared = prepareTenantHomeView(
      homeView({
        bbox: [106, 21.1, 105.7, 20.9],
      })
    )

    expect(prepared?.homeView.bbox).toEqual([105.7, 20.9, 106, 21.1])
    expect(prepared?.homeView.center).toEqual({ lon: 105.85, lat: 21 })
  })

  it('rejects non-finite, out-of-range and inconsistent home views', () => {
    expect(prepareTenantHomeView(homeView({ bbox: [Number.NaN, 20.9, 106, 21.1] }))).toBeNull()
    expect(prepareTenantHomeView(homeView({ bbox: [181, 20.9, 182, 21.1] }))).toBeNull()
    expect(prepareTenantHomeView(homeView({ center: { lon: 107, lat: 21 } }))).toBeNull()
    expect(prepareTenantHomeView(null)).toBeNull()
  })
})
