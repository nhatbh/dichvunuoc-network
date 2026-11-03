import type { FeatureCollection } from 'geojson'
export type GisLayerId = 'pipe' | 'valve' | 'hydrant' | 'node' | 'source' | 'dma' | 'conn'
export type GisBbox = readonly [number, number, number, number]
export type NetworkResponse = Partial<Record<GisLayerId, FeatureCollection>>

export interface GisHomeView {
  bbox: GisBbox
  center: { lon: number; lat: number }
  source: 'data_extent' | 'tenant_override'
}

export interface GisBootstrap {
  schemaVersion: 1
  hasData: boolean
  homeView: GisHomeView | null
  counts: {
    nodes: number
    pipes: number
    devices: number
    total: number
  }
  pipeLengthM: number
  materialMix: { material: string; count: number; lengthM: number }[]
  statusMix: { status: string; count: number }[]
}

export interface CanonicalNetworkData {
  layers: NetworkResponse
  truncated: boolean
  initialExtentPartial?: boolean
  featureCount: number
  limit: number
  bbox: GisBbox
}
export interface GisLayer {
  id: string
  label: string
  grp: string
  on: boolean
  lock?: boolean
  count?: number
}
export interface GisDashboard {
  pipeKm: number
  pipeCount: number
  valveCount: number
  hydrantCount: number
  connCount: number
  dmaCount: number
  topoOpen: number
  csPending: number
  importPending: number
  fieldPending: number
  geocodedPct: number
  rtkPct: number
  condMix: { k: string; label: string; col: string; n: number }[]
  matMix: { label: string; n: number }[]
}
