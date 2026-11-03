import { queryOptions } from '@tanstack/solid-query'
import { httpClient } from '@/shared/api/http-client'
import { queryKeys } from '@/shared/api/query-keys'
import { DESIGN_BFF_PATH, isDesignEditorApi } from '@/shared/config/editor-api'
import { designPreviewToDraftFeatures } from './design-adapter'
import { DraftFeatureCollection, type DraftFeatures } from '../model/types'

export async function fetchDraftFeatures(snapshotId: string): Promise<DraftFeatures> {
  if (isDesignEditorApi()) {
    const raw = await httpClient.get<unknown>(`${DESIGN_BFF_PATH}/revisions/${snapshotId}/preview`)
    return designPreviewToDraftFeatures(raw)
  }
  const raw = await httpClient.get<unknown>(`/snapshot/${snapshotId}/draft/features`)
  return DraftFeatureCollection.parse(raw)
}

export const draftFeaturesQueryOptions = (snapshotId: string) =>
  queryOptions({
    queryKey: queryKeys.draftFeatures.all(snapshotId),
    queryFn: () => fetchDraftFeatures(snapshotId),
    staleTime: 1000 * 30,
  })
