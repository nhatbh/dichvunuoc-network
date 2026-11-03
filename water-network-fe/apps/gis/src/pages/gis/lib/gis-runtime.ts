import type { GisRuntimePolicy, GisViewerMode } from '@/shared/config/runtime-config'

export type GisExperience = 'legacy-rich' | 'canonical-rich' | 'canonical-scalable'

/**
 * Query-string overrides are smoke-test helpers for the viewer only. They can
 * never cross the backend contract boundary selected by `gisDataSource`.
 */
export function resolveGisExperience(
  policy: GisRuntimePolicy,
  requestedViewer?: string | null
): GisExperience {
  if (policy.dataSource === 'legacy') return 'legacy-rich'

  let viewerOverride: GisViewerMode | undefined
  if (requestedViewer === 'scalable' || requestedViewer === 'canonical') {
    viewerOverride = 'scalable'
  } else if (requestedViewer === 'rich') {
    viewerOverride = 'rich'
  }

  return (viewerOverride ?? policy.viewerMode) === 'scalable'
    ? 'canonical-scalable'
    : 'canonical-rich'
}
