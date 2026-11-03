import { useQuery } from '@tanstack/solid-query'
import { createEffect, onCleanup } from 'solid-js'
import { mapFeaturesQueryOptions, DEFAULT_BBOX } from '@/entities/map-feature'
import { isDesignEditorApi } from '@/shared/config/editor-api'
import { useMapRuntimeContext } from '@/shared/lib/map-runtime'
import type { FeatureCollection } from 'geojson'

export function MapCanvas(props: {
  snapshotId: string
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { containerRef, port } = useMapRuntimeContext()
  const features = useQuery(() =>
    mapFeaturesQueryOptions(props.snapshotId, DEFAULT_BBOX, !isDesignEditorApi())
  )

  // Wire click subscription once the port exists.
  createEffect(() => {
    const p = port()
    if (!p) return
    const off = p.onFeatureClick(id => props.onSelect(id))
    onCleanup(off)
  })

  // Push features when both the port and the data are ready.
  createEffect(() => {
    const p = port()
    const data = features.data
    if (p && data) p.setFeatures('published', data as unknown as FeatureCollection)
  })

  // Reflect external selection into the map.
  createEffect(() => {
    port()?.setSelection(props.selectedId)
  })

  return <div ref={containerRef} data-testid="map-canvas" class="h-full w-full" />
}
