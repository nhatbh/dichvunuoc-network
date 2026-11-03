import { queryOptions } from '@tanstack/solid-query'
import { httpClient } from '@/shared/api/http-client'
import type {
  CanonicalNetworkData,
  GisBbox,
  GisBootstrap,
  GisDashboard,
  GisLayer,
  NetworkResponse,
} from './types'
import type { Feature, FeatureCollection } from 'geojson'

export const DEFAULT_CANONICAL_BBOX = [105.7, 20.9, 106.0, 21.1] as const satisfies GisBbox
export const CANONICAL_MAP_LIMIT = 10_000

interface CanonicalMapResponse extends FeatureCollection {
  truncated?: boolean
}

type CanonicalBackendKind = 'node' | 'pipe' | 'device'
type ViewerStyleKind = 'node' | 'pipe' | 'component'

/**
 * The map runtime only styles its lowercase contract kinds. The canonical GIS
 * API uses domain aggregate names instead, so the API boundary owns the mapping:
 * Node -> node, Pipe -> pipe, Device -> component.
 */
const VIEWER_STYLE_KIND: Record<CanonicalBackendKind, ViewerStyleKind> = {
  node: 'node',
  pipe: 'pipe',
  device: 'component',
}

/** Device subtypes are split into the existing viewer layers; all other
 * canonical devices deliberately share the generic `source` layer. */
const DEVICE_ASSET_TYPE: Record<string, keyof NetworkResponse> = {
  valve: 'valve',
  isolationvalve: 'valve',
  hydrant: 'hydrant',
  flowmeter: 'source',
  pump: 'source',
  pressuresensor: 'source',
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function canonicalKind(properties: Record<string, unknown>): CanonicalBackendKind | undefined {
  const kind = String(properties.kind ?? '')
    .trim()
    .toLowerCase()
  return kind === 'node' || kind === 'pipe' || kind === 'device' ? kind : undefined
}

function assetTypeFor(
  kind: CanonicalBackendKind | undefined,
  properties: Record<string, unknown>
): keyof NetworkResponse {
  if (kind === 'node') return 'node'
  if (kind === 'pipe') return 'pipe'
  if (kind === 'device') {
    const deviceType = String(properties.deviceType ?? '')
      .replaceAll(/[^a-z0-9]/gi, '')
      .toLowerCase()
    return DEVICE_ASSET_TYPE[deviceType] ?? 'source'
  }
  return 'source'
}

/**
 * Adapt the BE GeoJSON property bag without discarding domain fields. Raw
 * `assetCode`, `diameterMm`, `deviceType`, etc. remain available while the
 * viewer receives the aliases it needs for styling and inspection.
 */
export function normalizeCanonicalFeature(feature: Feature): Feature {
  const raw = (feature.properties ?? {}) as Record<string, unknown>
  const sourceKind = canonicalKind(raw)
  const assetType = assetTypeFor(sourceKind, raw)
  const fallbackId = feature.id == null ? '' : String(feature.id)
  const code = nonEmptyString(raw.code) ?? nonEmptyString(raw.assetCode) ?? fallbackId
  const name = nonEmptyString(raw.name) ?? code
  const diameter = raw.dn ?? raw.diameterMm

  return {
    ...feature,
    properties: {
      ...raw,
      kind: sourceKind ? VIEWER_STYLE_KIND[sourceKind] : 'component',
      assetType,
      code,
      name,
      ...(diameter == null ? {} : { dn: diameter }),
    },
  }
}

function layerId(feature: Feature): keyof NetworkResponse {
  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const assetType = String(properties.assetType ?? '')
  if (
    assetType === 'node' ||
    assetType === 'pipe' ||
    assetType === 'valve' ||
    assetType === 'hydrant'
  ) {
    return assetType
  }
  return 'source'
}

export function toNetworkResponse(collection: CanonicalMapResponse): NetworkResponse {
  const layers: NetworkResponse = {}
  for (const feature of collection.features) {
    const normalized = normalizeCanonicalFeature(feature)
    const id = layerId(normalized)
    const target = (layers[id] ??= { type: 'FeatureCollection', features: [] })
    target.features.push(normalized)
  }
  return layers
}

export const dashboardQueryOptions = () =>
  queryOptions({
    queryKey: ['gis', 'dashboard'],
    queryFn: () => httpClient.get<GisDashboard>('/dashboard'),
  })

export const bootstrapQueryOptions = () =>
  queryOptions({
    queryKey: ['gis', 'bootstrap'],
    queryFn: () => httpClient.get<GisBootstrap>('/bootstrap'),
    staleTime: 60_000,
  })

export const layersQueryOptions = () =>
  queryOptions({
    queryKey: ['gis', 'layers'],
    queryFn: async (): Promise<GisLayer[]> => [
      { id: 'pipe', label: 'Tuyến ống', grp: 'Mạng lưới', on: true },
      { id: 'node', label: 'Nút mạng', grp: 'Mạng lưới', on: true },
      { id: 'valve', label: 'Van', grp: 'Thiết bị', on: true },
      { id: 'hydrant', label: 'Trụ cứu hỏa', grp: 'Thiết bị', on: true },
      { id: 'source', label: 'Thiết bị khác', grp: 'Thiết bị', on: true },
    ],
    staleTime: Infinity,
  })

export async function fetchNetwork(
  bbox: GisBbox,
  limit = CANONICAL_MAP_LIMIT
): Promise<CanonicalNetworkData> {
  const raw = await httpClient.get<CanonicalMapResponse>(
    `/map?bbox=${bbox.join(',')}&types=node,pipe,device&limit=${limit}`
  )
  return {
    layers: toNetworkResponse(raw),
    truncated: raw.truncated === true,
    featureCount: raw.features.length,
    limit,
    bbox,
  }
}

export const networkQueryOptions = (bbox: GisBbox = DEFAULT_CANONICAL_BBOX, enabled = true) =>
  queryOptions({
    queryKey: ['gis', 'network', 'bbox', ...bbox, CANONICAL_MAP_LIMIT],
    queryFn: () => fetchNetwork(bbox),
    enabled,
    staleTime: 30_000,
  })
