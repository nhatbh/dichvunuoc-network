import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bboxArea,
  bboxContains,
  bufferBbox,
  isQueryableBbox,
  trackViewportBbox,
  viewportToBbox,
} from './viewport-bbox'
import type { Viewport } from '@wn/map-runtime-3d'

afterEach(() => {
  vi.useRealTimers()
})

describe('viewport bbox', () => {
  it('converts the map view and canvas size to an EPSG:4326 bbox', () => {
    const bbox = viewportToBbox(
      { center: { lon: 105.81, lat: 21.035 }, zoom: 10 },
      { width: 256, height: 256 }
    )

    expect(bbox[0]).toBeLessThan(105.81)
    expect(bbox[1]).toBeLessThan(21.035)
    expect(bbox[2]).toBeGreaterThan(105.81)
    expect(bbox[3]).toBeGreaterThan(21.035)
    expect(bbox[2] - bbox[0]).toBeCloseTo(0.3515625, 5)
  })

  it('halves the geographic width for each zoom level', () => {
    const view = { center: { lon: 105.81, lat: 21.035 }, zoom: 10 }
    const zoom10 = viewportToBbox(view, { width: 800, height: 600 })
    const zoom11 = viewportToBbox({ ...view, zoom: 11 }, { width: 800, height: 600 })

    expect(zoom11[2] - zoom11[0]).toBeCloseTo((zoom10[2] - zoom10[0]) / 2, 5)
  })

  it('buffers requests and reuses them while the visible bbox remains inside', () => {
    const visible = [105.8, 21, 105.82, 21.02] as const
    const request = bufferBbox(visible)

    expect(bboxContains(request, visible)).toBe(true)
    expect(bboxArea(request)).toBeGreaterThan(bboxArea(visible))
    expect(isQueryableBbox(request)).toBe(true)
    expect(isQueryableBbox([105, 20, 107, 22])).toBe(false)
  })
})

describe('trackViewportBbox', () => {
  it('emits immediately, then debounces later map view changes', () => {
    vi.useFakeTimers()
    let view: Viewport = { center: { lon: 105.81, lat: 21.035 }, zoom: 14 }
    const target = document.createElement('div')
    Object.defineProperties(target, {
      clientWidth: { value: 1000, configurable: true },
      clientHeight: { value: 700, configurable: true },
    })
    const onChange = vi.fn()

    const stop = trackViewportBbox({
      getView: () => view,
      target,
      onChange,
      pollMs: 100,
      debounceMs: 300,
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    view = { center: { lon: 105.84, lat: 21.04 }, zoom: 14 }
    vi.advanceTimersByTime(399)
    expect(onChange).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(2)

    view = { center: { lon: 105.85, lat: 21.04 }, zoom: 14 }
    vi.advanceTimersByTime(100)
    view = { center: { lon: 105.86, lat: 21.04 }, zoom: 14 }
    vi.advanceTimersByTime(399)
    expect(onChange).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(3)

    stop()
    view = { center: { lon: 105.9, lat: 21.04 }, zoom: 14 }
    vi.advanceTimersByTime(1000)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('cancels a pending debounce and all polling timers when stopped', () => {
    vi.useFakeTimers()
    let view: Viewport = { center: { lon: 105.81, lat: 21.035 }, zoom: 14 }
    const target = document.createElement('div')
    const onChange = vi.fn()
    const stop = trackViewportBbox({
      getView: () => view,
      target,
      onChange,
      pollMs: 100,
      debounceMs: 300,
    })

    view = { center: { lon: 105.85, lat: 21.04 }, zoom: 14 }
    vi.advanceTimersByTime(100)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1_000)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
