/* Bản đồ mạng lưới GIS — OpenLayers renderer for the rich application shell.
   Canonical datasets carry a per-tenant pixel↔WGS84 transform derived from their
   own extent; legacy design data keeps the original Hanoi affine fallback. */
import {
  pxToLonLat,
  pxBboxToExtent,
  type MapEnginePort,
  type FeatureStyle3D,
  type StyleSpec,
  type FeatureStyle,
} from '@wn/map-runtime-3d'
import { createMapRuntime } from '@wn/map-runtime-3d/solid'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { Map3DControls } from '@/features/map-3d-controls'
import { createFlowSolver } from '../lib/flow-solver'
import { StatusDot } from './kit'
import {
  FITTING_3D_SCALE,
  IMAGERY_CASING,
  PIPE_3D_SCALE,
  SELECTED_3D_SCALE,
  SELECTION_COLOR,
  isImageryBasemap,
  pipeColor,
  pipeFlow,
  pipeTube,
  pipeWidth,
} from './pipe-style'
import {
  gisPixelBboxToExtent,
  gisPixelToLonLat,
  useGis,
} from '../lib/gis-data'
import { IcExpand, IcMinus, IcPlus, IcLayers, IcCheck } from '../lib/icons'
import { cAccent, chex, cTheme, tone, type ThemeName } from '../lib/theme'
import type { Emphasis, FocusBox, LayerVis, Pin, Selection } from './network-map'
import type { FeatureCollection, Feature } from 'geojson'

/* ── FeatureCollection builders (pixel → 4326) ── */
const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })
type CoordinateProjector = (x: number, y: number) => [number, number]
const lineFeat = (
  id: string,
  pts: readonly [number, number][],
  props: Record<string, unknown>,
  project: CoordinateProjector
): Feature => ({
  type: 'Feature',
  id,
  geometry: { type: 'LineString', coordinates: pts.map(c => project(c[0], c[1])) },
  properties: props,
})
const pointFeat = (
  id: string,
  x: number,
  y: number,
  props: Record<string, unknown>,
  project: CoordinateProjector
): Feature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: project(x, y) },
  properties: props,
})
const ring = (poly: [number, number][], project: CoordinateProjector): [number, number][] => {
  const first = poly[0] ?? [0, 0]
  return [...poly.map(q => project(q[0], q[1])), project(first[0], first[1])]
}

// Thumbnails use one real tile over Hanoi (z=12, x=3252, y=1803) so each option
// previews its actual basemap style — like Google Maps' layer picker.
const BASEMAP_OPTS = [
  {
    id: 'carto-light',
    label: 'Carto Light',
    thumb: 'https://a.basemaps.cartocdn.com/light_all/12/3252/1803.png',
  },
  {
    id: 'carto-dark',
    label: 'Carto Dark',
    thumb: 'https://a.basemaps.cartocdn.com/dark_all/12/3252/1803.png',
  },
  { id: 'osm', label: 'OSM', thumb: 'https://tile.openstreetmap.org/12/3252/1803.png' },
  {
    id: 'satellite',
    label: 'Vệ tinh',
    thumb:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1803/3252',
  },
  { id: 'none', label: 'Không nền', thumb: '' },
] as const

export { flowSpeedFromPressure } from './pipe-style'

export function NetworkMapOL(props: {
  layers?: LayerVis
  selected?: Selection
  onSelect?: (s: Selection) => void
  emphasis?: Emphasis | null
  pins?: Pin[]
  focus?: FocusBox | null
  theme?: ThemeName
  onBg?: () => void
  controls?: boolean
  legend?: boolean
  paint?: { mode?: string }
  legendRows?: { label: string; col: string }[] | null
  measure?: [number, number][] | null
  onMeasureClick?: (pt: [number, number]) => void
}) {
  const G = useGis()
  const theme = () => props.theme || cTheme()
  const W = G.world.w
  const H = G.world.h
  const projectCoordinate: CoordinateProjector = (x, y) =>
    gisPixelToLonLat(G, x, y) ?? pxToLonLat(x, y)

  // aerial imagery by default: the network reads against real streets, buildings and water
  const defaultBasemap = (): (typeof BASEMAP_OPTS)[number]['id'] => 'satellite'
  const [basemap, setBasemap] = createSignal<(typeof BASEMAP_OPTS)[number]['id']>(defaultBasemap())
  const [bmOpen, setBmOpen] = createSignal(false)

  // Water flow source: EPANET hydraulic solve (direction + velocity) or the pressure-based estimate.
  const [flowSource, setFlowSource] = createSignal<'epanet' | 'pressure'>('epanet')
  const { flows: hydroFlows, solving: hydroSolving } = createFlowSolver(() =>
    flowSource() === 'epanet' ? G : null
  )


  // Initial view: center of the network, low zoom (city scale).
  const [cLon, cLat] = G.geo?.center ?? projectCoordinate(W / 2, H / 2)
  const { containerRef, port } = createMapRuntime({
    view: { center: { lon: cLon, lat: cLat }, zoom: 14, minZoom: 9, maxZoom: 23 },
  })

  // Dev/e2e hook: lets browser tests inspect the live engine.
  createEffect(() => {
    if (import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === 'true')
      (window as unknown as { __networkMap?: unknown }).__networkMap = port()
  })

  const L = () => props.layers || {}
  const emp = () => props.emphasis || {}
  const empSet = createMemo(() => {
    const e = emp().pipes
    return e instanceof Set ? e : new Set(e || [])
  })
  const dimAll = () => !!emp().dim
  const selId = () => (props.selected ? props.selected.id : null)
  const selType = () => (props.selected ? props.selected.type : null)

  /* ── style specs (read reactive state at render time via getProperties props) ── */
  const pipeStyle = (): StyleSpec => {
    const th = theme()
    const paint = props.paint
    const eset = empSet()
    const dim = dimAll()
    const ac = SELECTION_COLOR
    return (p): FeatureStyle => {
      const id = String(p.id ?? '')
      const pipe = G.pipeBy[id]
      if (!pipe) return { stroke: { color: '#7E8997', width: 2 } }
      const col = pipeColor(pipe, th, paint, G)
      const emphasized = eset.has(id)
      const dimmed = dim && !emphasized
      const sel = p.__selected
      const w = pipeWidth(pipe.dn)
      const dash =
        pipe.status === 'planned' ? [8, 5] : pipe.status === 'abandoned' ? [3, 6] : undefined
      const style: FeatureStyle3D = {
        stroke: { color: col, width: w, dash },
        opacity: dimmed ? 0.16 : 1,
        tube: pipeTube(pipe.dn, sel || emphasized ? ac : col, !!sel),
      }
      const flow = pipeFlow(pipe, hydroFlows())
      if (flow) style.flow = flow
      if (sel || emphasized) style.halo = { color: ac, width: w + 5 }
      else if (isImageryBasemap(basemap())) style.halo = { color: IMAGERY_CASING, width: w + 2.5 }
      return style
    }
  }

  const dmaStyle = (): StyleSpec => {
    const th = theme()
    const dim = dimAll()
    return (d): FeatureStyle => {
      const id = String(d.id ?? '')
      const col = (d.col as string) || '#9A6700'
      const sel = selType() === 'dma' && selId() === id
      return {
        fill: chex(col, th === 'light' ? 0.07 : 0.1),
        stroke: { color: tone(col), width: sel ? 2.6 : 1.4, dash: [7, 5] },
        opacity: dim ? 0.4 : 1,
      }
    }
  }

  const valveStyle = (): StyleSpec => {
    const th = theme()
    const e = emp()
    const dim = dimAll()
    const ac = SELECTION_COLOR
    return (v): FeatureStyle => {
      const id = String(v.id ?? '')
      const kind = (v.vkind as string) || (v.kind as string)
      const state = v.state as string
      const closed =
        (e.valvesClosed && e.valvesClosed.has(id)) || (!e.valvesClosed && state === 'closed')
      const opened = !!(e.valvesOpen && e.valvesOpen.has(id))
      const sel = v.__selected
      const col = closed ? tone('#D1242F') : kind === 'boundary' ? tone('#0969DA') : tone('#0E7C86')
      const sz = sel ? 6 : kind === 'boundary' ? 4.6 : 3.8
      const dimmed = dim && !sel && !closed && !opened
      // body sized from the pipe it sits on (same boost as the tube), so it reads as a valve on that pipe
      const dnM = (Math.max(Number(v.dn) || 100, 50) / 1000) * PIPE_3D_SCALE
      const style: FeatureStyle3D = {
        solid: {
          shape: 'box',
          size: sel ? [dnM * 1.5 * SELECTED_3D_SCALE, dnM * 1.5 * SELECTED_3D_SCALE, dnM * 1.5 * SELECTED_3D_SCALE] : [dnM * 1.5, dnM * 1.5, dnM * 1.5],
          color: sel ? ac : closed ? '#D1242F' : '#0969DA',
        },
        image: {
          shape: 'diamond',
          radius: sz * 1.25,
          color: closed ? col : th === 'light' ? '#ffffff' : '#0D1117',
          stroke: col,
          strokeWidth: 1.6,
        },
        opacity: dimmed ? 0.2 : 1,
      }
      if (sel || opened) style.halo = { color: ac, width: 2 }
      return style
    }
  }

  const hydrantStyle = (): StyleSpec => {
    const dim = dimAll()
    const ac = SELECTION_COLOR
    return (h): FeatureStyle => {
      const sel = h.__selected
      const k = sel ? SELECTED_3D_SCALE : 1
      const fault = (h.status as string) === 'fault'
      const col = fault ? tone('#D86C1F') : tone('#D1242F')
      const style: FeatureStyle3D = {
        solid: {
          shape: 'cylinder',
          size: [0.3 * FITTING_3D_SCALE * k, 0.3 * FITTING_3D_SCALE * k, 0.9 * FITTING_3D_SCALE * k],
          color: sel ? ac : col,
        },
        image: { shape: 'circle', radius: 3.6, color: col, stroke: '#ffffff', strokeWidth: 1.1 },
        opacity: dim && !sel ? 0.3 : 1,
      }
      if (sel) style.halo = { color: ac, width: 2 }
      return style
    }
  }

  const nodeStyle = (): StyleSpec => {
    const th = theme()
    const ac = SELECTION_COLOR
    return (n): FeatureStyle => {
      const sel = n.__selected
      return {
        image: {
          shape: 'circle',
          radius: sel ? 4.5 : 2.6,
          color: th === 'light' ? '#ffffff' : '#0D1117',
          stroke: sel ? ac : tone('#8250DF'),
          strokeWidth: sel ? 2 : 1.4,
        },
      }
    }
  }

  const sourceStyle = (): StyleSpec => {
    const th = theme()
    const ac = SELECTION_COLOR
    return (s): FeatureStyle => {
      const sel = s.__selected
      const at = s.assetType as string
      const col =
        at === 'plant' ? tone('#0E7C86') : at === 'reservoir' ? tone('#1A7F37') : tone('#D86C1F')
      const style: FeatureStyle = {
        image: {
          shape: at === 'pump' ? 'circle' : 'square',
          radius: at === 'pump' ? 7 : 9,
          color: th === 'light' ? '#ffffff' : '#10243a',
          stroke: col,
          strokeWidth: 2,
        },
      }
      if (sel) style.halo = { color: ac, width: 2 }
      return style
    }
  }

  const connStyle = (): StyleSpec => {
    const th = theme()
    const dim = dimAll()
    return (): FeatureStyle3D => ({
      // water-meter block on the service connection
      solid: {
        shape: 'box',
        size: [0.4 * FITTING_3D_SCALE, 0.3 * FITTING_3D_SCALE, 0.25 * FITTING_3D_SCALE],
        color: th === 'light' ? '#C9972A' : '#E3B341',
      },
      image: {
        shape: 'circle',
        radius: 2,
        color: th === 'light' ? '#9A6700' : '#E3B341',
        stroke: 'rgba(0,0,0,0)',
        strokeWidth: 0,
      },
      opacity: dim ? 0.25 : 0.62,
    })
  }

  const pinStyle = (): StyleSpec => {
    const ac = cAccent()
    return (p): FeatureStyle => {
      const col = (p.col as string) || ac
      const diamond = (p.shape as string) === 'diamond'
      const sel = !!p.sel
      const style: FeatureStyle = {
        image: {
          shape: diamond ? 'diamond' : 'circle',
          radius: diamond ? 6.5 : 7,
          color: col,
          stroke: '#ffffff',
          strokeWidth: 1.4,
        },
      }
      if (sel || p.pulse) style.halo = { color: sel ? ac : col, width: 2 }
      return style
    }
  }

  /* ── build + push a layer's FC when its toggle / inputs change ── */
  function pushLayer(
    p: MapEnginePort,
    key: string,
    enabled: boolean,
    build: () => FeatureCollection,
    style: StyleSpec
  ) {
    if (enabled) {
      p.setFeatures(key, build(), style)
      p.setLayerVisible(key, true)
    } else {
      p.setFeatures(key, fc([]), style)
      p.setLayerVisible(key, false)
    }
  }

  const buildPipe = () =>
    fc(
      G.pipes.map(p =>
        lineFeat(
          p.id,
          p.vertices ?? p.pts,
          { kind: 'pipe', id: p.id, dn: p.dn, status: p.status, dma: p.dma },
          projectCoordinate
        )
      )
    )
  const buildDma = () =>
    fc(
      G.dmas.map(d => ({
        type: 'Feature' as const,
        id: d.id,
        geometry: { type: 'Polygon' as const, coordinates: [ring(d.poly, projectCoordinate)] },
        properties: { kind: 'dma', id: d.id, col: d.col },
      }))
    )
  const buildValve = () =>
    fc(
      G.valves.map(v =>
        pointFeat(
          v.id,
          v.x,
          v.y,
          { kind: 'valve', id: v.id, vkind: v.kind, state: v.state, dn: v.dn },
          projectCoordinate
        )
      )
    )
  const buildHydrant = () =>
    fc(
      G.hydrants.map(h =>
        pointFeat(
          h.id,
          h.x,
          h.y,
          { kind: 'hydrant', id: h.id, status: h.status },
          projectCoordinate
        )
      )
    )
  const buildNode = () =>
    fc(G.nodes.map(n => pointFeat(n.id, n.x, n.y, { kind: 'node', id: n.id }, projectCoordinate)))
  const buildConn = () =>
    fc(
      G.connDots.map((c, i) =>
        pointFeat(`conn-${i}`, c.x, c.y, { kind: 'conn' }, projectCoordinate)
      )
    )
  const buildSource = () =>
    fc([
      ...(G.plant.id
        ? [
            pointFeat(
              G.plant.id,
              G.plant.x,
              G.plant.y,
              { kind: 'source', id: G.plant.id, assetType: 'plant' },
              projectCoordinate
            ),
          ]
        : []),
      ...G.reservoirs.map(r =>
        pointFeat(
          r.id,
          r.x,
          r.y,
          { kind: 'source', id: r.id, assetType: 'reservoir' },
          projectCoordinate
        )
      ),
      ...G.pumps.map(s =>
        pointFeat(
          s.id,
          s.x,
          s.y,
          { kind: 'source', id: s.id, assetType: 'pump' },
          projectCoordinate
        )
      ),
      ...G.sourceDevices.map(s =>
        pointFeat(
          s.id,
          s.x,
          s.y,
          { kind: 'source', id: s.id, assetType: s.deviceType },
          projectCoordinate
        )
      ),
    ])
  const buildPins = () =>
    fc(
      (props.pins || []).map((pin, i) =>
        pointFeat(
          `pin-${pin.id ?? i}`,
          pin.x,
          pin.y,
          {
            kind: 'pin',
            col: pin.col,
            shape: pin.shape,
            sel: pin.sel,
            pulse: pin.pulse,
            pinIdx: i,
          },
          projectCoordinate
        )
      )
    )

  /* ── reactive wiring: rebuild geometry layers when toggles change ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    // DMA under everything; conn dots; then lines; then point symbols on top.
    pushLayer(p, 'dma', !!L().dma, buildDma, dmaStyle())
    pushLayer(p, 'conn', !!L().conn, buildConn, connStyle())
    pushLayer(p, 'pipe', !!L().pipe, buildPipe, pipeStyle())
    pushLayer(p, 'node', !!L().node, buildNode, nodeStyle())
    pushLayer(p, 'valve', !!L().valve, buildValve, valveStyle())
    pushLayer(p, 'hydrant', !!L().hydrant, buildHydrant, hydrantStyle())
    pushLayer(p, 'source', !!L().source, buildSource, sourceStyle())
  })

  // pins layer (always present, possibly empty)
  createEffect(() => {
    const p = port()
    if (!p) return
    void props.pins
    p.setFeatures('pin', buildPins(), pinStyle())
    p.setLayerVisible('pin', true)
  })

  /* ── restyle on emphasis / paint / selection / theme change (no re-add) ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    void props.emphasis
    void props.paint
    void props.selected
    void theme()
    void hydroFlows()
    void basemap()
    p.setLayerStyle('pipe', pipeStyle())
    p.setLayerStyle('valve', valveStyle())
    p.setLayerStyle('hydrant', hydrantStyle())
    p.setLayerStyle('node', nodeStyle())
    p.setLayerStyle('source', sourceStyle())
    p.setLayerStyle('dma', dmaStyle())
    p.setLayerStyle('pin', pinStyle())
  })

  /* ── selection highlight ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    p.setSelection(props.selected ? props.selected.id : null)
  })

  /* ── basemap ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    p.setBasemap(basemap())
  })

  // Every canonical tenant opens on its own data extent. fitToBbox uses the
  // actual rendered container, so this remains correct for dashboard previews
  // and the full-screen map without a hard-coded zoom.
  let homeViewApplied = false
  createEffect(() => {
    const p = port()
    const home = G.geo
    if (!p || !home || homeViewApplied) return
    homeViewApplied = true
    p.fitToBbox(home.bbox, { padding: props.controls === false ? 24 : 64, maxZoom: 17 })
  })

  /* ── focus (pixel bbox → 4326 extent → fit) ── */
  createEffect(() => {
    const f = props.focus
    if (!f) return
    void f._k
    const p = port()
    if (!p) return
    const extent = gisPixelBboxToExtent(G, f) ?? pxBboxToExtent(f)
    p.fitToBbox(extent, { padding: 64, maxZoom: 18 })
  })

  /* ── click → onSelect (pins own onClick); background click → onBg ── */
  let lastClickHadFeature = false
  createEffect(() => {
    const p = port()
    if (!p) return
    const offClick = p.onFeatureClick(fid => {
      const id = String(fid)
      lastClickHadFeature = true
      if (id.startsWith('pin-')) {
        const pins = props.pins || []
        const hit = pins.find((pin, i) => `pin-${pin.id ?? i}` === id)
        hit?.onClick?.()
        return
      }
      if (G.pipeBy[id]) return props.onSelect?.({ type: 'pipe', id })
      if (G.valves.some(v => v.id === id)) return props.onSelect?.({ type: 'valve', id })
      if (G.hydrants.some(h => h.id === id)) return props.onSelect?.({ type: 'hydrant', id })
      if (G.nodes.some(n => n.id === id)) return props.onSelect?.({ type: 'node', id })
      if (G.dmas.some(d => d.id === id)) return props.onSelect?.({ type: 'dma', id })
      if (G.plant.id === id) return props.onSelect?.({ type: 'plant', id })
      if (G.reservoirs.some(r => r.id === id)) return props.onSelect?.({ type: 'reservoir', id })
      if (G.pumps.some(s => s.id === id)) return props.onSelect?.({ type: 'pump', id })
      if (G.sourceDevices.some(s => s.id === id)) return props.onSelect?.({ type: 'device', id })
    })
    onCleanup(offClick)
  })

  // background click (no feature hit) → onBg. ol fires feature-click synchronously
  // inside singleclick, so by the time this DOM click bubbles the flag is set.
  const onContainerClick = () => {
    // microtask: feature-click handlers run synchronously inside ol singleclick,
    // so by the time this DOM click bubbles we know if a feature was hit.
    queueMicrotask(() => {
      if (lastClickHadFeature) {
        lastClickHadFeature = false
        return
      }
      if (props.onMeasureClick) {
        // we don't have pixel coords here; measure is best-effort deferred on OL.
        return
      }
      props.onBg?.()
    })
  }

  const onContainerKeyDown = (event: KeyboardEvent) => {
    if (!['Enter', ' ', 'Escape'].includes(event.key) || props.onMeasureClick) return
    event.preventDefault()
    props.onBg?.()
  }

  const zoomBtn = (dir: number) => {
    const p = port()
    if (!p) return
    const v = p.getView()
    p.setView({ center: v.center, zoom: Math.max(9, Math.min(23, v.zoom + dir)) })
  }
  const fitAll = () => {
    const p = port()
    if (!p) return
    p.fitToBbox(
      gisPixelBboxToExtent(G, { x: 0, y: 0, w: W, h: H }) ??
        pxBboxToExtent({ x: 0, y: 0, w: W, h: H }),
      { padding: 40 }
    )
  }

  return (
    <div class="relative h-full w-full overflow-hidden">
      <div
        ref={containerRef}
        role="button"
        aria-label="Bản đồ mạng lưới; nhấn Enter hoặc Escape để bỏ chọn"
        tabIndex={0}
        class="h-full w-full"
        style={{ 'touch-action': 'none' }}
        onClick={onContainerClick}
        onKeyDown={onContainerKeyDown}
      />

      {/* 3D camera controls (below the zoom/basemap cluster) */}
      <Show when={props.controls !== false}>
        <div class="absolute right-3 top-[330px] z-10">
          <Map3DControls port={port} />
        </div>
      </Show>

      {/* zoom + basemap controls (top-right) */}
      <Show when={props.controls !== false}>
        <div class="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
          <div
            class="flex flex-col overflow-hidden rounded-lg border border-line bg-[var(--surface)]"
            style={{ 'box-shadow': 'var(--card-shadow)' }}
          >
            <button
              onClick={() => zoomBtn(1)}
              title="Phóng to"
              class="flex h-8 w-8 items-center justify-center text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"
            >
              <IcPlus size={16} />
            </button>
            <button
              onClick={() => zoomBtn(-1)}
              title="Thu nhỏ"
              class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"
            >
              <IcMinus size={16} />
            </button>
            <button
              onClick={fitAll}
              title="Toàn mạng"
              class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"
            >
              <IcExpand size={15} />
            </button>
          </div>
          {/* basemap switcher */}
          <div class="relative">
            <button
              onClick={() => setBmOpen(o => !o)}
              title="Nền bản đồ"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-[var(--surface)] text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"
              style={{ 'box-shadow': 'var(--card-shadow)' }}
            >
              <IcLayers size={15} />
            </button>
            <Show when={bmOpen()}>
              <div
                class="absolute right-0 top-9 w-[228px] rounded-xl border border-line bg-[var(--surface)] p-2.5"
                style={{ 'box-shadow': 'var(--toast-shadow)' }}
              >
                <div class="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
                  Nền bản đồ
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <For each={BASEMAP_OPTS}>
                    {o => {
                      const on = () => basemap() === o.id
                      return (
                        <button
                          onClick={() => {
                            setBasemap(o.id)
                            setBmOpen(false)
                          }}
                          title={o.label}
                          class="group flex flex-col gap-1 rounded-lg p-1 text-left transition-colors hover:bg-[var(--surface2)]"
                        >
                          <div
                            class="relative h-[52px] w-full overflow-hidden rounded-md border"
                            style={{
                              'border-color': on() ? 'var(--focus)' : 'var(--line)',
                              'box-shadow': on() ? '0 0 0 2px var(--focus)' : 'none',
                            }}
                          >
                            <Show
                              when={o.thumb}
                              fallback={
                                <div class="flex h-full w-full items-center justify-center bg-[var(--surface2)] text-[color:var(--muted2)]">
                                  <IcMinus size={16} />
                                </div>
                              }
                            >
                              <img
                                src={o.thumb}
                                alt={o.label}
                                class="h-full w-full object-cover"
                                loading="lazy"
                                draggable={false}
                              />
                            </Show>
                            <Show when={on()}>
                              <span
                                class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-white"
                                style={{ background: 'var(--focus)' }}
                              >
                                <IcCheck size={11} />
                              </span>
                            </Show>
                          </div>
                          <span
                            class="px-0.5 text-[11px] font-medium"
                            classList={{
                              'text-[color:var(--text)]': on(),
                              'text-[color:var(--muted)]': !on(),
                            }}
                          >
                            {o.label}
                          </span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* flow source toggle */}
      <Show when={props.controls !== false}>
        <div
          class="absolute bottom-14 left-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-[var(--surface)]/90 p-0.5 text-[10.5px] backdrop-blur"
          role="group"
          aria-label="Nguồn dữ liệu dòng chảy"
          data-testid="flow-source"
        >
          <span class="px-1.5 text-[color:var(--muted2)]">Dòng chảy</span>
          <For each={[['epanet', 'EPANET'], ['pressure', 'Áp suất']] as const}>
            {([id, label]) => (
              <button
                type="button"
                aria-pressed={flowSource() === id}
                onClick={() => setFlowSource(id)}
                class="rounded-md px-2 py-0.5 font-medium transition-colors"
                classList={{
                  'bg-[var(--focus)] text-white': flowSource() === id,
                  'text-[color:var(--muted)] hover:bg-[var(--surface2)]': flowSource() !== id,
                }}
              >
                {label}
                <Show when={id === 'epanet' && flowSource() === 'epanet' && hydroSolving()}> …</Show>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* legend (reuses design markup) */}
      <Show when={props.legend !== false}>
        <div
          class="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-line bg-[var(--surface)]/90 px-3 py-1.5 text-[10.5px] text-[color:var(--muted)] backdrop-blur"
          style={{ 'max-width': '440px' }}
        >
          <Show
            when={props.legendRows && props.legendRows.length}
            fallback={
              <>
                <span class="flex items-center gap-1.5">
                  <span
                    class="inline-block h-[3px] w-5 rounded"
                    style={{ background: tone('#0E7C86') }}
                  />
                  Ống chính
                </span>
                <span class="flex items-center gap-1.5">
                  <span
                    class="inline-block h-[3px] w-5 rounded"
                    style={{ background: theme() === 'light' ? '#3FA0A8' : '#7fd0db' }}
                  />
                  Ống phân phối
                </span>
                <span class="flex items-center gap-1.5">
                  <span
                    class="inline-block h-2.5 w-2.5 rotate-45 border"
                    style={{ 'border-color': tone('#0969DA') }}
                  />
                  Van
                </span>
                <span class="flex items-center gap-1.5">
                  <StatusDot color={tone('#D1242F')} size={8} />
                  Rò rỉ / cảnh báo
                </span>
                <span class="flex items-center gap-1.5">
                  <span
                    class="inline-block h-2.5 w-3.5 rounded-sm border border-dashed"
                    style={{ 'border-color': tone('#9A6700') }}
                  />
                  Ranh DMA
                </span>
              </>
            }
          >
            <For each={props.legendRows!}>
              {r => (
                <span class="flex items-center gap-1.5">
                  <span
                    class="inline-block h-[3px] w-5 rounded"
                    style={{ background: tone(r.col) }}
                  />
                  {r.label}
                </span>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  ) as JSX.Element
}

// re-export shared types so screens can import them from this module too.
export type { Selection, LayerVis, Emphasis, FocusBox, Pin } from './network-map'
