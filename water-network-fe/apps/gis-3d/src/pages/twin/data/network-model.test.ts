import { describe, expect, it } from 'vitest'
import { DEVICE_BY_ID, legsAt, orient } from './network-devices'
import { NET, nominalDn, PIPE_BY_ID, segDist, sizeLabel, solveNetwork } from './network-model'
import { LOD_ZOOM, metresPerPx, midScale, pipeWidth, radiusOf, WIDTH_M_D50 } from '../map/network-lod'

const service = NET.pipes.filter(p => p.kind === 'service')
const base = { entryHead: 40, qZone: 150, qOut: 1300, qRaw: 1400, demandFactor: 1 }

/** service pipes meeting at each node */
const atNode = new Map<string, typeof service>()
for (const p of service) for (const n of [p.from!, p.to!]) (atNode.get(n) ?? atNode.set(n, []).get(n)!).push(p)

describe('service network, processed like the distribution drawing', () => {
  it('hangs every service pipe off a tapping saddle on a distribution pipe', () => {
    const reached = new Set<string>()
    const queue = NET.saddles.map(s => s.id)
    while (queue.length) {
      const n = queue.shift()!
      if (reached.has(n)) continue
      reached.add(n)
      for (const p of atNode.get(n) ?? []) queue.push(p.from === n ? p.to! : p.from!)
    }
    expect(service.length).toBeGreaterThan(700)
    expect(service.filter(p => !reached.has(p.from!))).toEqual([])
  })

  it('puts each saddle on the processed distribution pipe it clamps, with that pipe and the service pipe sizes', () => {
    // all 180 drawn saddles (two that land on one spot share a saddle: "kt38 + kt37")
    expect(NET.saddles.filter(s => !s.assumed).flatMap(s => s.tag.split(' + ')).length).toBe(180)
    for (const s of NET.saddles) {
      const main = PIPE_BY_ID[s.main]!
      expect(['dist', 'trunk']).toContain(main.kind)
      const d = Math.min(...main.path.slice(1).map((b, i) => segDist(s.at, main.path[i]!, b)))
      expect(d).toBeLessThan(0.05)
      expect(s.dn).toBe(main.dn)
      expect((atNode.get(s.id) ?? []).map(p => p.dn)).toContain(s.dn2)
    }
  })

  it('joins pipes with the fitting the pipes meeting there call for', () => {
    const fit = new Map(NET.serviceFittings.map(f => [f.id, f]))
    for (const [node, pipes] of atNode) {
      if (node.startsWith('DKT-')) continue
      const dns = new Set(pipes.map(p => p.dn))
      const f = fit.get(node)
      if (pipes.length === 3) {
        // a tee is reducing when its branch is smaller than its run
        expect(['Tee', 'ReducingTee']).toContain(f?.kind)
        if (dns.size === 1) expect(f?.kind).toBe('Tee')
        if (f?.kind === 'ReducingTee') expect(f.dn2).toBeLessThan(f.dn)
      }
      if (pipes.length === 2 && dns.size > 1) expect(f?.kind).toBe('Reducer')
      if (pipes.length >= 4) expect(f?.kind).toBe('Cross')
      if (f) expect(f.dn).toBe(Math.max(...dns))
    }
    const kinds = NET.serviceFittings.reduce<Record<string, number>>((m, f) => ((m[f.kind] = (m[f.kind] ?? 0) + 1), m), {})
    // the drawing labels 397 caps "B50/B63" and 125 bends "C63"; the tees and reducers come from the pipes
    expect(kinds.Cap).toBeGreaterThan(390)
    expect(kinds.Bend).toBeGreaterThan(110)
    expect(kinds.Tee! + kinds.ReducingTee!).toBeGreaterThan(180)
  })

  it('feeds the service trees from their saddle and cuts them with the distribution pipe', () => {
    const open = solveNetwork({ ...base, closedValves: new Set() })
    const s = service.map(p => open.pipes.get(p.id)!)
    expect(s.every(st => st.supplied)).toBe(true)
    expect(Math.min(...s.map(st => st.p))).toBeGreaterThan(10)
    const shut = solveNetwork({ ...base, closedValves: new Set(NET.valves.map(v => v.code)) })
    expect(service.some(p => !shut.pipes.get(p.id)!.supplied)).toBe(true)
  })
})

/** the catalog's directions on the map for a part turned to `heading`: run ahead, a tee's branch to the right */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const near = (a: number, b: number, tol = 0.35) => Math.abs(wrap(a - b)) < tol

describe('fittings turned to the pipes they join', () => {
  it('points a tee branch at heading − 90°, a bend from one pipe into the other, a reducer to its small pipe', () => {
    // run east–west, branch to the south
    const tee = orient('Tee', [{ h: 0, dn: 63 }, { h: Math.PI, dn: 63 }, { h: -Math.PI / 2, dn: 50 }])
    expect(near(tee.heading - Math.PI / 2, -Math.PI / 2)).toBe(true)
    // branch to the north: the run is turned round
    const tee2 = orient('ReducingTee', [{ h: 0, dn: 63 }, { h: Math.PI, dn: 63 }, { h: Math.PI / 2, dn: 50 }])
    expect(near(tee2.heading - Math.PI / 2, Math.PI / 2)).toBe(true)
    // pipes leave the corner to the west and to the north: a 90° bend
    const bend = orient('Bend', [{ h: Math.PI, dn: 50 }, { h: Math.PI / 2, dn: 50 }])
    expect(bend.angle).toBe(90)
    const exit = bend.heading - (bend.angle! * Math.PI) / 180
    const entryFrom = bend.heading + Math.PI
    expect([entryFrom, exit].every(h => near(h, Math.PI) || near(h, Math.PI / 2))).toBe(true)
    expect(near(entryFrom, exit)).toBe(false)
    const red = orient('Reducer', [{ h: 0, dn: 63 }, { h: Math.PI, dn: 50 }])
    expect(near(red.heading, Math.PI)).toBe(true)
  })

  it('turns every service tee so its branch lies along its branch pipe', () => {
    const pipesAt = new Map<string, typeof service>()
    for (const p of service) for (const n of [p.from!, p.to!]) (pipesAt.get(n) ?? pipesAt.set(n, []).get(n)!).push(p)
    let checked = 0
    let along = 0
    for (const f of NET.serviceFittings) {
      if (f.kind !== 'Tee' && f.kind !== 'ReducingTee') continue
      const legs = legsAt(f.at, pipesAt.get(f.id) ?? [], 0.5)
      const branch = DEVICE_BY_ID[f.id]!.heading - Math.PI / 2
      checked++
      if (legs.some(l => near(l.h, branch, 0.6))) along++
    }
    expect(checked).toBeGreaterThan(180)
    // a few nodes are Y-shaped in the drawing (no straight run), where a 90° tee cannot match exactly
    expect(along / checked).toBeGreaterThan(0.97)
  })
})

describe('the zone branch off the transmission main', () => {
  const tm1 = PIPE_BY_ID['TM-01']!
  const tm2 = PIPE_BY_ID['TM-02']!
  const tm3 = PIPE_BY_ID['TM-03']!
  const tee = DEVICE_BY_ID['TE-TD-01']!
  const end = (p: typeof tm1) => p.path[p.path.length - 1]!
  const d = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)

  it('joins the D1000, the D800 onwards and the D315 branch at one reducing tee', () => {
    expect(d(end(tm1), tee.at)).toBeLessThan(0.01)
    expect(d(tm2.path[0]!, tee.at)).toBeLessThan(0.01)
    expect(d(tm3.path[0]!, tee.at)).toBeLessThan(0.01)
    expect(tee.code).toBe('ReducingTee')
    expect([tee.dn, tee.dn2]).toEqual([1000, 300])
    // its branch points along the D315 branch
    const branch = Math.atan2(tm2.path[1]![1] - tm2.path[0]![1], tm2.path[1]![0] - tm2.path[0]![0])
    expect(near(tee.heading - Math.PI / 2, branch)).toBe(true)
  })

  it('steps the main down to D800 with a reducer and couples the branch to the drawing’s DN315 end', () => {
    const red = DEVICE_BY_ID['CO-TD-01']!
    expect([red.code, red.dn, red.dn2]).toEqual(['Reducer', 1000, 800])
    // the small end points away from the tee, along the D800
    const away = Math.atan2(red.at[1] - tee.at[1], red.at[0] - tee.at[0])
    expect(near(red.heading, away)).toBe(true)
    const coupling = DEVICE_BY_ID['MS-NV-01']!
    expect(d(coupling.at, NET.entry)).toBeLessThan(0.01)
    expect(d(end(tm2), NET.entry)).toBeLessThan(0.01)
    const cadAtEntry = NET.pipes.filter(p => p.kind === 'trunk' && !p.assumed && (d(p.path[0]!, NET.entry) < 1.5 || d(end(p), NET.entry) < 1.5))
    expect(cadAtEntry.length).toBeGreaterThan(0)
    expect(cadAtEntry.every(p => p.dn === 315)).toBe(true)
  })

  it('puts a bend at every turn of the assumed mains', () => {
    for (const p of [tm1, tm2, tm3]) {
      for (let i = 1; i < p.path.length - 1; i++) {
        const legs = legsAt(p.path[i]!, [p])
        const turn = Math.PI - Math.abs(wrap(legs[0]!.h - legs[1]!.h))
        if (turn < (10 * Math.PI) / 180) continue
        expect(DEVICE_BY_ID[`CU-${p.id}-${i}`]?.code).toBe('Bend')
      }
    }
  })
})

describe('pipe sizes', () => {
  it('writes HDPE sizes by outside diameter with their standard DN', () => {
    expect([50, 63, 90, 110, 160, 225, 315].map(d => nominalDn(d))).toEqual([40, 50, 80, 100, 150, 200, 300])
    expect(sizeLabel(110)).toBe('D110 (DN100)')
    expect(sizeLabel(1000, 'Thép')).toBe('D1000')
  })

  it('draws pipes for reading the map: wider with size, a D50 still clearly visible', () => {
    const sizes = [50, 63, 90, 110, 160, 225, 315, 600, 1000]
    const w = sizes.map(dn => pipeWidth(dn))
    expect(w.every((x, i) => i === 0 || x > w[i - 1]!)).toBe(true)
    // square-root growth: a D50 is two thirds of a D110 (not half), a D1000 about 4.5 D50
    expect(pipeWidth(50) / pipeWidth(110)).toBeCloseTo(Math.sqrt(50 / 110))
    expect(radiusOf(service.find(p => p.dn === 50)!)).toBeCloseTo(WIDTH_M_D50 / 2)
  })

  it('widens pipes with the zoom from afar, like roads, and meets the near widths at the switch', () => {
    const zooms = [11, 12, 13, 14, 15, 16, 17, LOD_ZOOM.l2]
    const px = zooms.map(z => pipeWidth(50, z))
    expect(px.every((x, i) => i === 0 || x > px[i - 1]!)).toBe(true)
    expect(pipeWidth(50, 13)).toBeGreaterThanOrEqual(1.5)
    // the near tubes (fixed metres) show as wide as the mid tubes just before the switch
    expect(midScale(LOD_ZOOM.l2)).toBeCloseTo(1, 1)
    expect((WIDTH_M_D50 / metresPerPx(LOD_ZOOM.l2)) / pipeWidth(50, LOD_ZOOM.l2)).toBeGreaterThan(0.9)
    // mid tubes keep their pixel width as the zoom changes
    for (const z of [15.6, 16.5, 17.2]) expect((WIDTH_M_D50 * midScale(z)) / metresPerPx(z)).toBeCloseTo(pipeWidth(50, z), 1)
  })

  it('sizes the parts on HDPE pipes by nominal DN, keeping the drawn outside diameters', () => {
    const saddle = DEVICE_BY_ID[NET.saddles[0]!.id]!
    expect(saddle.od).toBe(NET.saddles[0]!.dn)
    expect(saddle.dn).toBe(nominalDn(NET.saddles[0]!.dn))
    expect(saddle.dn2).toBe(nominalDn(NET.saddles[0]!.dn2))
  })
})
