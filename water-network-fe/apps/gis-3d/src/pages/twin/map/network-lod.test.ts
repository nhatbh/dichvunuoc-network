import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cutPath, seatFittings, type PipeCuts } from './fitting-seats'
import { bareEnds, bridgePath, findCrossings, LOD_HYSTERESIS, LOD_ZOOM, radiusOf, rampPath, zoomLevel } from './network-lod'
import { buildArrows } from '../three/flow-arrows'
import { buildTubes } from '../three/pipe-mesh'
import type { XY } from '../data/geo'
import type { NetDevice } from '../data/network-devices'
import type { NetPipe } from '../data/network-model'

describe('map level of detail', () => {
  it('takes one level for the whole view from the map zoom', () => {
    expect(zoomLevel(LOD_ZOOM.l2 + 0.1, 0)).toBe(2)
    expect(zoomLevel(LOD_ZOOM.l1 + 0.1, 0)).toBe(1)
    expect(zoomLevel(LOD_ZOOM.l1 - 0.1, 0)).toBe(0)
  })
  it('stays on its level inside the hysteresis band', () => {
    expect(zoomLevel(LOD_ZOOM.l2 - LOD_HYSTERESIS / 2, 2)).toBe(2)
    expect(zoomLevel(LOD_ZOOM.l2 - LOD_HYSTERESIS / 2, 1)).toBe(1)
    expect(zoomLevel(LOD_ZOOM.l1 - LOD_HYSTERESIS / 2, 1)).toBe(1)
    expect(zoomLevel(LOD_ZOOM.l1 - LOD_HYSTERESIS * 2, 1)).toBe(0)
  })
})

describe('pipe tubes', () => {
  const r = 0.5
  const radial = 8
  const ring = radial + 1
  it('draws a polyline as one tube, mitred at its bend, without a gap', () => {
    const { geometry } = buildTubes([{ id: 'a', path: [[0, 0], [10, 0], [10, 10]], radius: r, z: 1 }], radial, false)
    const pos = geometry.getAttribute('position')
    // one ring per vertex, shared by the segments on both sides of the bend
    expect(pos.count).toBe(3 * ring)
    expect(geometry.getIndex()!.count).toBe(2 * radial * 6)
    // the ring at the bend lies on the bisector: its side points are r·√2 from the corner (a 90° mitre)
    for (let i = ring; i < 2 * ring; i++) {
      const dz = pos.getZ(i) - 1
      const horiz = Math.hypot(pos.getX(i) - 10, pos.getY(i))
      const c = Math.sqrt(Math.max(0, r * r - dz * dz)) / r // |cos| of the ring angle
      expect(horiz).toBeCloseTo(c * r * Math.SQRT2, 5)
      expect(Math.abs(pos.getX(i) - 10 + pos.getY(i))).toBeLessThan(1e-5) // on the line x - 10 = -y
    }
  })
  it('closes real pipe ends with a half ball and faces every triangle outwards', () => {
    const { geometry } = buildTubes([{ id: 'a', path: [[0, 0], [10, 0]], radius: r, z: 1, capStart: true, capEnd: true }], radial, false)
    const pos = geometry.getAttribute('position')
    const idx = geometry.getIndex()!
    let xmin = Infinity
    let xmax = -Infinity
    for (let i = 0; i < pos.count; i++) {
      xmin = Math.min(xmin, pos.getX(i))
      xmax = Math.max(xmax, pos.getX(i))
    }
    expect(xmin).toBeCloseTo(-r)
    expect(xmax).toBeCloseTo(10 + r)
    // every triangle's normal points away from the pipe axis (x axis at z = 1)
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
      const p = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)]
      const [A, B, C] = [p(a), p(b), p(c)]
      const u = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!]
      const v = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!]
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
      if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-9) continue // degenerate (a pole)
      const m = [(A[0]! + B[0]! + C[0]!) / 3, (A[1]! + B[1]! + C[1]!) / 3, (A[2]! + B[2]! + C[2]!) / 3]
      const axis = [Math.min(10, Math.max(0, m[0]!)), 0, 1]
      const out = [m[0]! - axis[0]!, m[1]! - axis[1]!, m[2]! - axis[2]!]
      expect(n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!).toBeGreaterThan(0)
    }
  })
})

describe('pipe end caps', () => {
  const pipe = (id: string, dn: number, path: XY[]): NetPipe => ({ id, code: id, kind: 'dist', dn, mat: 'HDPE', len: 0, path, source: 'test' })
  it('closes dead ends, and at a bare junction only the largest pipe', () => {
    const big = pipe('big', 315, [[-50, 0], [0, 0]])
    const a = pipe('a', 110, [[0, 0], [50, 0]])
    const b = pipe('b', 110, [[0, 0.4], [0, 50]])
    const caps = bareEnds([big, a, b], radiusOf)
    expect(caps.get('big')).toEqual([true, true])
    expect(caps.get('a')).toEqual([false, true])
    expect(caps.get('b')).toEqual([false, true])
  })
  it('leaves an end open where a pipe at least as wide runs on through the node', () => {
    const main = pipe('main', 225, [[-50, 0], [50, 0]])
    const branch = pipe('branch', 110, [[0, 0], [0, 50]])
    const caps = bareEnds([main, branch], radiusOf)
    expect(caps.get('branch')).toEqual([false, true])
    expect(caps.get('main')).toEqual([true, true])
  })
})

describe('fitting seats', () => {
  it('does not throw a fitting along a near-straight run', () => {
    const at: XY = [0, 0]
    const pipes: NetPipe[] = [
      { id: 'p1', code: 'p1', kind: 'dist', dn: 110, mat: 'HDPE', len: 20, path: [[-20, 0], at], source: 'test' },
      // a 1° kink: an exact solve along the run would push the coupling metres off its node
      { id: 'p2', code: 'p2', kind: 'dist', dn: 110, mat: 'HDPE', len: 20, path: [at, [20, 0.35]], source: 'test' },
    ]
    const d = { id: 'C', code: 'Coupling', tag: 'C', at, heading: 0, dn: 110, pipe: 'p1', onPipe: true, source: 'test' } as NetDevice
    const { seat } = seatFittings([d], pipes, () => 10, radiusOf)
    const s = seat.get('C')
    expect(s).toBeDefined()
    expect(Math.abs(s![0])).toBeLessThan(0.05)
  })
  it('never cuts a pipe into zero-length pieces', () => {
    const path: XY[] = [[0, 0], [1, 0], [1.05, 0], [3, 0], [3, 2]]
    const cases: PipeCuts[] = [
      { start: 2, end: 2, inner: new Map() },
      { start: 0.5, end: 0, inner: new Map([[1, [0.6, 0.6] as [number, number]]]) },
      { start: 5, end: 5, inner: new Map([[2, [1, 1] as [number, number]], [3, [3, 3] as [number, number]]]) },
    ]
    for (const cuts of cases)
      for (const part of cutPath(path, cuts)) {
        let len = 0
        for (let i = 1; i < part.path.length; i++) len += Math.hypot(part.path[i]![0] - part.path[i - 1]![0], part.path[i]![1] - part.path[i - 1]![1])
        expect(len).toBeGreaterThan(0.05)
        for (const p of part.path) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true)
      }
  })
})

describe('flow arrows', () => {
  it('keeps one even spacing along a pipe across its pieces, thinned or not', () => {
    const a = buildArrows(
      [
        { id: 'p#0', path: [[0, 0], [30, 0], [50, 0.1]], r: 1, d0: 0, ends: [true, false] },
        { id: 'p#1', path: [[50, 0.1], [100, 0.1]], r: 1, d0: Math.hypot(20, 0.1) + 30, ends: [false, true] },
      ],
      new THREE.MeshBasicMaterial(),
      { spacing: () => 8, sides: [0] },
    )!
    const g = a.meshes[0]!.geometry
    const S = g.getAttribute('iS')
    const P = g.getAttribute('iP')
    const mod = (x: number, m: number) => x - m * Math.floor(x / m)
    for (const E of [1, 2, 4])
      for (const dist of [0, 3.7, 123.4]) {
        const st: number[] = []
        for (let i = 0; i < S.count; i++) {
          const step = P.getY(i) * E
          const u0 = S.getZ(i)
          const s = u0 + mod(P.getX(i) + dist - u0, step) + P.getZ(i) * step
          if (s < S.getW(i)) st.push(s)
        }
        st.sort((x, y) => x - y)
        expect(st.length).toBeGreaterThan(2)
        for (let i = 1; i < st.length; i++) expect(st[i]! - st[i - 1]!).toBeCloseTo(8 * E, 3)
      }
  })

  it('ramps a pipe end to its fitting height over the run, adding the vertex where the ramp ends', () => {
    const { path, zs } = rampPath([[0, 0], [10, 0]], 1, [0.5, 0], [0, 0], [2, 0])
    expect(path).toEqual([[0, 0], [2, 0], [10, 0]])
    expect(zs).toEqual([1.5, 1, 1])
    // held at full height up to the socket (1 m in), then down over 2 m
    const held = rampPath([[0, 0], [10, 0]], 1, [0.5, 0], [1, 0], [2, 0])
    expect(held.path).toEqual([[0, 0], [1, 0], [3, 0], [10, 0]])
    expect(held.zs).toEqual([1.5, 1.5, 1, 1])
    const both = rampPath([[0, 0], [4, 0], [10, 0]], 1, [-0.2, 0.4], [0, 0], [1, 2])
    expect(both.path.map(q => q[0])).toEqual([0, 1, 4, 8, 10])
    expect(both.zs[0]).toBeCloseTo(0.8)
    expect(both.zs[2]).toBeCloseTo(1)
    expect(both.zs[4]).toBeCloseTo(1.4)
  })
})

describe('pipes crossing without a joint', () => {
  const pipe = (id: string, dn: number, path: Array<[number, number]>) => ({ id, code: id, kind: 'dist' as const, dn, mat: 'HDPE', len: 0, path, source: '' })
  const big = pipe('A', 315, [[-50, 0], [50, 0]])
  const small = pipe('B', 90, [[0, -50], [0, 50]])
  const r = (p: { dn: number }) => p.dn / 200

  it('bridges the thinner pipe over the thicker one, clear of it', () => {
    const c = findCrossings([big, small], r)
    expect(c.has('A')).toBe(false)
    const [x] = c.get('B')!
    expect(x!.s).toBeCloseTo(50)
    expect(x!.lift).toBeGreaterThan(2 * r(big))
    const b = bridgePath(small.path, undefined, 1, 0, c.get('B')!)
    const top = Math.max(...b.zs)
    expect(top - 1).toBeCloseTo(x!.lift)
    expect(b.zs[0]).toBeCloseTo(1)
    expect(b.zs[b.zs.length - 1]).toBeCloseTo(1)
  })

  it('leaves pipes that are joined where they meet', () => {
    const t = pipe('C', 90, [[0, 0], [0, 50]])
    expect(findCrossings([big, t], r).size).toBe(0)
  })
})
