/* Map stage — ONE full-screen network map shared by every panel.

   The shell mounts a single <StageMap/>. Panels (topology, trace, assets …) no
   longer embed their own map: they render <MapOverlay pins focus emphasis …/>,
   which renders nothing and pushes those props onto the stage while the panel is
   mounted. Overlays stack: for each prop the most recently mounted overlay that
   defines it wins; `layers` are merged (an overlay can switch layers ON that it
   needs, never hide the user's choice). The base overlay is the map controller
   (layer visibility, symbology, selection → inspector, measure). */
import { createContext, createMemo, createSignal, onCleanup, useContext, type JSX } from 'solid-js'
import type { Emphasis, FocusBox, LayerVis, Pin, Selection } from '../ui/network-map'
import type { PipeFlow } from '@/shared/lib/hydraulics/epanet-flow'

/** What the operations layer shows on the map at the time cursor. */
export interface OpsMapState {
  /** Sensor (device) id → status at the cursor. */
  status: Record<string, 'normal' | 'warning' | 'critical' | 'offline'>
  /** Pipe flows at the cursor's hour; null = keep the map's own solve. */
  flows: Map<string, PipeFlow> | null
  /** Node pressure (m) at the cursor's hour, when pipes are painted by pressure. */
  pressure: Map<string, number> | null
  /** Changes whenever `flows` / `pressure` change (pipes are restyled only then). */
  pipeKey: string
  /** Pipe colour for a pressure in metres. */
  pressureColor?: (m: number) => string
}

export interface MapOverlayProps {
  layers?: LayerVis
  selected?: Selection
  onSelect?: (s: Selection) => void
  emphasis?: Emphasis | null
  pins?: Pin[]
  focus?: FocusBox | null
  onBg?: () => void
  paint?: { mode?: string }
  legendRows?: { label: string; col: string }[] | null
  measure?: [number, number][] | null
  onMeasureClick?: (pt: [number, number]) => void
  ops?: OpsMapState | null
  /** accepted for drop-in compatibility with NetworkMapOL; the stage owns its chrome */
  controls?: boolean
  legend?: boolean
  theme?: unknown
}

type OverlayKey = Exclude<keyof MapOverlayProps, 'controls' | 'legend' | 'theme'>
const KEYS: OverlayKey[] = [
  'selected',
  'onSelect',
  'emphasis',
  'pins',
  'focus',
  'onBg',
  'paint',
  'legendRows',
  'measure',
  'onMeasureClick',
  'ops',
]

interface StageCtx {
  push: (overlay: MapOverlayProps) => () => void
  merged: () => MapOverlayProps
}

const Ctx = createContext<StageCtx>()

export function MapStageProvider(props: { children: JSX.Element }) {
  const [stack, setStack] = createSignal<MapOverlayProps[]>([])
  const push = (overlay: MapOverlayProps) => {
    setStack(s => [...s, overlay])
    return () => setStack(s => s.filter(o => o !== overlay))
  }
  const merged = createMemo<MapOverlayProps>(() => {
    const s = stack()
    const out: Record<string, unknown> = {}
    for (const key of KEYS) {
      for (let i = s.length - 1; i >= 0; i--) {
        const v = s[i]![key]
        if (v !== undefined) {
          out[key] = v
          break
        }
      }
    }
    const layers: LayerVis = {}
    for (const o of s) {
      const l = o.layers
      if (!l) continue
      // the base (first) overlay sets the user's visibility; later ones only add
      if (o === s[0]) Object.assign(layers, l)
      else for (const [k, on] of Object.entries(l)) if (on) layers[k] = true
    }
    out.layers = layers
    return out as MapOverlayProps
  })
  return <Ctx.Provider value={{ push, merged }}>{props.children}</Ctx.Provider>
}

export function useMapStage(): StageCtx | undefined {
  return useContext(Ctx)
}

/** Drop-in replacement for an embedded <NetworkMapOL/>: drives the shared stage map. */
export function MapOverlay(props: MapOverlayProps): JSX.Element {
  const stage = useMapStage()
  if (stage) onCleanup(stage.push(props))
  return null as unknown as JSX.Element
}
