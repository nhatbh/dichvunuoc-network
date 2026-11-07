/* The single full-screen network map, driven by the merged stage overlays. */
import type { JSX } from 'solid-js'
import { useMapStage } from './map-stage'
import { NetworkMapOL } from '../ui/network-map-ol'

export function StageMap(): JSX.Element {
  const stage = useMapStage()
  const m = () => stage?.merged() ?? {}
  return (
    <NetworkMapOL
      stage
      layers={m().layers}
      selected={m().selected}
      onSelect={s => m().onSelect?.(s)}
      emphasis={m().emphasis}
      pins={m().pins}
      focus={m().focus}
      onBg={() => m().onBg?.()}
      paint={m().paint}
      legendRows={m().legendRows}
      measure={m().measure}
      onMeasureClick={m().onMeasureClick}
      ops={m().ops}
    />
  )
}
