import type { GisData } from './gis-data'

const ARRAY_FIELDS = [
  'nodes',
  'pipes',
  'valves',
  'hydrants',
  'reservoirs',
  'pumps',
  'dmas',
  'blocks',
  'parks',
  'lake',
  'connDots',
  'connections',
  'LAYERS',
  'assets',
  'MATERIALS',
  'topoIssues',
  'importJobs',
  'importErrors',
  'changeSets',
  'fieldObs',
  'offlinePkgs',
  'ROLES',
] as const

const OBJECT_FIELDS = [
  'pipeBy',
  'plant',
  'ASSET_TYPES',
  'COND',
  'PSTATUS',
  'CTYPE',
  'TOPO_KINDS',
  'isolation',
  'DASH',
  'DATAFLOW',
  'SERVICES',
  'LINK_STATE',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The deployed legacy /full contract predates canonical source devices.
 * Adapt that one optional field here, before any map or inspector reads it.
 * Missing required collections are a contract failure, never an empty network.
 */
export function parseLegacyGisData(raw: unknown): GisData {
  const invalid = () => new Error('Dữ liệu GIS trả về không đúng định dạng.')
  if (!isRecord(raw) || raw.canonical === true) throw invalid()
  if (ARRAY_FIELDS.some(key => !Array.isArray(raw[key]))) throw invalid()
  if (OBJECT_FIELDS.some(key => !isRecord(raw[key]))) throw invalid()
  if (['TODAY', 'SRID', 'river'].some(key => typeof raw[key] !== 'string')) throw invalid()
  if (
    !isRecord(raw.world) ||
    typeof raw.world.w !== 'number' ||
    !Number.isFinite(raw.world.w) ||
    raw.world.w <= 0 ||
    typeof raw.world.h !== 'number' ||
    !Number.isFinite(raw.world.h) ||
    raw.world.h <= 0
  )
    throw invalid()
  if (!isRecord(raw.DASH) || !Array.isArray(raw.DASH.matMix) || !Array.isArray(raw.DASH.condMix))
    throw invalid()
  if (
    !isRecord(raw.DATAFLOW) ||
    !Array.isArray(raw.DATAFLOW.inputs) ||
    !Array.isArray(raw.DATAFLOW.outputs)
  )
    throw invalid()
  if (raw.sourceDevices !== undefined && !Array.isArray(raw.sourceDevices)) throw invalid()

  return { ...raw, sourceDevices: raw.sourceDevices ?? [] } as unknown as GisData
}
