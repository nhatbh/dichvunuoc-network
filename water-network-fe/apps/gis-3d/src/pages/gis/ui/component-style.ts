/* Catalog components (@wn/component-models) for the network's point assets: which catalog
   model each asset uses, its size, and the bearing of the pipe it sits on. The 3D runtime
   draws the flat symbol on the map and the real model up close (FeatureStyle3D.component). */
import { getCatalogItem, type FeatureStyle3D } from '@wn/map-runtime-3d'
import type { Pipe } from '../lib/gis-data'

export type ComponentStyle = NonNullable<FeatureStyle3D['component']>
type Project = (x: number, y: number) => [number, number]

/** Valve kind (editor / canonical data) → catalog code. */
const VALVE_CODES: Record<string, string> = {
  gate: 'GateValve',
  isolation: 'GateValve',
  boundary: 'GateValve',
  ball: 'BallValve',
  altitude: 'AltitudeValve',
  butterfly: 'ButterflyValve',
  check: 'CheckValve',
  air: 'AirValve',
  prv: 'PRV',
  psv: 'PSV',
  fcv: 'FCV',
  washout: 'Washout',
}
export const valveCode = (kind: string | undefined): string => VALVE_CODES[kind ?? ''] ?? 'GateValve'

/** Pipe material label (Vietnamese UI labels) → backend material code. */
const MATERIAL_CODES: Record<string, string> = {
  'Gang dẻo': 'DuctileIron',
  HDPE: 'HDPE',
  uPVC: 'PVC',
  Thép: 'Steel',
  'Gang xám': 'CastIron',
}
export const materialCode = (label: string | undefined): string | undefined =>
  label ? MATERIAL_CODES[label] : undefined

/** Backend / import device types that are not catalog codes already. */
const DEVICE_ALIASES: Record<string, string> = {
  flowmeter: 'BulkMeter',
  meter: 'BulkMeter',
  bulkmeter: 'BulkMeter',
  pressuresensor: 'PressureSensor',
  pressure: 'PressureSensor',
  logger: 'PressureSensor',
  levelsensor: 'LevelSensor',
  qualitysensor: 'QualitySensor',
  hydrant: 'Hydrant',
  valve: 'GateValve',
  pump: 'Pump',
  tank: 'Tank',
  reservoir: 'Reservoir',
}
/** Device type (catalog code, or a backend / import token) → catalog code; undefined when unknown. */
export function deviceCode(type: string | undefined): string | undefined {
  if (!type) return undefined
  if (getCatalogItem(type)) return type
  return DEVICE_ALIASES[type.replace(/[^a-z]/gi, '').toLowerCase()]
}

/** Size boost per role: parts that sit on a pipe follow the tube boost, other devices the fitting boost, sites stay true size. */
export function componentScale(code: string, pipeScale: number, fittingScale: number): number {
  const role = getCatalogItem(code)?.role
  if (role === 'facility') return 1
  if (role === 'inline' || role === 'node' || role === 'line') return pipeScale
  return fittingScale
}

/** Source / plant asset type → catalog code. */
export const sourceCode = (assetType: string | undefined): string =>
  assetType === 'reservoir' ? 'Reservoir' : assetType === 'pump' ? 'PumpStation' : 'Source'

/**
 * Compass bearing (degrees clockwise from north) of the host pipe at the point, using the
 * pipe segment nearest to it. Undefined when the pipe is unknown or degenerate.
 */
export function hostBearing(
  at: { x: number; y: number },
  pipe: Pick<Pipe, 'pts' | 'vertices'> | undefined,
  project: Project
): number | undefined {
  const line = pipe ? (pipe.vertices ?? pipe.pts) : undefined
  if (!line || line.length < 2) return undefined
  let best = -1
  let bestD = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!
    const b = line[i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    if (l2 === 0) continue
    const t = Math.max(0, Math.min(1, ((at.x - a[0]) * dx + (at.y - a[1]) * dy) / l2))
    const d = Math.hypot(at.x - (a[0] + t * dx), at.y - (a[1] + t * dy))
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  if (best < 0) return undefined
  const a = line[best]!
  const b = line[best + 1]!
  const [lon1, lat1] = project(a[0], a[1])
  const [lon2, lat2] = project(b[0], b[1])
  const east = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  const north = lat2 - lat1
  if (east === 0 && north === 0) return undefined
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
}
