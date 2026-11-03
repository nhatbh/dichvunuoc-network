import { httpClient } from '@/shared/api/http-client'
import { DESIGN_BFF_PATH, isDesignEditorApi } from '@/shared/config/editor-api'
import { makeDraftFeature, toDesignGeometry, toDesignKind } from './design-adapter'
import { DraftNetworkFeature, type DraftFeature } from '../model/types'
import type { NetworkFeatureKind } from '@wn/contracts/map-features'
import type { Geometry } from 'geojson'

export interface CreateDraftFeatureArgs {
  kind: NetworkFeatureKind
  geometry: Geometry
}

/** CQRS command: append a feature to the draft. Carries a correlationId envelope. */
export async function createDraftFeature(
  snapshotId: string,
  args: CreateDraftFeatureArgs
): Promise<DraftFeature> {
  if (isDesignEditorApi()) {
    const clientRef = crypto.randomUUID()
    const assetCode = `LOCAL-${args.kind.toUpperCase()}-${clientRef.slice(0, 8)}`
    const raw = await httpClient.post<unknown>(
      `${DESIGN_BFF_PATH}/revisions/${snapshotId}/draft-assets`,
      {
        kind: toDesignKind(args.kind),
        assetCode,
        clientRef,
        geometry: toDesignGeometry(args.geometry),
        attributes: { source: 'local-ui' },
        fromRef: null,
        toRef: null,
        hostRef: null,
      }
    )
    const id =
      typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : undefined
    if (!id) throw new Error('Design BFF không trả về mã đối tượng vừa tạo.')
    return makeDraftFeature(id, args.kind, args.geometry, assetCode)
  }
  const raw = await httpClient.post<unknown>(`/snapshot/${snapshotId}/draft/features`, {
    kind: args.kind,
    geometry: args.geometry,
    correlationId: crypto.randomUUID(),
  })
  return DraftNetworkFeature.parse(raw)
}

export interface UpdateDraftFeatureGeometryArgs {
  geometry: Geometry
}

/** CQRS command: replace a draft feature's geometry. Last-write-wins (no version yet). */
export async function updateDraftFeatureGeometry(
  snapshotId: string,
  featureId: string,
  args: UpdateDraftFeatureGeometryArgs
): Promise<DraftFeature> {
  if (isDesignEditorApi()) {
    await httpClient.patch(`${DESIGN_BFF_PATH}/draft-assets/${featureId}/geometry`, {
      geometry: toDesignGeometry(args.geometry),
    })
    return makeDraftFeature(featureId, 'component', args.geometry)
  }
  const raw = await httpClient.patch<unknown>(
    `/snapshot/${snapshotId}/draft/features/${featureId}`,
    { geometry: args.geometry, correlationId: crypto.randomUUID() }
  )
  return DraftNetworkFeature.parse(raw)
}

export interface SplitPipeArgs {
  atPoint: Geometry // Point (EPSG:4326), already on the pipe line
}

/** CQRS command: split a pipe at a point into two pipes. Mock computes the geometry. */
export async function splitPipe(
  snapshotId: string,
  pipeId: string,
  args: SplitPipeArgs
): Promise<DraftFeature[]> {
  if (isDesignEditorApi()) {
    throw new Error('Design BFF dev chưa có lệnh tách đường ống.')
  }
  const raw = await httpClient.post<unknown>(
    `/snapshot/${snapshotId}/draft/features/${pipeId}/split`,
    { atPoint: args.atPoint, correlationId: crypto.randomUUID() }
  )
  return DraftNetworkFeature.array().parse(raw)
}

export interface ConnectNodeToPipeArgs {
  nodeId: string
  atPoint: Geometry // Point (EPSG:4326), already on the pipe line
}

/** CQRS command: connect a node to a pipe at a point. Mock splits the pipe (if interior) and
 *  writes bidirectional connectivity. Returns the affected features (pipe(s) + moved node). */
export async function connectNodeToPipe(
  snapshotId: string,
  pipeId: string,
  args: ConnectNodeToPipeArgs
): Promise<DraftFeature[]> {
  if (isDesignEditorApi()) {
    throw new Error('Design BFF dev chưa có lệnh nối nút vào đường ống.')
  }
  const raw = await httpClient.post<unknown>(
    `/snapshot/${snapshotId}/draft/features/${pipeId}/connect`,
    { nodeId: args.nodeId, atPoint: args.atPoint, correlationId: crypto.randomUUID() }
  )
  return DraftNetworkFeature.array().parse(raw)
}
