/**
 * EPANET results for the demo network, precomputed by `npm run demo:hydraulics`
 * (scripts/solve-demo-hydraulics.ts) and stored in demo-hydraulics.json, because the seed is built
 * synchronously (MSW handlers, editor mocks) and EPANET runs asynchronously in WASM.
 *
 * The file carries a signature of the generated network; when the network generator changes, the
 * signature no longer matches, the seed falls back to the distance-based estimate, and the
 * hydraulics test fails until the script is re-run.
 */
import { roughness } from '../../lib/hydraulics/network-model'

export { roughness }

export interface DmaBalance {
  id: string
  /** Hourly average flow into the DMA across its boundary (L/s), 24 values. */
  inflowLps: number[]
  /** Hourly average consumption + leakage inside the DMA (L/s). */
  demandLps: number[]
  /** Hourly average flow into storage inside the DMA (L/s, negative while a tank supplies it); inflow = demand + storage. */
  storageLps: number[]
  /** Minimum night flow (L/s, 02:00–04:00). */
  mnfLps: number
  /** Lowest pressure in the DMA at the display hour (m). */
  minPressureM: number
}

export interface DemoEvent {
  kind: 'burst' | 'background'
  dma: string
  nodeId: string
  lps: number
  fromHour?: number
  /** Devices whose readings show it. */
  seenBy: string[]
}

export interface DemoHydraulics {
  signature: string
  displayHour: number
  /** Pipe DN after sizing the network for its peak demand (pipe id → DN). */
  resize: Record<string, number>
  /** Per pipe at the display hour: [signed flow L/s along the drawn line, velocity m/s]. */
  pipes: Record<string, [number, number]>
  /** Per GIS node at the display hour: pressure (m). */
  nodes: Record<string, number>
  /** Per device: its 24 h readings, and `expected` — what it would read on the same day without the leaks. */
  telemetry: Record<string, { unit: string; intervalMin: number; start: string; values: number[]; expected?: number[]; low?: number; high?: number }>
  status: Record<string, 'normal' | 'warning' | 'critical' | 'offline'>
  summary: {
    productionM3d: number
    consumptionM3d: number
    leakageM3d: number
    nrwPct: number
    /** Plant outflow by hour (L/s). */
    plantLps: number[]
    minPressureM: number
    medianPressureM: number
    maxVelocity: number
    /** Tank level by hour (m). */
    tanks: Record<string, number[]>
    dmas: DmaBalance[]
    /** Largest |inflow − demand| over all DMAs and hours, as a share of the DMA demand. */
    balanceError: number
    unsuppliedNodes: number
  }
  events: DemoEvent[]
  /** Model settings the run converged on, to re-solve the same network the same way. */
  settings: {
    /** Elevated tank floor (m) / ground reservoir pump head (m) and overnight fill (L/s), by tank id. */
    storage: Record<string, { floorM?: number; pumpHeadM?: number; fillLps?: number }>
    /** PRV outlet pressure (m) by DMA. */
    prvSettings: Record<string, number>
    /** Pipes upsized by the sizing passes are in `resize`; this is the service pressure they were sized for (m). */
    servicePressureM: number
  }
}

interface SigPipe { id: string; dn: number; from?: string; to?: string; pts: Array<[number, number]>; status?: string; noFlow?: boolean }

/** Stable fingerprint of the generated network (before sizing): pipes, their ends, sizes and closures. */
export function networkSignature(seed: { pipes: SigPipe[]; connDots?: unknown[] }): string {
  let h = 2166136261
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  for (const p of seed.pipes) {
    const a = p.pts[0]!
    const b = p.pts[p.pts.length - 1]!
    mix(`${p.id}|${p.dn}|${Math.round(a[0])},${Math.round(a[1])}|${Math.round(b[0])},${Math.round(b[1])}|${p.status}|${p.noFlow ? 1 : 0};`)
  }
  mix(`conn:${seed.connDots?.length ?? 0}`)
  return `${(h >>> 0).toString(16)}-${seed.pipes.length}`
}

const STANDARD_DN = [100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 1000]

/** Hazen-Williams friction loss (m per km) for `lps` in a pipe of `dn` mm. */
export function unitHeadloss(lps: number, dn: number, material?: string): number {
  const q = Math.abs(lps) / 1000
  return (10.67 * q ** 1.852) / (roughness(material) ** 1.852 * (dn / 1000) ** 4.87) * 1000
}

/** Smallest standard DN that carries `lps` at no more than `vmax` m/s and `maxHf` m/km. */
export function dnFor(lps: number, vmax = 1.3, maxHf = Infinity, c = 120): number {
  for (const dn of STANDARD_DN) {
    const area = Math.PI * (dn / 1000) ** 2 / 4
    const hf = (10.67 * (Math.abs(lps) / 1000) ** 1.852) / (c ** 1.852 * (dn / 1000) ** 4.87) * 1000
    if (Math.abs(lps) / 1000 / area <= vmax && hf <= maxHf) return dn
  }
  return STANDARD_DN[STANDARD_DN.length - 1]!
}
