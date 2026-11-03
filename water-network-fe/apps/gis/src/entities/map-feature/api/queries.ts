import { queryOptions } from '@tanstack/solid-query'
import { httpClient } from '@/shared/api/http-client'
import { queryKeys } from '@/shared/api/query-keys'
import {
  MapFeatureCollection,
  FeatureSearchResults,
  type Bbox,
  type MapFeatures,
} from '../model/types'

export async function fetchMapFeatures(snapshotId: string, bbox: Bbox): Promise<MapFeatures> {
  const raw = await httpClient.get<unknown>(
    `/snapshot/${snapshotId}/features?bbox=${bbox.join(',')}`
  )
  return MapFeatureCollection.parse(raw)
}

export const mapFeaturesQueryOptions = (snapshotId: string, bbox: Bbox, enabled = true) =>
  queryOptions({
    queryKey: queryKeys.mapFeatures.byBbox(snapshotId, bbox),
    queryFn: () => fetchMapFeatures(snapshotId, bbox),
    enabled,
    staleTime: 1000 * 30,
  })

export async function fetchSearchFeatures(snapshotId: string, q: string) {
  const raw = await httpClient.get<unknown>(
    `/snapshot/${snapshotId}/search?q=${encodeURIComponent(q)}`
  )
  return FeatureSearchResults.parse(raw)
}

export const searchFeaturesQueryOptions = (snapshotId: string, q: string) =>
  queryOptions({
    queryKey: queryKeys.mapFeatures.search(snapshotId, q),
    queryFn: () => fetchSearchFeatures(snapshotId, q),
    enabled: q.trim().length >= 2,
    staleTime: 1000 * 30,
  })
