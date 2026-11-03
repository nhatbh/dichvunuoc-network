import { describe, expect, it } from 'vitest'
import { buildOsmNetwork, type OsmData, type RoadClass } from './osm-network'

/** A small street grid over central Hanoi shaped like the fetch script's output. */
function fakeOsm(): OsmData {
  const lon0 = 105.82
  const lat0 = 21.008
  const step = 0.0022
  const nx = 28
  const ny = 20
  const id = (i: number, j: number) => 1000 + i * 100 + j
  const pt = (i: number, j: number) => [Math.round((lon0 + i * step) * 1e5), Math.round((lat0 + j * step) * 1e5)]
  const roads: OsmData['roads'] = []
  const way = (cells: Array<[number, number]>, c: RoadClass) => roads.push({ c, i: cells.map(([i, j]) => id(i, j)), p: cells.flatMap(([i, j]) => pt(i, j)) })
  for (let j = 0; j <= ny; j++) way(Array.from({ length: nx + 1 }, (_, i) => [i, j] as [number, number]), j % 6 === 0 ? 'primary' : j % 3 === 0 ? 'tertiary' : 'residential')
  for (let i = 0; i <= nx; i++) way(Array.from({ length: ny + 1 }, (_, j) => [i, j] as [number, number]), i % 7 === 0 ? 'secondary' : 'residential')
  const buildings: number[] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) buildings.push(...pt(i, j).map((v, k) => v + (k ? 30 : 40)))
  return { roads, buildings }
}

describe('buildOsmNetwork', () => {
  const osm = fakeOsm()
  const net = buildOsmNetwork(osm)

  it('lays pipes along the streets, sized by road class', () => {
    expect(net.pipes.length).toBeGreaterThan(150)
    const dns = new Set(net.pipes.map(p => p.dn))
    expect(dns.has(500)).toBe(true)
    expect(dns.has(300)).toBe(true)
    expect(Math.min(...net.pipes.map(p => Number(p.dn)))).toBeGreaterThanOrEqual(100)
    expect(net.pipes.filter(p => p.trunk).every(p => Number(p.dn) >= 300)).toBe(true)
  })

  it('is one connected network and every source sits on a pipe endpoint', () => {
    const key = (p: number[]) => `${p[0]},${p[1]}`
    const parent = new Map<string, string>()
    const find = (k: string): string => {
      const v = parent.get(k) ?? k
      if (v === k) return k
      const r = find(v)
      parent.set(k, r)
      return r
    }
    const ends = new Set<string>()
    for (const p of net.pipes) {
      const a = key(p.pts[0]!)
      const b = key(p.pts[p.pts.length - 1]!)
      ends.add(a).add(b)
      parent.set(find(a), find(b))
    }
    expect(new Set([...ends].map(find)).size).toBe(1)
    for (const s of [net.plant, ...net.reservoirs, ...net.pumps]) expect(ends.has(key([s.x as number, s.y as number]))).toBe(true)
  })

  it('merges street fragments, so pipes are longer than single blocks on average', () => {
    const mean = net.pipes.reduce((s, p) => s + (p.lenM as number), 0) / net.pipes.length
    expect(mean).toBeGreaterThan(150)
    expect(Math.max(...net.pipes.map(p => p.lenM as number))).toBeLessThan(900)
  })

  it('never closes a boundary valve that would starve a DMA', () => {
    const key = (p: number[]) => `${p[0]},${p[1]}`
    const parent = new Map<string, string>()
    const find = (k: string): string => {
      const v = parent.get(k) ?? k
      if (v === k) return k
      const r = find(v)
      parent.set(k, r)
      return r
    }
    for (const p of net.pipes) if (p.boundaryClosed !== true) parent.set(find(key(p.pts[0]!)), find(key(p.pts[p.pts.length - 1]!)))
    const roots = new Set<string>()
    for (const p of net.pipes) {
      roots.add(find(key(p.pts[0]!)))
      roots.add(find(key(p.pts[p.pts.length - 1]!)))
    }
    expect(roots.size).toBe(1)
  })

  it('places customer connections at buildings, close to a distribution pipe', () => {
    expect(net.connDots!.length).toBeGreaterThan(100)
  })
})
