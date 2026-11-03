/* Hydraulic flow from EPANET (epanet-js, the WASM build of EPANET 2.2).
   Builds an INP from the GIS pipe network, solves a single steady-state snapshot and returns,
   per pipe, the flow direction (sign of the flow vs. the drawn line) and the water velocity.
   The WASM module is imported lazily so it stays out of the main bundle. */

export interface HydraulicPipe {
  id: string
  dn: number
  lenM: number
  material: string
  status: string
  noFlow?: boolean
  pts: [[number, number], [number, number]]
}

export interface HydraulicInput {
  pipes: HydraulicPipe[]
  /** Customer connections (pixel-plane points); each draws `demandLps` at the nearest node. */
  connDots: { x: number; y: number }[]
  plant: { x: number; y: number }
}

export interface HydraulicOptions {
  /** Hydraulic head of the source (m). */
  sourceHeadM?: number
  /** Demand per customer connection (L/s). */
  demandLps?: number
  /** Endpoints closer than this (pixel-plane units) are one node. */
  snapPx?: number
}

export interface PipeFlow {
  flowDir: 'forward' | 'reverse'
  /** Absolute water velocity (m/s). */
  velocity: number
  /** Absolute flow (L/s). */
  flowLps: number
}

const ROUGHNESS: Record<string, number> = {
  'Gang dẻo': 130,
  HDPE: 150,
  uPVC: 150,
  Thép: 120,
  'Gang xám': 100,
}

export interface BuiltInp {
  inp: string
  /** Pipes that made it into the model (live, non-degenerate). */
  pipeIds: string[]
}

/** Pure: pipe network → EPANET INP text. */
export function buildInp(input: HydraulicInput, opts: HydraulicOptions = {}): BuiltInp {
  const { sourceHeadM = 80, demandLps = 0.1, snapPx = 3 } = opts
  const nodes = new Map<string, { id: string; x: number; y: number; demand: number }>()
  const nodeAt = (p: [number, number]) => {
    const k = `${Math.round(p[0] / snapPx)},${Math.round(p[1] / snapPx)}`
    let n = nodes.get(k)
    if (!n) {
      n = { id: `N${nodes.size + 1}`, x: p[0], y: p[1], demand: 0 }
      nodes.set(k, n)
    }
    return n
  }
  const pipes = input.pipes
    .filter(p => p.status !== 'abandoned' && p.status !== 'planned')
    .map(p => ({ p, a: nodeAt(p.pts[0]), b: nodeAt(p.pts[1]) }))
    .filter(e => e.a !== e.b)
  const list = [...nodes.values()]
  const first = list[0]
  if (!first) return { inp: '', pipeIds: [] }
  const nearest = (x: number, y: number) => {
    let best = first
    let bd = Infinity
    for (const n of list) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2
      if (d < bd) {
        bd = d
        best = n
      }
    }
    return best
  }
  for (const c of input.connDots) nearest(c.x, c.y).demand += demandLps
  const source = nearest(input.plant.x, input.plant.y)

  let inp = '[TITLE]\nGIS network snapshot\n\n[JUNCTIONS]\n'
  for (const n of list) if (n !== source) inp += ` ${n.id}\t10\t${n.demand.toFixed(3)}\n`
  inp += `\n[RESERVOIRS]\n ${source.id}\t${sourceHeadM}\n\n[PIPES]\n`
  for (const { p, a, b } of pipes)
    inp += ` ${p.id}\t${a.id}\t${b.id}\t${Math.max(p.lenM, 1)}\t${Math.max(p.dn, 25)}\t${ROUGHNESS[p.material] ?? 120}\t0\tOpen\n`
  inp += '\n[STATUS]\n'
  for (const { p } of pipes) if (p.noFlow) inp += ` ${p.id}\tClosed\n`
  inp += '\n[OPTIONS]\n Units\tLPS\n Headloss\tH-W\n Accuracy\t0.01\n Trials\t100\n\n[TIMES]\n Duration\t0\n\n[END]\n'
  return { inp, pipeIds: pipes.map(e => e.p.id) }
}

/** Below this the pipe is treated as standing water (L/s). */
export const MIN_FLOW_LPS = 1e-4

type EpanetModule = typeof import('epanet-js')
let loaded: Promise<{ lib: EpanetModule; ws: InstanceType<EpanetModule['Workspace']> }> | null = null
/** Load the WASM module once; later solves (e.g. while editing) reuse it. */
function epanet() {
  loaded ??= (async () => {
    const lib = await import('epanet-js')
    const ws = new lib.Workspace()
    await ws.loadModule()
    return { lib, ws }
  })().catch(e => {
    loaded = null
    throw e
  })
  return loaded
}

/** Solve one steady-state snapshot. Resolves to an empty map if the model cannot be solved. */
export async function solveHydraulics(
  input: HydraulicInput,
  opts?: HydraulicOptions
): Promise<Map<string, PipeFlow>> {
  const out = new Map<string, PipeFlow>()
  const { inp, pipeIds } = buildInp(input, opts)
  if (!pipeIds.length) return out
  const { lib, ws } = await epanet()
  const { Project, LinkProperty } = lib
  const model = new Project(ws)
  try {
    ws.writeFile('net.inp', inp)
    model.open('net.inp', 'r.rpt', 'o.bin')
    model.solveH()
    for (const id of pipeIds) {
      const i = model.getLinkIndex(id)
      const q = model.getLinkValue(i, LinkProperty.Flow)
      if (!Number.isFinite(q) || Math.abs(q) < MIN_FLOW_LPS) continue
      out.set(id, {
        flowDir: q < 0 ? 'reverse' : 'forward',
        velocity: Math.abs(model.getLinkValue(i, LinkProperty.Velocity)),
        flowLps: Math.abs(q),
      })
    }
  } catch {
    out.clear()
  } finally {
    try {
      model.close()
    } catch {
      /* already closed */
    }
  }
  return out
}

/** Animation speed (relative m/s) from real velocity: compressed so slow mains still visibly move. */
export function flowSpeedFromVelocity(velocityMps: number): number {
  return 0.2 + 0.9 * Math.sqrt(Math.min(Math.max(velocityMps, 0), 3))
}
