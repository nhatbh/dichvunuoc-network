import { getCatalogItem } from '@wn/component-models'
import { Boxes, CircleHelp, Factory, Gauge, Hand, Layers, LayoutGrid, MapPin, Minus, MonitorCog } from 'lucide-solid'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js'
import * as THREE from 'three'
import { unitState } from './areas'
import { basemap, RASTERS, setBasemap, type Basemap } from './basemap'
import { CatalogBlock, CatalogIcon } from './catalog-info'
import { CloudVeil, DESCENT_MS, reducedMotion } from './intro'
import { STATE_VI } from './plant-explorer'
import { director, TourButton } from './tour'
import { AlarmBell, AlarmPanel, ChartStack, CloseBtn, Drawer, Flyout, HintBar, isNarrow, persisted, Rail, SimControl, ThemeButton, TopBar, type ChartDef } from './shell'
import { f0, f1, f2, useSim } from './sim-context'
import { Kpi, Row } from './widgets'
import { toLonLat } from '../data/geo'
import { DEVICE_BY_ID, NET_DEVICES } from '../data/network-devices'
import { NET, nominalDn, PIPE_BY_ID, sizeLabel, solveNetwork, type NetworkSolution, type NetPipe } from '../data/network-model'
import { INTAKE, PLANT } from '../data/plant-model'
import { FarOverlay, ZONE_CALLOUT_ZOOM } from '../map/far-overlay'
import { LOD_COLORS, LOD_NAMES, LOD_ZOOM } from '../map/network-lod'
import { TwinLayer, type PickInfo, type RenderStats } from '../map/twin-layer'
import { deviceReadings, deviceStatus } from '../sim/network-devices-state'
import type { HmiTarget } from './hmi/scada'
import type { MapMouseEvent, StyleSpecification } from 'maplibre-gl'

type ColorMode = 'pressure' | 'velocity' | 'dn' | 'kind'

function styleOf(active: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: Object.fromEntries(Object.entries(RASTERS).map(([k, r]) => [k, { type: 'raster', tiles: r.tiles, tileSize: 256, maxzoom: r.max, attribution: r.attribution }])),
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#dfe5e2' } },
      // up close the overzoomed tiles smear their labels under the models: fade the basemap towards the background
      ...Object.keys(RASTERS).map(k => ({
        id: `bm-${k}`,
        type: 'raster' as const,
        source: k,
        layout: { visibility: (k === active ? 'visible' : 'none') as 'visible' | 'none' },
        paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 17, 1, 18.5, 0.6] as ['interpolate', ['linear'], ['zoom'], number, number, number, number] },
      })),
    ],
  }
}

const PRESSURE_STOPS: Array<[number, number]> = [
  [0, 0xb8322f],
  [10, 0xe0603a],
  [18, 0xf2a93b],
  [25, 0x9ccc4c],
  [32, 0x2fb36a],
  [45, 0x1f8fb8],
  [55, 0x2a5fd6],
]
const VEL_STOPS: Array<[number, number]> = [
  [0, 0xc4d8ea],
  [0.15, 0x7fb6e3],
  [0.5, 0x2f86d6],
  [1.0, 0x1d4fa8],
  [1.6, 0x6b2fa8],
]
const DN_COLOR = (dn: number) => (dn >= 800 ? 0x123e7a : dn >= 600 ? 0x8a5a2b : dn >= 315 ? 0x1d6cae : dn >= 225 ? 0x2a86c8 : dn >= 160 ? 0x2fa6a0 : dn >= 110 ? 0x5cb85c : dn >= 90 ? 0x9ccc4c : dn >= 63 ? 0xd0b44a : 0xe0883a)
const KIND_COLOR: Record<NetPipe['kind'], number> = { transmission: 0x123e7a, raw: 0x9c7a4a, trunk: 0x1d6cae, dist: 0x3d8fd1, service: 0x78b6e0 }
const ramp = (stops: Array<[number, number]>, x: number) => {
  if (x <= stops[0]![0]) return new THREE.Color(stops[0]![1])
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i]!
    const [x0, c0] = stops[i - 1]!
    if (x <= x1) return new THREE.Color(c0).lerp(new THREE.Color(c1), (x - x0) / (x1 - x0))
  }
  return new THREE.Color(stops[stops.length - 1]![1])
}
const cssRamp = (stops: Array<[number, number]>, lo: number, hi: number) =>
  `linear-gradient(90deg, ${stops.map(([x, c]) => `#${c.toString(16).padStart(6, '0')} ${(((x - lo) / (hi - lo)) * 100).toFixed(0)}%`).join(', ')})`

const CLOSED_TINT = new THREE.Color(1, 0.35, 0.35)
/** components on the network, by catalog code (for the catalog panel) */
const DEVICE_COUNTS = (() => {
  const m = new Map<string, number>()
  for (const d of NET_DEVICES) m.set(d.code, (m.get(d.code) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
})()

const KIND_LABEL: Record<NetPipe['kind'], string> = {
  transmission: 'Ống truyền dẫn nước sạch',
  raw: 'Ống dẫn nước thô',
  trunk: 'Ống chính phân phối',
  dist: 'Ống phân phối',
  service: 'Ống dịch vụ',
}

type MapFly = 'overview' | 'layers' | 'catalog' | 'perf' | 'alarms' | null
/** sensors that carry a live callout on the map */
const CALLOUTS = NET_DEVICES.filter(d => d.code === 'PressureSensor' || d.code === 'ChlorineAnalyser' || d.id === 'FT-VT3' || d.id === 'AL-3').map(d => d.id)
/** the inlet station's sensors sit metres apart: from afar the zone reading stands for them */
const INLET_STATION = new Set(['FT-VT3', 'PT-VT3-01', 'AIT-VT3'])
const calloutZoom = (id: string) => (INLET_STATION.has(id) ? ZONE_CALLOUT_ZOOM : 12)
const VALVE_CODES = new Set(NET.valves.map(v => v.code))
const RATED = 1208
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

export function MapScreen(props: {
  active: boolean
  /** the opening is over: descend onto the map */
  reveal: boolean
  /** the map and its first tiles have loaded */
  onReady: () => void
  onEnter: (site: 'plant' | 'tb1') => void
  returnTick: number
  onOpenHmi: (t: HmiTarget) => void
}) {
  const { sim, v } = useSim()
  let el!: HTMLDivElement
  const layer = new TwinLayer()
  let map: maplibregl.Map | null = null
  const [mode, setMode] = persisted<ColorMode>('map.mode', 'pressure')
  const [vis, setVis] = persisted('map.vis', { mains: true, dist: true, service: true, plant: true, intake: true, flow: true })
  const [fly, setFly] = persisted<MapFly>('fly.map', null)
  const [hints, setHints] = persisted('hints.map.v2', false)
  const [legendOpen, setLegendOpen] = persisted('map.legend', !isNarrow())
  const [stats, setStats] = createSignal<RenderStats | null>(null)
  const [debug, setDebug] = createSignal(false)
  const [sel, setSel] = createSignal<PickInfo | null>(null)
  const [tip, setTip] = createSignal<{ x: number; y: number; text: string } | null>(null)
  const [solution, setSolution] = createSignal<NetworkSolution | null>(null)
  const [minPHist, setMinPHist] = createSignal<number[]>([])
  const [zoom, setZoom] = createSignal(13.25)
  /** clouds over the map: parting on the way down, gathering before a scene change */
  const [veil, setVeil] = createSignal<'clear' | 'close' | 'hold' | null>('hold')
  const [veilMs, setVeilMs] = createSignal<number | undefined>(undefined)
  /** zooming in to a site, white closing in at the same pace (ms) */
  const ENTER_MS = 1700
  const [entering, setEntering] = createSignal(false)
  /** the view the map descends to */
  const HOME = { zoom: 13.25, pitch: 52, bearing: -14 }
  const descend = () => {
    if (!map) return
    setVeil(null)
    queueMicrotask(() => setVeil('clear'))
    setEntering(true)
    window.setTimeout(() => setEntering(false), DESCENT_MS + 1200)
    map.flyTo({ ...HOME, center: toLonLat(-60, 420), duration: reducedMotion() ? 0 : DESCENT_MS, curve: 1.1, easing: t => 1 - (1 - t) ** 3, essential: true })
  }
  createEffect(on(() => props.reveal, r => r && descend(), { defer: true }))
  layer.onStats = setStats

  // ── network state from the plant simulation (once a second) ──
  let lastSolve = 0
  const solve = () => {
    const z = sim.zone
    const s = solveNetwork({ entryHead: z.head, qZone: z.q, qOut: sim.qOut, qRaw: sim.qRaw, demandFactor: sim.demandFactor, closedValves: sim.closedNetValves })
    setSolution(s)
    setMinPHist(h => [...h.slice(-179), Number.isFinite(s.minP) ? s.minP : 0])
    paint()
  }
  const colorOf = (id: string): THREE.Color => {
    const p = PIPE_BY_ID[id]
    const st = solution()?.pipes.get(id)
    if (!p) return new THREE.Color(0x888888)
    const m = mode()
    if (m === 'dn') return new THREE.Color(DN_COLOR(p.dn))
    if (m === 'kind') return new THREE.Color(KIND_COLOR[p.kind])
    if (p.kind === 'raw') return new THREE.Color(st?.supplied ? 0x9c7a4a : 0x8a8478)
    if (!st || !st.supplied) return new THREE.Color(0x8a948f)
    return m === 'pressure' ? ramp(PRESSURE_STOPS, st.p) : ramp(VEL_STOPS, Math.abs(st.v))
  }
  const speedOf = (id: string) => {
    const st = solution()?.pipes.get(id)
    if (!st || !st.supplied || Math.abs(st.q) < 0.05 || !vis().flow) return 0
    return Math.sign(st.q) * Math.min(28, Math.max(3, Math.abs(st.v) * 16))
  }
  layer.network.colorOf = colorOf
  layer.network.speedOf = speedOf
  layer.network.deviceStatus = id => deviceStatus(DEVICE_BY_ID[id]!, solution(), sim)
  layer.network.deviceTint = id => (sim.closedNetValves.has(id) ? CLOSED_TINT : null)
  const paint = () => {
    layer.network.repaint()
    map?.triggerRepaint()
  }
  createEffect(
    on(v, () => {
      const now = performance.now()
      if (now - lastSolve > 900) {
        lastSolve = now
        solve()
      }
    }),
  )
  createEffect(on(mode, paint, { defer: true }))
  createEffect(
    on(debug, d => {
      layer.network.debug = d
      paint()
    }),
  )
  const applyVis = (vs: ReturnType<typeof vis>) => {
    const n = layer.network
    if (n.visible.mains !== vs.mains || n.visible.dist !== vs.dist || n.visible.service !== vs.service) {
      n.visible = { mains: vs.mains, dist: vs.dist, service: vs.service }
      n.reset()
    }
    layer.show = { plant: vs.plant, intake: vs.intake }
    plantMarker?.getElement().classList.toggle('tw-hidden', !vs.plant)
    intakeMarker?.getElement().classList.toggle('tw-hidden', !vs.intake)
    paint()
  }
  createEffect(on(vis, applyVis, { defer: true }))
  // redraw every frame only while arrows move on screen: the hidden map (factory open) or flow off redraws on change
  createEffect(() => {
    layer.animate = props.active && vis().flow
    if (layer.animate) map?.triggerRepaint()
  })
  createEffect(
    on(basemap, b => {
      if (!map?.isStyleLoaded()) return
      for (const k of Object.keys(RASTERS)) map.setLayoutProperty(`bm-${k}`, 'visibility', k === b ? 'visible' : 'none')
    }),
  )
  createEffect(
    on(sel, s => {
      layer.highlightPipe(s?.type === 'pipe' ? s.id : null)
      layer.highlightValve(s?.type === 'valve' ? s.code : s?.type === 'device' ? s.id : null)
      if (s && isNarrow()) setFly(null)
    }),
  )

  // ── markers: the plant (the way in), TB1, live sensor callouts ──
  let plantMarker: maplibregl.Marker | null = null
  let intakeMarker: maplibregl.Marker | null = null
  const callouts: Array<{ id: string; el: HTMLButtonElement }> = []
  const markerEl = (title: string, onClick: () => void) => {
    const d = document.createElement('div')
    d.className = 'tw-marker'
    d.setAttribute('role', 'button')
    d.tabIndex = 0
    d.setAttribute('aria-label', title)
    d.innerHTML = `<div class="card"><b></b><span class="vals"></span></div><div class="pin"></div>`
    d.querySelector('b')!.textContent = title
    d.addEventListener('click', e => {
      e.stopPropagation()
      onClick()
    })
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick()
      }
    })
    return d
  }
  const calloutEl = (id: string) => {
    const d = DEVICE_BY_ID[id]!
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tw-callout'
    b.innerHTML = '<i></i><b></b><span></span>'
    b.querySelector('b')!.textContent = d.tag
    b.title = `${catalogName(d.code)} ${d.tag}`
    b.addEventListener('click', e => {
      e.stopPropagation()
      setSel({ type: 'device', id })
    })
    return b
  }
  const calloutText = (id: string) => {
    const r = deviceReadings(id, solution(), sim)[0]
    if (!r) return ''
    return `${r.v.split(' · ')[0]}${r.u ? ' ' + r.u : ''}`
  }
  createEffect(
    on(v, () => {
      layer.intakeFlow = Math.min(1.5, sim.qRaw / 1450)
      const ps = plantMarker?.getElement()
      if (ps) {
        ps.querySelector('.vals')!.textContent = `${f0(sim.qOut)} m³/h, ${f2(sim.pOut)} bar, bể ${f0(sim.reservoirPct)} %`
        ps.classList.toggle('alarm', sim.activeAlarms.some(a => a.level === 'crit'))
      }
      const is = intakeMarker?.getElement()
      if (is) is.querySelector('.vals')!.textContent = `${f0(sim.qRaw)} m³/h, sông +${f2(sim.riverLevel)} m`
      for (const c of callouts) {
        if (zoom() < calloutZoom(c.id)) continue
        c.el.querySelector('span')!.textContent = calloutText(c.id)
        c.el.dataset.st = deviceStatus(DEVICE_BY_ID[c.id]!, solution(), sim)
      }
      updateFar()
    }),
  )
  createEffect(() => {
    const z = zoom()
    const show = vis().dist
    for (const c of callouts) c.el.classList.toggle('tw-hidden', !show || z < calloutZoom(c.id))
    updateFar()
  })

  // ── far symbols, pipe labels and the zone reading (map/far-overlay.ts) ──
  let far: FarOverlay | null = null
  const pickDevice = (id: string) => setSel(VALVE_CODES.has(id) ? { type: 'valve', code: id } : { type: 'device', id })
  const pipeText = (p: NetPipe) => {
    const st = solution()?.pipes.get(p.id)
    const size = p.kind === 'raw' || p.kind === 'transmission' ? `D${p.dn} thép` : `D${p.dn}`
    if (!st?.supplied) return `${size} · mất nước`
    return `${size} · ${f0(Math.abs(st.q))} m³/h`
  }
  function updateFar() {
    if (!far || !map) return
    far.update({
      zoom: map.getZoom(),
      statusOf: d => deviceStatus(d, solution(), sim),
      pipeText,
      zoneText: () => `${f0(sim.zone.q)} m³/h · ${f1(sim.zone.head)} m · clo ${f2(sim.clRes * 0.92)}`,
      zoneLevel: () => (sim.zone.head < 15 ? 'crit' : (solution()?.unsupplied ?? 0) > 0 || minP() < 12 ? 'warn' : null),
      show: { mains: vis().mains, dist: vis().dist },
    })
  }

  const enter = (site: 'plant' | 'tb1') => {
    if (!map) return
    const target = site === 'plant' ? PLANT.originLonLat : INTAKE.originLonLat
    // zoom in to the site while the white closes in, over the same time; the 3D view then opens out of it
    map.flyTo({ center: target, zoom: site === 'plant' ? 16.4 : 17.6, pitch: 58, bearing: site === 'plant' ? 13.6 : -40, duration: ENTER_MS, essential: true })
    setVeilMs(ENTER_MS)
    setVeil(null)
    queueMicrotask(() => setVeil('close'))
    map.once('moveend', () => props.onEnter(site))
  }

  onMount(() => {
    // the opening starts high over the plant's side of the zone and pans down onto it
    const center = toLonLat(500, 1500)
    // MapLibre 6 loads its worker from a separate script (Vite emits it as an asset), as bootstrap.ts does for the GIS map
    maplibregl.setWorkerUrl(workerUrl)
    map = new maplibregl.Map({
      container: el,
      style: styleOf(basemap()),
      center,
      // high above the zone (the opening descends from here: descend())
      zoom: 11.6,
      // the demo covers one supply zone and its plant: no further out than the district
      minZoom: 11.5,
      pitch: 0,
      bearing: 18,
      maxPitch: 78,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true },
    } as maplibregl.MapOptions)
    if (import.meta.env.DEV) (window as unknown as { __twin: unknown }).__twin = { map, layer, sim }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    map.on('load', () => {
      map!.addLayer(layer)
      applyVis(vis())
      solve()
      far = new FarOverlay(map!, pickDevice)
      void far.add().then(updateFar)
      // ready once the first tiles and the 3D layer have drawn (or after a while, whatever the network does)
      let told = false
      const tell = () => {
        if (told) return
        told = true
        props.onReady()
      }
      map!.once('idle', tell)
      window.setTimeout(tell, 15000)
    })
    map.on('zoom', () => setZoom(Math.round(map!.getZoom() * 10) / 10))
    plantMarker = new maplibregl.Marker({ element: markerEl(PLANT.name, () => enter('plant')), anchor: 'bottom', offset: [0, -40] })
      .setLngLat(PLANT.originLonLat)
      .addTo(map)
    intakeMarker = new maplibregl.Marker({ element: markerEl('TB1, thu nước sông Hồng', () => setSel({ type: 'intake' })), anchor: 'bottom', offset: [0, -20] })
      .setLngLat(INTAKE.originLonLat)
      .addTo(map)
    for (const id of CALLOUTS) {
      const d = DEVICE_BY_ID[id]!
      const e = calloutEl(id)
      e.classList.add('tw-hidden')
      callouts.push({ id, el: e })
      new maplibregl.Marker({ element: e, anchor: 'bottom', offset: [0, -8] }).setLngLat(toLonLat(d.at[0], d.at[1])).addTo(map)
    }
    // Live Demo: the tour moves the camera and selects for the user
    let locked = false
    let driftTok = 0
    const HANDLERS = ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'] as const
    director.map = {
      lock: on => {
        // unlocking only undoes a lock: it must not stop a flight in progress (the opening's descent)
        if (on === locked) return
        locked = on
        for (const h of HANDLERS) {
          const handler = map![h] as { enable: () => void; disable: () => void }
          if (on) handler.disable()
          else handler.enable()
        }
        if (!on) {
          driftTok++
          map!.stop()
        }
      },
      fly: cam => {
        const tok = ++driftTok
        map!.flyTo({ ...cam, duration: reducedMotion() ? 0 : 2800, essential: true })
        // once there, drift: a slow turn and a slight push in
        map!.once('moveend', () => {
          if (tok !== driftTok || !locked) return
          map!.easeTo({ bearing: cam.bearing + 14, zoom: cam.zoom + 0.25, duration: reducedMotion() ? 0 : 20000, easing: t => t, essential: true })
        })
      },
      select: p => setSel(p),
      setFly: f => setFly(f),
      setMode: m => setMode(m),
      enter: s => enter(s),
    }
    map.on('click', (e: MapMouseEvent) => {
      if (locked) return
      const farHit = far?.hit(e.point)
      if (farHit) {
        pickDevice(farHit)
        return
      }
      const hit = layer.pick(e.point.x, e.point.y, vis())
      if (hit?.type === 'plant') {
        enter('plant')
        return
      }
      setSel(hit)
    })
    let hoverAt = 0
    map.on('mousemove', (e: MapMouseEvent) => {
      const now = performance.now()
      if (now - hoverAt < 60) return
      hoverAt = now
      const farHit = far?.hit(e.point)
      const hit: PickInfo | null = farHit ? (VALVE_CODES.has(farHit) ? { type: 'valve', code: farHit } : { type: 'device', id: farHit }) : layer.pick(e.point.x, e.point.y, vis())
      map!.getCanvas().style.cursor = hit ? 'pointer' : ''
      if (!hit) {
        setTip(null)
        return
      }
      const text =
        hit.type === 'plant'
          ? PLANT.name
          : hit.type === 'intake'
            ? 'TB1, công trình thu và trạm bơm nước thô'
            : hit.type === 'valve'
              ? `Van ${hit.code}, ${sim.closedNetValves.has(hit.code) ? 'đang đóng' : 'đang mở'}`
              : hit.type === 'device'
                ? `${DEVICE_BY_ID[hit.id]?.tag ?? hit.id}, ${catalogName(DEVICE_BY_ID[hit.id]?.code ?? '')}`
                : (() => {
                    const p = PIPE_BY_ID[hit.id]!
                    const st = solution()?.pipes.get(hit.id)
                    return `${p.code}, ${sizeLabel(p.dn, p.mat)} ${p.mat}${st ? `: ${f1(st.p)} m, ${f2(Math.abs(st.v))} m/s` : ''}`
                  })()
      setTip({ x: e.point.x, y: e.point.y, text })
    })
    map.on('mouseout', () => setTip(null))
  })
  onCleanup(() => map?.remove())

  // coming back from the plant: zoom out a little and repaint
  createEffect(
    on(
      () => props.returnTick,
      () => {
        if (!map) return
        map.resize()
        // back from the 3D view: out of the cloud it closed into, panels sliding back in
        setVeil(null)
        queueMicrotask(() => setVeil('clear'))
        setEntering(true)
        window.setTimeout(() => setEntering(false), DESCENT_MS + 1200)
        map.easeTo({ zoom: 15.6, pitch: 55, duration: 1400 })
      },
      { defer: true },
    ),
  )

  // ── live charts ──
  const H = sim.history
  const zoneHead = createMemo(() => (v(), H.pOut.map((p, i) => Math.max(0, p * 10.2 - 1.6 * ((H.qOut[i] ?? 0) / RATED) ** 2 - 1.5))))
  const zoneQ = createMemo(() => (v(), H.qOut.map(q => q * 0.11)))
  const minP = () => solution()?.minP ?? 0
  const charts: ChartDef[] = [
    { id: 'head', label: 'Cột áp đầu vùng', unit: 'm', digits: 1, value: () => sim.zone.head, data: zoneHead, color: '#1d6cae', band: [20, 50], level: () => (sim.zone.head < 15 ? 'crit' : sim.zone.head < 20 ? 'warn' : null) },
    { id: 'zq', label: 'Lưu lượng vào vùng', unit: 'm³/h', digits: 0, value: () => sim.zone.q, data: zoneQ, color: '#2f86d6', min: 0, note: () => `nhu cầu ${f0(sim.zone.qDemand)}` },
    {
      id: 'minp',
      label: 'Áp lực thấp nhất mạng',
      unit: 'm',
      digits: 1,
      value: minP,
      data: minPHist,
      color: '#d9822b',
      band: [12, 45],
      min: 0,
      span: '−3 phút',
      level: () => (minP() < 10 ? 'crit' : minP() < 12 ? 'warn' : null),
      note: () => ((solution()?.unsupplied ?? 0) > 0 ? `${solution()!.unsupplied} đoạn mất nước` : ''),
    },
    { id: 'cl', label: 'Clo dư vào vùng', unit: 'mg/L', digits: 2, value: () => sim.clRes * 0.92, data: () => H.cl.map(c => c * 0.92), color: '#6aa82e', band: [0.3, 1.0], min: 0, level: () => (sim.clRes * 0.92 < 0.2 ? 'crit' : sim.clRes * 0.92 < 0.3 ? 'warn' : null) },
    { id: 'res', label: 'Bể chứa nhà máy', unit: '%', digits: 0, value: () => sim.reservoirPct, data: () => H.res, color: '#2fa36b', band: [30, 95], min: 0, max: 100, level: () => (sim.reservoirPct < 8 ? 'crit' : sim.reservoirPct < 20 ? 'warn' : null) },
  ]

  const stat = () => stats()
  const lodBar = () => {
    const s = stat()
    if (!s) return []
    const t = s.chunks.reduce((a, b) => a + b, 0) || 1
    return s.chunks.map((n, i) => ({ n, w: (n / t) * 100, c: hex(LOD_COLORS[i]!) }))
  }
  const toggle = (k: keyof ReturnType<typeof vis>) => setVis(x => ({ ...x, [k]: !x[k] }))
  const plantState = () => (v(), sim.activeAlarms.some(a => a.level === 'crit') ? 'fault' : sim.activeAlarms.length ? 'man' : 'run')
  const resPct = createMemo(() => (v(), sim.reservoirPct))

  return (
    <div class="tw-stage tw-screen map" classList={{ 'tw-hidden': !props.active, 'tw-pre': !props.reveal, 'tw-enter': entering() }} data-fly={fly() ?? undefined} data-drawer={sel() ? '' : undefined}>
      <div ref={el} class="tw-stage" />

      <TopBar crumbs={[{ label: 'Bản đồ số 3D' }, { label: 'Mạng lưới Vĩnh Thịnh' }]}>
        <SimControl
          scenarios={[
            { label: 'Lũ, nước thô đục cao', hint: 'Độ đục sông tăng mạnh trong 6 giờ, nhà máy tăng PAC', run: () => sim.injectFlood() },
            { label: 'Sự cố bơm P-NS-01', hint: 'Bơm nước sạch số 1 dừng, áp lực vào vùng dao động', run: () => sim.command('P-NS-01', 'fault') },
          ]}
        />
        <AlarmBell pressed={fly() === 'alarms'} onClick={() => setFly(f => (f === 'alarms' ? null : 'alarms'))} />
        <button type="button" class="tw-btn primary" onClick={() => props.onOpenHmi({ mode: 'scada', screen: 'overview' })}>
          <MonitorCog size={16} />
          <span class="tw-hide-narrow">SCADA</span>
        </button>
        <a class="tw-btn ghost tw-hide-narrow" href="/gis">
          <MapPin size={16} /> Ứng dụng GIS
        </a>
        <TourButton />
        <ThemeButton />
      </TopBar>

      <Rail
        active={fly()}
        onSelect={id => setFly(id as MapFly)}
        items={[
          { id: 'overview', label: 'Tổng quan', icon: LayoutGrid },
          { id: 'layers', label: 'Lớp bản đồ', icon: Layers },
          { id: 'catalog', label: 'Danh mục', icon: Boxes },
          { id: 'perf', label: 'Hiệu năng', icon: Gauge },
        ]}
        foot={[{ id: 'help', label: 'Hướng dẫn', icon: CircleHelp, pressed: hints, onClick: () => setHints(x => !x) }]}
      />

      <Switch>
        <Match when={fly() === 'overview'}>
          <Flyout title="Tổng quan" onClose={() => setFly(null)}>
            <h3 class="tw-sec">
              <span class={`tw-dot ${plantState()}`} aria-hidden="true" />
              {PLANT.name}
              <span class="cnt">{STATE_VI[plantState()]}</span>
            </h3>
            <div class="tw-kpis">
              <Kpi k="Phát ra mạng" v={(v(), f0(sim.qOut))} u="m³/h" />
              <Kpi k="Áp lực ra" v={(v(), f2(sim.pOut))} u="bar" level={(v(), sim.pOut < 2.5 ? 'crit' : null)} />
              <Kpi k="Bể chứa" v={f0(resPct())} u="%" level={resPct() < 8 ? 'crit' : resPct() < 20 ? 'warn' : null} />
              <Kpi k="Đục sau lọc" v={(v(), f2(sim.filteredTurb))} u="NTU" level={(v(), sim.filteredTurb > 2 ? 'crit' : sim.filteredTurb > 1 ? 'warn' : null)} />
              <Kpi k="Clo dư" v={(v(), f2(sim.clRes))} u="mg/L" level={(v(), sim.clRes < 0.3 ? 'warn' : null)} />
              <Kpi k="Điện năng" v={(v(), f2(sim.specificEnergy))} u="kWh/m³" />
            </div>
            <div class="tw-controls">
              <button type="button" class="tw-btn primary" onClick={() => enter('plant')}>
                <Factory size={16} /> Nhà máy
              </button>
              <button type="button" class="tw-btn" onClick={() => setSel({ type: 'intake' })}>
                Trạm bơm TB1
              </button>
            </div>
            <h3 class="tw-sec">
              <span class={`tw-dot ${(v(), unitState(sim, 'S07'))}`} aria-hidden="true" />
              Vùng Vĩnh Thịnh, đợt 3
            </h3>
            <Row k="Cột áp tại điểm đấu nối" v={`${(v(), f1(sim.zone.head))} m`} warn={(v(), sim.zone.head < 15)} />
            <Row k="Áp lực thấp nhất mạng" v={`${f1(minP())} m`} warn={minP() < 12} />
            <Row k="Lưu lượng vào vùng / nhu cầu" v={`${(v(), f0(sim.zone.q))} / ${(v(), f0(sim.zone.qDemand))} m³/h`} />
            <Row k="Đoạn ống mất nước" v={String(solution()?.unsupplied ?? 0)} warn={(solution()?.unsupplied ?? 0) > 0} />
            <Row k="Van mạng lưới đang đóng" v={String((v(), sim.closedNetValves.size))} warn={(v(), sim.closedNetValves.size > 0)} />
          </Flyout>
        </Match>
        <Match when={fly() === 'layers'}>
          <Flyout title="Lớp bản đồ" onClose={() => setFly(null)}>
            <h3 class="tw-sec">Nền bản đồ</h3>
            <div class="tw-seg wide" role="group" aria-label="Nền bản đồ">
              <For each={[['light', 'Sáng'], ['dark', 'Tối'], ['satellite', 'Vệ tinh'], ['osm', 'OSM']] as const}>
                {([k, l]) => (
                  <button type="button" aria-pressed={basemap() === k} onClick={() => setBasemap(k)}>
                    {l}
                  </button>
                )}
              </For>
            </div>
            <h3 class="tw-sec">Hiển thị</h3>
            <For
              each={
                [
                  ['mains', 'Ống truyền dẫn, nước thô, ống chính', '#1d6cae'],
                  ['dist', 'Ống phân phối, van, cảm biến', '#3d8fd1'],
                  ['service', 'Ống dịch vụ', '#78b6e0'],
                  ['plant', 'Nhà máy nước Sông Hồng', '#e2dccd'],
                  ['intake', 'Công trình thu TB1', '#b9b6ad'],
                  ['flow', 'Dòng chảy', '#ffffff'],
                ] as const
              }
            >
              {([k, l, c]) => (
                <label class="tw-check">
                  <input type="checkbox" checked={vis()[k]} onChange={() => toggle(k)} />
                  <span class="tw-swatch" style={{ background: c }} />
                  {l}
                </label>
              )}
            </For>
            <h3 class="tw-sec">Tô màu tuyến ống theo</h3>
            <div class="tw-seg wide" role="group" aria-label="Tô màu tuyến ống">
              <For each={[['pressure', 'Áp lực'], ['velocity', 'Vận tốc'], ['dn', 'Đường kính'], ['kind', 'Loại ống']] as const}>
                {([k, l]) => (
                  <button type="button" aria-pressed={mode() === k} onClick={() => setMode(k)}>
                    {l}
                  </button>
                )}
              </For>
            </div>
          </Flyout>
        </Match>
        <Match when={fly() === 'catalog'}>
          <Flyout title="Thành phần mạng lưới" sub={`${NET_DEVICES.length} thành phần`} onClose={() => setFly(null)}>
            <For each={DEVICE_COUNTS}>
              {([code, n]) => (
                <div class="tw-row" title={code}>
                  <span class="k tw-ic">
                    <CatalogIcon code={code} size={20} /> {catalogName(code)}
                  </span>
                  <span class="v">{n}</span>
                </div>
              )}
            </For>
          </Flyout>
        </Match>
        <Match when={fly() === 'perf'}>
          <Flyout title="Hiệu năng" onClose={() => setFly(null)}>
            <div class="tw-lod">
              <Row k="Khung hình" v={`${stat()?.fps ?? '–'} fps`} warn={(stat()?.fps ?? 60) < 30} />
              <Row k="Lệnh vẽ, tam giác" v={`${stat()?.calls ?? '–'}, ${f0(stat()?.triangles ?? 0)}`} />
              <div class="bar">
                <For each={lodBar()}>{b => <span style={{ width: `${b.w}%`, background: b.c }} />}</For>
              </div>
              <For each={[0, 1, 2]}>
                {i => (
                  <Row
                    k={
                      <>
                        <span class="tw-dot" style={{ background: hex(LOD_COLORS[i]!) }} /> {LOD_NAMES[i]}
                      </>
                    }
                    v={`${stat()?.chunks[i] ?? 0} ô`}
                  />
                )}
              </For>
              <Row k="Thành phần 3D (L2)" v={f0(stat()?.devices ?? 0)} />
              <Row k="Nhà máy, TB1" v={`L${stat()?.plant ?? 0}, L${stat()?.intake ?? 0}`} />
              <Row k="Zoom bản đồ, độ cao camera" v={`${(stat()?.zoom ?? 0).toFixed(1).replace('.', ',')}, ${f0(stat()?.camDist ?? 0)} m`} />
              <label class="tw-check" style={{ 'margin-top': '6px' }}>
                <input type="checkbox" checked={debug()} onChange={() => setDebug(x => !x)} />
                Tô màu theo LoD, vẽ khung ô 300 m
              </label>
              <p class="tw-note">
                Ống: L2 từ zoom {String(LOD_ZOOM.l2).replace('.', ',')}, L1 từ {String(LOD_ZOOM.l1).replace('.', ',')}. Nhà máy: L3 từ 17,2, L2 từ 15,9, L1 từ 14.
              </p>
            </div>
          </Flyout>
        </Match>
        <Match when={fly() === 'alarms'}>
          <Flyout title="Báo động" onClose={() => setFly(null)}>
            <AlarmPanel />
          </Flyout>
        </Match>
      </Switch>

      <ChartStack store="map" title="Theo dõi vùng cấp nước" charts={charts} compact={!!sel()} defaultClosed={['res']} />

      <Show when={sel()}>
        {s => (
          <Drawer label="Thông tin đối tượng" onClose={() => setSel(null)}>
            <Inspector
              sel={s()}
              solution={solution()}
              onClose={() => setSel(null)}
              onEnter={enter}
              onValve={code => {
                sim.toggleNetValve(code)
                solve()
              }}
            />
          </Drawer>
        )}
      </Show>

      <Legend open={legendOpen()} onToggle={() => setLegendOpen(x => !x)} mode={mode()} />

      <Show when={hints()}>
        <HintBar
          onHide={() => setHints(false)}
          hints={[
            { icon: Hand, text: 'Kéo để dời, chuột phải để xoay' },
          ]}
        />
      </Show>

      <Show when={tip()}>
        {t => (
          <div class="tw-tip tw-glass" style={{ left: `${t().x}px`, top: `${t().y}px` }}>
            {t().text}
          </div>
        )}
      </Show>
      <Show when={veil()} keyed>
        {m => <CloudVeil mode={m} ms={m === 'close' ? veilMs() : undefined} onDone={() => m === 'clear' && setVeil(null)} />}
      </Show>
    </div>
  )
}

function Legend(props: { open: boolean; onToggle: () => void; mode: ColorMode }) {
  const title = () => ({ pressure: 'Áp lực (m cột nước)', velocity: 'Vận tốc (m/s)', dn: 'Đường kính ống', kind: 'Loại ống' })[props.mode]
  return (
    <Show
      when={props.open}
      fallback={
        <button type="button" class="tw-legend-chip tw-glass" onClick={() => props.onToggle()} aria-expanded="false" title="Mở chú giải màu">
          <Show when={props.mode === 'pressure' || props.mode === 'velocity'} fallback={<span class="tw-swatch" style={{ background: '#1d6cae' }} />}>
            <span class="mini" style={{ background: props.mode === 'pressure' ? cssRamp(PRESSURE_STOPS, 0, 55) : cssRamp(VEL_STOPS, 0, 1.6) }} />
          </Show>
          Chú giải: {title()}
        </button>
      }
    >
      <section class="tw-legend tw-glass" aria-label="Chú giải màu">
        <header>
          <b>{title()}</b>
          <button type="button" class="tw-x" onClick={() => props.onToggle()} aria-expanded="true" aria-label="Thu gọn chú giải" title="Thu gọn">
            <Minus size={14} />
          </button>
        </header>
        <Switch>
          <Match when={props.mode === 'pressure'}>
            <div class="tw-ramp" style={{ background: cssRamp(PRESSURE_STOPS, 0, 55) }} />
            <div class="tw-ramp-l">
              <span>0</span>
              <span>18</span>
              <span>32</span>
              <span>55</span>
            </div>
          </Match>
          <Match when={props.mode === 'velocity'}>
            <div class="tw-ramp" style={{ background: cssRamp(VEL_STOPS, 0, 1.6) }} />
            <div class="tw-ramp-l">
              <span>0</span>
              <span>0,5</span>
              <span>1,0</span>
              <span>1,6</span>
            </div>
          </Match>
          <Match when={props.mode === 'dn'}>
            <div class="tw-legend-grid">
              <For each={[1000, 600, 315, 225, 160, 110, 90, 63, 50]}>
                {dn => (
                  <span>
                    <span class="tw-swatch" style={{ background: hex(DN_COLOR(dn)) }} /> {dn >= 600 ? `D${dn} thép` : `D${dn} HDPE`}
                  </span>
                )}
              </For>
            </div>
          </Match>
          <Match when={props.mode === 'kind'}>
            <For each={Object.entries(KIND_LABEL) as Array<[NetPipe['kind'], string]>}>
              {([k, l]) => (
                <div class="tw-check static">
                  <span class="tw-swatch" style={{ background: hex(KIND_COLOR[k]) }} /> {l}
                </div>
              )}
            </For>
          </Match>
        </Switch>
        <div class="tw-check static">
          <span class="tw-swatch" style={{ background: '#8a948f' }} /> Mất nước, không cấp
        </div>
      </section>
    </Show>
  )
}

const catalogName = (code: string) => getCatalogItem(code)?.vi ?? code

function Inspector(props: {
  sel: PickInfo
  solution: NetworkSolution | null
  onClose: () => void
  onEnter: (site: 'plant' | 'tb1') => void
  onValve: (code: string) => void
}) {
  const { sim, v } = useSim()
  const close = <CloseBtn onClick={props.onClose} label="Đóng thông tin đối tượng" />
  return (
    <Switch>
      <Match when={props.sel.type === 'pipe' && (props.sel as { id: string })}>
        {s => {
          const p = PIPE_BY_ID[s().id]!
          const st = () => props.solution?.pipes.get(p.id)
          return (
            <>
              <div class="tw-fp-head">
                <div>
                  <h2>{p.code}</h2>
                  <p>{KIND_LABEL[p.kind]}</p>
                </div>
                {close}
              </div>
              <div class="tw-controls">
                <span class={`tw-chip ${st()?.supplied ? 'run' : 'fault'}`}>{st()?.supplied ? 'Đang cấp nước' : 'Mất nước'}</span>
                <Show when={p.assumed}>
                  <span class="tw-chip man">Tuyến giả định</span>
                </Show>
              </div>
              <h3 class="tw-h">Thuộc tính từ bản vẽ</h3>
              <Row k="Đường kính" v={sizeLabel(p.dn, p.mat)} />
              <Row k="Vật liệu" v={p.mat} />
              <Row k="Chiều dài" v={`${f0(p.len)} m`} />
              <Row k="Nguồn" v={<span style={{ 'font-weight': 450, 'font-size': '11.5px' }}>{p.source}</span>} />
              <h3 class="tw-h">Số liệu trực tuyến (mô phỏng)</h3>
              <Row k="Lưu lượng" v={`${f1(Math.abs(st()?.q ?? 0))} m³/h`} />
              <Row k="Vận tốc" v={`${f2(Math.abs(st()?.v ?? 0))} m/s`} />
              <Row k="Áp lực cuối đoạn" v={`${f1(st()?.p ?? 0)} m`} warn={(st()?.p ?? 0) < 12} />
            </>
          )
        }}
      </Match>
      <Match when={props.sel.type === 'valve' && (props.sel as { code: string })}>
        {s => {
          const valve = NET.valves.find(x => x.code === s().code)!
          const closed = () => (v(), sim.closedNetValves.has(valve.code))
          return (
            <>
              <div class="tw-fp-head">
                <CatalogIcon code="GateValve" status={closed() ? 'critical' : undefined} size={34} />
                <div style={{ flex: 1 }}>
                  <h2>Van {valve.code}</h2>
                  <p>
                    Van chặn mặt bích DN{nominalDn(valve.dn)} trên ống {PIPE_BY_ID[valve.pipe]?.code ?? '—'} (D{valve.dn})
                  </p>
                </div>
                {close}
              </div>
              <div class="tw-controls">
                <span class={`tw-chip ${closed() ? 'fault' : 'run'}`}>{closed() ? 'ĐÓNG' : 'MỞ'}</span>
              </div>
              <Row k="Mã bản vẽ" v={valve.id.slice(0, 18)} />
              <Row k="Nguồn" v={<span style={{ 'font-size': '11.5px', 'font-weight': 450 }}>1.MB-PP-Vinh Thinh - Dot 3.dwg (Vanmoinoi)</span>} />
              <div class="tw-controls" style={{ 'margin-top': '10px' }}>
                <button type="button" class={`tw-btn ${closed() ? 'ok' : 'danger'}`} onClick={() => props.onValve(valve.code)}>
                  {closed() ? 'Mở van' : 'Đóng van'}
                </button>
              </div>
              <h3 class="tw-h">Số liệu trực tuyến (mô phỏng)</h3>
              <For each={(v(), deviceReadings(valve.code, props.solution, sim))}>{r => <Row k={r.k} v={`${r.v}${r.u ? ' ' + r.u : ''}`} warn={r.warn} />}</For>
              <CatalogBlock code="GateValve" dn={DEVICE_BY_ID[valve.code]?.dn ?? nominalDn(valve.dn)} />
            </>
          )
        }}
      </Match>
      <Match when={props.sel.type === 'device' && (props.sel as { id: string })}>
        {s => {
          const d = DEVICE_BY_ID[s().id]!
          const status = () => (v(), deviceStatus(d, props.solution, sim))
          const STATUS_VI = { normal: 'Bình thường', warning: 'Cảnh báo', critical: 'Nguy cấp', offline: 'Mất nước / mất kết nối' }
          return (
            <>
              <div class="tw-fp-head">
                <CatalogIcon code={d.code} status={status()} size={34} />
                <div style={{ flex: 1 }}>
                  <h2>{d.tag}</h2>
                  <p>{catalogName(d.code)}</p>
                </div>
                {close}
              </div>
              <div class="tw-controls">
                <span class={`tw-chip ${status() === 'normal' ? 'run' : status() === 'warning' ? 'man' : status() === 'critical' ? 'fault' : ''}`}>{STATUS_VI[status()]}</span>
                <Show when={d.assumed}>
                  <span class="tw-chip man">Vị trí giả định</span>
                </Show>
                <Show when={d.pipe && PIPE_BY_ID[d.pipe!]}>
                  <span class="tw-chip">trên {PIPE_BY_ID[d.pipe!]!.code}</span>
                </Show>
              </div>
              <h3 class="tw-h">Số liệu trực tuyến (mô phỏng)</h3>
              <For each={(v(), deviceReadings(d.id, props.solution, sim))}>{r => <Row k={r.k} v={`${r.v}${r.u ? ' ' + r.u : ''}`} warn={r.warn} />}</For>
              <CatalogBlock code={d.code} dn={d.dn} dn2={d.dn2} />
              <p class="tw-note">Nguồn: {d.source}</p>
            </>
          )
        }}
      </Match>
      <Match when={props.sel.type === 'intake'}>
        <div class="tw-fp-head">
          <div>
            <h2>TB1, công trình thu</h2>
            <p>Trạm bơm nước thô bên sông Hồng</p>
          </div>
          {close}
        </div>
        <Row k="Mực nước sông" v={`+${(v(), f2(sim.riverLevel))} m`} />
        <Row k="Lưu lượng nước thô" v={`${(v(), f0(sim.qRaw))} m³/h`} />
        <Row k="Độ đục nước thô" v={`${(v(), f1(sim.rawTurb))} NTU`} warn={(v(), sim.rawTurb > 180)} />
        <h3 class="tw-h">Bơm nước thô, Q=1450 m³/h, H=45 m</h3>
        <For each={['P-TB1-01', 'P-TB1-02', 'P-TB1-03']}>
          {tag => {
            const d = () => (v(), sim.dev[tag]!)
            return (
              <div class="tw-row">
                <span class="k">
                  <span class={`tw-dot ${d().fault ? 'fault' : d().run ? (d().mode === 'man' ? 'man' : 'run') : 'stop'}`} /> {tag}
                </span>
                <span class="v">{d().run ? `${f0(d().q)} m³/h` : d().fault ? 'Sự cố' : 'Dừng'}</span>
              </div>
            )
          }}
        </For>
        <div class="tw-controls" style={{ 'margin-top': '10px' }}>
          <button type="button" class="tw-btn primary" onClick={() => props.onEnter('tb1')}>
            Xem TB1 trong 3D
          </button>
        </div>
        <p class="tw-note">{INTAKE.source}</p>
      </Match>
      <Match when={props.sel.type === 'plant'}>
        <div class="tw-fp-head">
          <div>
            <h2>{PLANT.name}</h2>
            <p>Công suất {PLANT.capacity}</p>
          </div>
          {close}
        </div>
        <p class="tw-note">{PLANT.source}</p>
      </Match>
    </Switch>
  )
}
