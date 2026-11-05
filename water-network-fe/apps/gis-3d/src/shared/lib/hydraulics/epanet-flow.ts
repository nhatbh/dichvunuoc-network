/* Hydraulic flow from EPANET (epanet-js, the WASM build of EPANET 2.2).
   The network model (plant, pumps, storage, PRVs, demands, leakage) is built by `network-model.ts`;
   this module solves it, either as one snapshot (the map's water-flow animation) or as a 24 h
   extended-period run (demo telemetry). The WASM module is imported lazily so it stays out of the
   main bundle. */
import { buildNetworkModel, type ModelInput, type ModelOptions, type NetworkModel } from './network-model'

export type { ModelInput, ModelOptions } from './network-model'

export interface HydraulicPipe {
  id: string
  dn: number
  lenM: number
  material: string
  status: string
  noFlow?: boolean
  pts: [[number, number], [number, number]] | [number, number][]
  vertices?: [number, number][]
  from?: string
  to?: string
  year?: number
}

/** Minimal input (editor drafts); the viewer passes the whole GIS dataset, which also carries nodes, valves and sources. */
export interface HydraulicInput extends Omit<ModelInput, 'pipes'> {
  pipes: HydraulicPipe[]
}

export type HydraulicOptions = ModelOptions

export interface PipeFlow {
  flowDir: 'forward' | 'reverse'
  /** Absolute water velocity (m/s). */
  velocity: number
  /** Absolute flow (L/s). */
  flowLps: number
}

export interface BuiltInp {
  inp: string
  /** Pipes that made it into the model (live, non-degenerate). */
  pipeIds: string[]
}

/** The hour the map shows by default (morning peak), so the animation matches the demo telemetry. */
export const DISPLAY_HOUR = 8

/** Pure: GIS network → EPANET INP text for a snapshot. */
export function buildInp(input: HydraulicInput, opts: HydraulicOptions = {}): BuiltInp {
  const m = buildNetworkModel(input as ModelInput, { snapshotHour: DISPLAY_HOUR, ...opts })
  return { inp: m.inp, pipeIds: [...m.pipeLinks.keys()] }
}

/** Below this the pipe is treated as standing water (L/s). */
export const MIN_FLOW_LPS = 1e-4

type EpanetModule = typeof import('epanet-js')
type Ws = InstanceType<EpanetModule['Workspace']>
let loaded: Promise<{ lib: EpanetModule; ws: Ws }> | null = null
/** Load the WASM module once; later solves (e.g. while editing) reuse it. */
export function loadEpanet() {
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
export async function solveHydraulics(input: HydraulicInput, opts?: HydraulicOptions): Promise<Map<string, PipeFlow>> {
  const out = new Map<string, PipeFlow>()
  const model = buildNetworkModel(input as ModelInput, { snapshotHour: DISPLAY_HOUR, ...opts })
  if (!model.pipeLinks.size || !model.plant) return out
  const { lib, ws } = await loadEpanet()
  const project = new lib.Project(ws)
  try {
    ws.writeFile('net.inp', model.inp)
    project.open('net.inp', 'r.rpt', 'o.bin')
    project.solveH()
    for (const [pipeId, { link, flip }] of model.pipeLinks) {
      const i = project.getLinkIndex(link)
      const q = project.getLinkValue(i, lib.LinkProperty.Flow) * (flip ? -1 : 1)
      if (!Number.isFinite(q) || Math.abs(q) < MIN_FLOW_LPS) continue
      out.set(pipeId, {
        flowDir: q < 0 ? 'reverse' : 'forward',
        velocity: Math.abs(project.getLinkValue(i, lib.LinkProperty.Velocity)),
        flowLps: Math.abs(q),
      })
    }
  } catch {
    out.clear()
  } finally {
    try {
      project.close()
    } catch {
      /* already closed */
    }
  }
  return out
}

/** One reporting step of an extended-period run. */
export interface EpsStep {
  /** Seconds since midnight. */
  t: number
  /** Pressure (m) per junction index order of `nodeIds`. */
  pressure: Float64Array
  /** Actual demand (L/s) per node, same order. */
  demand: Float64Array
  /** Flow (L/s, EPANET link direction) per link, order of `linkIds`. */
  flow: Float64Array
  velocity: Float64Array
  /** Tank level (m) by tank id. */
  tankLevel: Record<string, number>
}
export interface EpsResult {
  model: NetworkModel
  nodeIds: string[]
  linkIds: string[]
  steps: EpsStep[]
  /** EPANET warnings / errors raised during the run (empty when clean). */
  warnings: string[]
}

/** 24 h extended-period run, one result every 15 minutes (97 steps, 00:00 to 24:00). */
export async function runExtendedPeriod(input: ModelInput, opts: Omit<ModelOptions, 'snapshotHour'> = {}): Promise<EpsResult> {
  const model = buildNetworkModel(input, opts)
  const { lib, ws } = await loadEpanet()
  const project = new lib.Project(ws)
  const warnings: string[] = []
  const steps: EpsStep[] = []
  try {
    ws.writeFile('eps.inp', model.inp)
    project.open('eps.inp', 'eps.rpt', 'eps.bin')
    const nNodes = project.getCount(lib.CountType.NodeCount)
    const nLinks = project.getCount(lib.CountType.LinkCount)
    const nodeIds = Array.from({ length: nNodes }, (_, i) => project.getNodeId(i + 1))
    const linkIds = Array.from({ length: nLinks }, (_, i) => project.getLinkId(i + 1))
    const tankIdx = model.tanks.map(t => {
      const i = project.getNodeIndex(t.id)
      return { id: t.id, i, z: project.getNodeValue(i, lib.NodeProperty.Elevation) }
    })
    project.openH()
    project.initH(lib.InitHydOption.NoSave)
    for (;;) {
      const t = project.runH()
      if (t % 900 === 0) {
        steps.push({
          t,
          pressure: Float64Array.from(project.getNodeValues(lib.NodeProperty.Pressure)),
          demand: Float64Array.from(project.getNodeValues(lib.NodeProperty.Demand)),
          flow: Float64Array.from(project.getLinkValues(lib.LinkProperty.Flow)),
          velocity: Float64Array.from(project.getLinkValues(lib.LinkProperty.Velocity)),
          tankLevel: Object.fromEntries(tankIdx.map(x => [x.id, project.getNodeValue(x.i, lib.NodeProperty.Head) - x.z])),
        })
      }
      const dt = project.nextH()
      if (dt <= 0) break
    }
    project.closeH()
    const rpt = ws.readFile('eps.rpt')
    for (const line of rpt.split('\n')) if (/WARNING|Error/i.test(line)) warnings.push(line.trim())
    return { model, nodeIds, linkIds, steps, warnings }
  } finally {
    try {
      project.close()
    } catch {
      /* already closed */
    }
  }
}

/** Animation speed (relative m/s) from real velocity: compressed so slow mains still visibly move. */
export function flowSpeedFromVelocity(velocityMps: number): number {
  return 0.2 + 0.9 * Math.sqrt(Math.min(Math.max(velocityMps, 0), 3))
}
