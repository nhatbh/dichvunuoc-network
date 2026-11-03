import { z } from 'zod'
import { DraftFeatureCollection, DraftNetworkFeature, type DraftFeature } from '../model/types'
import type { NetworkFeatureKind } from '@wn/contracts/map-features'
import type { Geometry } from 'geojson'

const DesignPreviewAsset = z.object({
  id: z.string(),
  kind: z.enum(['Node', 'Pipe', 'Device']),
  assetCode: z.string(),
  clientRef: z.string().nullable().optional(),
  geometryType: z.enum(['Point', 'LineString']),
  coordinates: z.array(z.array(z.number())),
  fromRef: z.string().nullable().optional(),
  toRef: z.string().nullable().optional(),
  hostRef: z.string().nullable().optional(),
  attributes: z.record(z.string()).optional().default({}),
})

const DesignPreview = z.array(DesignPreviewAsset)

const DRAFT_KIND: Record<'Node' | 'Pipe' | 'Device', NetworkFeatureKind> = {
  Node: 'node',
  Pipe: 'pipe',
  Device: 'component',
}

const DESIGN_KIND: Partial<Record<NetworkFeatureKind, 'Node' | 'Pipe' | 'Device'>> = {
  node: 'Node',
  pipe: 'Pipe',
  component: 'Device',
}

export interface DesignGeometry {
  type: 'Point' | 'LineString'
  coordinates: number[][]
}

export function toDesignGeometry(geometry: Geometry): DesignGeometry {
  if (geometry.type === 'Point') {
    return { type: 'Point', coordinates: [geometry.coordinates] }
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: geometry.coordinates }
  }
  throw new Error('Design BFF hiện chỉ hỗ trợ hình học điểm và đường.')
}

export function toDesignKind(kind: NetworkFeatureKind): 'Node' | 'Pipe' | 'Device' {
  const mapped = DESIGN_KIND[kind]
  if (!mapped) throw new Error(`Design BFF chưa hỗ trợ loại đối tượng ${kind}.`)
  return mapped
}

export function designPreviewToDraftFeatures(raw: unknown) {
  const assets = DesignPreview.parse(raw)
  return DraftFeatureCollection.parse({
    type: 'FeatureCollection',
    features: assets.map(asset => ({
      type: 'Feature',
      id: asset.id,
      geometry: {
        type: asset.geometryType,
        coordinates:
          asset.geometryType === 'Point' ? (asset.coordinates[0] ?? []) : asset.coordinates,
      },
      properties: {
        kind: DRAFT_KIND[asset.kind],
        name: asset.assetCode,
        status: 'draft',
      },
    })),
  })
}

export function makeDraftFeature(
  id: string,
  kind: NetworkFeatureKind,
  geometry: Geometry,
  name?: string
): DraftFeature {
  return DraftNetworkFeature.parse({
    type: 'Feature',
    id,
    geometry,
    properties: { kind, name, status: 'draft' },
  })
}
