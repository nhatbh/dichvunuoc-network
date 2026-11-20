import { Factory, Layers } from 'lucide-solid'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js'
import * as THREE from 'three'
import { f0, f1, f2, useSim } from './sim-context'
import { AlarmBadge, Kpi, Row, SimClock } from './widgets'
import { toLonLat } from '../data/geo'
import { NET, PIPE_BY_ID, solveNetwork, type NetworkSolution, type NetPipe } from '../data/network-model'
import { INTAKE, PLANT } from '../data/plant-model'
import { LOD_COLORS, LOD_DIST, LOD_NAMES } from '../map/network-lod'
import { TwinLayer, type PickInfo, type RenderStats } from '../map/twin-layer'
import type { MapMouseEvent, StyleSpecification } from 'maplibre-gl'

type Basemap = 'light' | 'dark' | 'satellite' | 'osm'
type ColorMode = 'pressure' | 'velocity' | 'dn' | 'kind'

const RASTERS: Record<Basemap, { tiles: string[]; attribution: string; max: number }> = {
  light: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'], attribution: '© Esri, HERE, Garmin, © OpenStreetMap', max: 16 },
  dark: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], attribution: '© Esri, HERE, Garmin, © OpenStreetMap', max: 16 },
  satellite: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: '© Esri, Maxar, Earthstar Geographics', max: 19 },
  osm: { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attribution: '© OpenStreetMap contributors', max: 19 },
}
function styleOf(active: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: Object.fromEntries(Object.entries(RASTERS).map(([k, r]) => [k, { type: 'raster', tiles: r.tiles, tileSize: 256, maxzoom: r.max, attribution: r.attribution }])),
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#dfe5e2' } },
      ...Object.keys(RASTERS).map(k => ({ id: `bm-${k}`, type: 'raster' as const, source: k, layout: { visibility: (k === active ? 'visible' : 'none') as 'visible' | 'none' } })),
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
const DN_COLOR = (dn: number) => (dn >= 800 ? 0x123e7a : dn >= 600 ? 0x8a5a2b : dn >= 315 ? 0x1d6cae : dn >= 225 ? 0x2a86c8 : dn >= 160 ? 0x2fa6a0 : dn >= 110 ? 0x5cb85c : dn >= 90 ? 0x9ccc4c : 0xd0b44a)
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

const KIND_LABEL: Record<NetPipe['kind'], string> = {
  transmission: 'Ống truyền dẫn nước sạch',
  raw: 'Ống dẫn nước thô',
  trunk: 'Ống chính phân phối',
  dist: 'Ống phân phối',
  service: 'Ống dịch vụ',
}

export function MapScreen(props: { active: boolean; onEnter: (site: 'plant' | 'tb1') => void; returnTick: number }) {
  const { sim, v } = useSim()
  let el!: HTMLDivElement
  const layer = new TwinLayer()
  let map: maplibregl.Map | null = null
  const [basemap, setBasemap] = createSignal<Basemap>('light')
  const [mode, setMode] = createSignal<ColorMode>('pressure')
  const [stats, setStats] = createSignal<RenderStats | null>(null)
  const [debug, setDebug] = createSignal(false)
  const [vis, setVis] = createSignal({ mains: true, dist: true, service: true, plant: true, intake: true, flow: true })
  const [sel, setSel] = createSignal<PickInfo | null>(null)
  const [tip, setTip] = createSignal<{ x: number; y: number; text: string } | null>(null)
  const [solution, setSolution] = createSignal<NetworkSolution | null>(null)
  const [showLayers, setShowLayers] = createSignal(true)
  const [fade, setFade] = createSignal(false)
  layer.onStats = setStats

  // ── network state from the plant simulation (once a second) ──
  let lastSolve = 0
  const solve = () => {
    const z = sim.zone
    const s = solveNetwork({ entryHead: z.head, qZone: z.q, qOut: sim.qOut, qRaw: sim.qRaw, demandFactor: sim.demandFactor, closedValves: sim.closedNetValves })
    setSolution(s)
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
  layer.network.valveClosed = code => sim.closedNetValves.has(code)
  const paint = () => {
    layer.network.repaint()
    layer.network.refreshValves()
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
  createEffect(
    on(
      vis,
      vs => {
        const n = layer.network
        if (n.visible.mains !== vs.mains || n.visible.dist !== vs.dist || n.visible.service !== vs.service) {
          n.visible = { mains: vs.mains, dist: vs.dist, service: vs.service }
          n.reset()
        }
        layer.show = { plant: vs.plant, intake: vs.intake }
        plantMarker?.getElement().classList.toggle('tw-hidden', !vs.plant)
        intakeMarker?.getElement().classList.toggle('tw-hidden', !vs.intake)
        paint()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(basemap, b => {
      if (!map?.isStyleLoaded()) return
      for (const k of Object.keys(RASTERS)) map.setLayoutProperty(`bm-${k}`, 'visibility', k === b ? 'visible' : 'none')
    }),
  )
  createEffect(
    on(sel, s => {
      layer.highlightPipe(s?.type === 'pipe' ? s.id : null)
      layer.highlightValve(s?.type === 'valve' ? s.code : null)
    }),
  )

  // ── markers ──
  let plantMarker: maplibregl.Marker | null = null
  let intakeMarker: maplibregl.Marker | null = null
  const markerEl = (title: string, onClick: () => void) => {
    const d = document.createElement('div')
    d.className = 'tw-marker'
    d.innerHTML = `<div class="card"><b>${title}</b><span></span></div><div class="pin"></div>`
    d.addEventListener('click', e => {
      e.stopPropagation()
      onClick()
    })
    return d
  }
  createEffect(
    on(v, () => {
      const ps = plantMarker?.getElement()
      if (ps) {
        ps.querySelector('span')!.textContent = `${f0(sim.qOut)} m³/h · ${f2(sim.pOut)} bar · bể ${f0(sim.reservoirPct)} %`
        ps.classList.toggle('alarm', sim.activeAlarms.some(a => a.level === 'crit'))
      }
      const is = intakeMarker?.getElement()
      if (is) is.querySelector('span')!.textContent = `${f0(sim.qRaw)} m³/h · sông +${f2(sim.riverLevel)} m`
    }),
  )

  const enter = (site: 'plant' | 'tb1') => {
    if (!map) return
    const target = site === 'plant' ? PLANT.originLonLat : INTAKE.originLonLat
    map.flyTo({ center: target, zoom: site === 'plant' ? 17.1 : 18.4, pitch: 62, bearing: site === 'plant' ? 13.6 : -40, duration: 1900, essential: true })
    map.once('moveend', () => {
      setFade(true)
      window.setTimeout(() => {
        props.onEnter(site)
        window.setTimeout(() => setFade(false), 120)
      }, 420)
    })
  }

  onMount(() => {
    const center = toLonLat(-60, 420)
    // MapLibre 6 loads its worker from a separate script (Vite emits it as an asset), as bootstrap.ts does for the GIS map
    maplibregl.setWorkerUrl(workerUrl)
    map = new maplibregl.Map({
      container: el,
      style: styleOf(basemap()),
      center,
      zoom: 13.35,
      pitch: 52,
      bearing: -14,
      maxPitch: 78,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true },
    } as maplibregl.MapOptions)
    if (import.meta.env.DEV) (window as unknown as { __twin: unknown }).__twin = { map, layer, sim }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    map.on('load', () => {
      map!.addLayer(layer)
      solve()
    })
    plantMarker = new maplibregl.Marker({ element: markerEl(PLANT.name, () => enter('plant')), anchor: 'bottom', offset: [0, -40] }).setLngLat(PLANT.originLonLat).addTo(map)
    intakeMarker = new maplibregl.Marker({ element: markerEl('TB1 · Công trình thu nước thô', () => setSel({ type: 'intake' })), anchor: 'bottom', offset: [0, -20] })
      .setLngLat(INTAKE.originLonLat)
      .addTo(map)
    map.on('click', (e: MapMouseEvent) => {
      const hit = layer.pick(e.point.x, e.point.y, vis())
      if (hit?.type === 'plant') {
        setSel({ type: 'plant' })
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
      const hit = layer.pick(e.point.x, e.point.y, vis())
      map!.getCanvas().style.cursor = hit ? 'pointer' : ''
      if (!hit) {
        setTip(null)
        return
      }
      const text =
        hit.type === 'plant'
          ? `${PLANT.name} — nhấp để vào mô hình nhà máy`
          : hit.type === 'intake'
            ? 'TB1 · Công trình thu & trạm bơm nước thô'
            : hit.type === 'valve'
              ? `Van ${hit.code} · ${sim.closedNetValves.has(hit.code) ? 'ĐÓNG' : 'mở'}`
              : (() => {
                  const p = PIPE_BY_ID[hit.id]!
                  const st = solution()?.pipes.get(hit.id)
                  return `${p.code} · DN${p.dn} ${p.mat} · ${st ? `${f1(st.p)} m · ${f2(Math.abs(st.v))} m/s` : ''}`
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
        map.easeTo({ zoom: 15.6, pitch: 55, duration: 1400 })
      },
      { defer: true },
    ),
  )

  const resPct = createMemo(() => (v(), sim.reservoirPct))
  const stat = () => stats()
  const lodBar = () => {
    const s = stat()
    if (!s) return []
    const t = s.chunks.reduce((a, b) => a + b, 0) || 1
    return s.chunks.map((n, i) => ({ n, w: (n / t) * 100, c: `#${LOD_COLORS[i]!.toString(16).padStart(6, '0')}` }))
  }
  const toggle = (k: keyof ReturnType<typeof vis>) => setVis(x => ({ ...x, [k]: !x[k] }))

  return (
    <div class="tw-stage" classList={{ 'tw-hidden': !props.active }}>
      <div ref={el} class="tw-stage" />

      {/* ── left: plant + zone status, layers, LoD ── */}
      <aside class="tw-panel tw-left tw-glass" aria-label="Trạng thái và lớp bản đồ">
        <div class="tw-h">Nhà máy Sông Hồng · trực tuyến</div>
        <div class="tw-kpis">
          <Kpi k="Lưu lượng phát" v={(v(), f0(sim.qOut))} u="m³/h" />
          <Kpi k="Áp lực đầu ra" v={(v(), f2(sim.pOut))} u="bar" level={(v(), sim.pOut < 2.5 ? 'crit' : null)} />
          <Kpi k="Bể chứa 10.000 m³" v={f0(resPct())} u="%" level={resPct() < 8 ? 'crit' : resPct() < 20 ? 'warn' : null} />
          <Kpi k="Độ đục sau lọc" v={(v(), f2(sim.filteredTurb))} u="NTU" level={(v(), sim.filteredTurb > 2 ? 'crit' : sim.filteredTurb > 1 ? 'warn' : null)} />
          <Kpi k="Clo dư" v={(v(), f2(sim.clRes))} u="mg/L" level={(v(), sim.clRes < 0.3 ? 'warn' : null)} />
          <Kpi k="Điện năng" v={(v(), f2(sim.specificEnergy))} u="kWh/m³" />
        </div>
        <div class="tw-h">Vùng Vĩnh Thịnh · đợt 3</div>
        <Row k="Áp lực điểm đấu nối" v={`${(v(), f1(sim.zone.head))} m`} warn={(v(), sim.zone.head < 15)} />
        <Row k="Áp lực thấp nhất mạng" v={`${f1(solution()?.minP ?? 0)} m`} warn={(solution()?.minP ?? 99) < 12} />
        <Row k="Lưu lượng vào vùng" v={`${(v(), f0(sim.zone.q))} / ${(v(), f0(sim.zone.qDemand))} m³/h`} />
        <Row k="Đoạn ống mất nước" v={String(solution()?.unsupplied ?? 0)} warn={(solution()?.unsupplied ?? 0) > 0} />
        <div class="tw-controls" style={{ 'margin-top': '10px' }}>
          <button type="button" class="tw-btn primary" onClick={() => enter('plant')}>
            <Factory size={15} /> Vào nhà máy 3D
          </button>
          <AlarmBadge />
        </div>

        <button
          type="button"
          class="tw-h"
          style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0, width: '100%' }}
          aria-expanded={showLayers()}
          onClick={() => setShowLayers(x => !x)}
        >
          <Layers size={13} /> Lớp & hiển thị {showLayers() ? '▾' : '▸'}
        </button>
        <Show when={showLayers()}>
          <div class="tw-seg" role="group" aria-label="Nền bản đồ" style={{ 'margin-bottom': '6px' }}>
            <For each={[['light', 'Sáng'], ['dark', 'Tối'], ['satellite', 'Vệ tinh'], ['osm', 'OSM']] as const}>
              {([k, l]) => (
                <button type="button" aria-pressed={basemap() === k} onClick={() => setBasemap(k)}>
                  {l}
                </button>
              )}
            </For>
          </div>
          <For
            each={
              [
                ['mains', 'Ống truyền dẫn, nước thô, ống chính', '#1d6cae'],
                ['dist', 'Ống phân phối + van, phụ kiện', '#3d8fd1'],
                ['service', 'Ống dịch vụ D50/D63 + đồng hồ', '#78b6e0'],
                ['plant', 'Nhà máy nước Sông Hồng', '#e2dccd'],
                ['intake', 'Công trình thu TB1', '#b9b6ad'],
                ['flow', 'Hoạt ảnh dòng chảy', '#ffffff'],
              ] as const
            }
          >
            {([k, l, c]) => (
              <label class="tw-check">
                <input type="checkbox" checked={vis()[k]} onChange={() => toggle(k)} />
                <span class="tw-swatch" style={{ background: c, border: '1px solid var(--line)' }} />
                {l}
              </label>
            )}
          </For>
          <div class="tw-h">Tô màu tuyến ống</div>
          <div class="tw-seg" role="group" aria-label="Tô màu">
            <For each={[['pressure', 'Áp lực'], ['velocity', 'Vận tốc'], ['dn', 'Đường kính'], ['kind', 'Loại ống']] as const}>
              {([k, l]) => (
                <button type="button" aria-pressed={mode() === k} onClick={() => setMode(k)}>
                  {l}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="tw-h">Mức chi tiết (LoD) · hiệu năng</div>
        <div class="tw-lod">
          <Row k="Khung hình" v={`${stat()?.fps ?? '–'} fps`} warn={(stat()?.fps ?? 60) < 30} />
          <Row k="Lệnh vẽ · tam giác" v={`${stat()?.calls ?? '–'} · ${f0(stat()?.triangles ?? 0)}`} />
          <div class="bar">
            <For each={lodBar()}>{b => <span style={{ width: `${b.w}%`, background: b.c }} />}</For>
          </div>
          <For each={[0, 1, 2]}>
            {i => (
              <Row
                k={
                  <>
                    <span class="tw-dot" style={{ background: `#${LOD_COLORS[i]!.toString(16).padStart(6, '0')}` }} /> {LOD_NAMES[i]}
                  </>
                }
                v={`${stat()?.chunks[i] ?? 0} ô`}
              />
            )}
          </For>
          <Row k="Nhà máy · TB1" v={`L${stat()?.plant ?? 0} · L${stat()?.intake ?? 0}`} />
          <Row k="Độ cao camera" v={`${f0(stat()?.camDist ?? 0)} m`} />
          <label class="tw-check" style={{ 'margin-top': '4px' }}>
            <input type="checkbox" checked={debug()} onChange={() => setDebug(x => !x)} />
            Tô màu theo LoD + khung ô 300 m
          </label>
          <div class="tw-hint">
            Ống: L2 &lt; {LOD_DIST.l2} m, L1 &lt; {f0(LOD_DIST.l1)} m tính từ camera tới từng ô 300 m. Nhà máy: L3 &lt; 520 m, L2 &lt; 1.600 m, L1 &lt; 6 km, xa hơn chỉ còn nhãn.
          </div>
        </div>
      </aside>

      {/* ── right: inspector ── */}
      <Show when={sel()}>
        {s => (
          <aside class="tw-panel tw-right tw-glass" aria-label="Thông tin đối tượng">
            <Inspector sel={s()} solution={solution()} onClose={() => setSel(null)} onEnter={enter} levelAt={p => layer.levelAt(p)} onValve={code => {
              sim.toggleNetValve(code)
              solve()
            }} />
          </aside>
        )}
      </Show>

      {/* ── legend ── */}
      <div class="tw-legend tw-glass">
        <Switch>
          <Match when={mode() === 'pressure'}>
            <b>Áp lực (m cột nước)</b>
            <div class="tw-ramp" style={{ background: cssRamp(PRESSURE_STOPS, 0, 55) }} />
            <div class="tw-ramp-l">
              <span>0</span>
              <span>18</span>
              <span>32</span>
              <span>55</span>
            </div>
          </Match>
          <Match when={mode() === 'velocity'}>
            <b>Vận tốc (m/s)</b>
            <div class="tw-ramp" style={{ background: cssRamp(VEL_STOPS, 0, 1.6) }} />
            <div class="tw-ramp-l">
              <span>0</span>
              <span>0,5</span>
              <span>1,0</span>
              <span>1,6</span>
            </div>
          </Match>
          <Match when={mode() === 'dn'}>
            <b>Đường kính</b>
            <For each={[1000, 600, 315, 225, 160, 110, 90, 63]}>
              {dn => (
                <div class="tw-check" style={{ cursor: 'default' }}>
                  <span class="tw-swatch" style={{ background: `#${DN_COLOR(dn).toString(16).padStart(6, '0')}` }} /> {dn >= 600 ? `D${dn} thép` : `DN${dn}`}
                </div>
              )}
            </For>
          </Match>
          <Match when={mode() === 'kind'}>
            <b>Loại ống</b>
            <For each={Object.entries(KIND_LABEL) as Array<[NetPipe['kind'], string]>}>
              {([k, l]) => (
                <div class="tw-check" style={{ cursor: 'default' }}>
                  <span class="tw-swatch" style={{ background: `#${KIND_COLOR[k].toString(16).padStart(6, '0')}` }} /> {l}
                </div>
              )}
            </For>
          </Match>
        </Switch>
        <div class="tw-check" style={{ cursor: 'default', 'margin-top': '4px' }}>
          <span class="tw-swatch" style={{ background: '#8a948f' }} /> Mất nước / không cấp
        </div>
      </div>

      {/* ── bottom: simulation ── */}
      <div class="tw-bottom tw-glass">
        <SimClock
          extra={
            <>
              <button type="button" class="tw-btn sm" onClick={() => sim.injectFlood()} title="Độ đục nước thô tăng mạnh trong 6 giờ">
                Mô phỏng lũ
              </button>
              <button type="button" class="tw-btn sm" onClick={() => sim.command('P-NS-01', 'fault')} title="Bơm nước sạch số 1 dừng sự cố">
                Sự cố bơm P-NS-01
              </button>
            </>
          }
        />
      </div>

      <Show when={tip()}>
        {t => (
          <div class="tw-tip tw-glass" style={{ left: `${t().x}px`, top: `${t().y}px` }}>
            {t().text}
          </div>
        )}
      </Show>
      <div class="tw-fade" classList={{ on: fade() }} />
    </div>
  )
}

function Inspector(props: {
  sel: PickInfo
  solution: NetworkSolution | null
  onClose: () => void
  onEnter: (site: 'plant' | 'tb1') => void
  onValve: (code: string) => void
  levelAt: (p: [number, number]) => 0 | 1 | 2 | null
}) {
  const { sim, v } = useSim()
  const close = (
    <button type="button" class="tw-btn icon sm" style={{ 'margin-left': 'auto' }} onClick={() => props.onClose()} aria-label="Đóng">
      ✕
    </button>
  )
  return (
    <Switch>
      <Match when={props.sel.type === 'pipe' && (props.sel as { id: string })}>
        {s => {
          const p = PIPE_BY_ID[s().id]!
          const st = () => props.solution?.pipes.get(p.id)
          const mid = p.path[Math.floor(p.path.length / 2)]!
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
                <span class="tw-chip info">LoD ô: L{props.levelAt(mid) ?? '–'}</span>
              </div>
              <div class="tw-h">Thuộc tính (từ bản vẽ)</div>
              <Row k="Đường kính" v={`${p.kind === 'raw' || p.kind === 'transmission' ? 'D' : 'DN'}${p.dn}`} />
              <Row k="Vật liệu" v={p.mat} />
              <Row k="Chiều dài" v={`${f0(p.len)} m`} />
              <Row k="Nguồn" v={<span style={{ 'font-weight': 450, 'font-size': '11.5px' }}>{p.source}</span>} />
              <div class="tw-h">Trực tuyến (mô phỏng)</div>
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
                <div>
                  <h2>Van {valve.code}</h2>
                  <p>Van chặn mặt bích DN{valve.dn} · trên {PIPE_BY_ID[valve.pipe]?.code ?? '—'}</p>
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
                  {closed() ? 'Mở van' : 'Đóng van (cô lập hạ lưu)'}
                </button>
              </div>
              <div class="tw-hint">Đóng van cắt nước toàn bộ nhánh phía sau; các đoạn ống đó chuyển màu xám trên bản đồ.</div>
            </>
          )
        }}
      </Match>
      <Match when={props.sel.type === 'intake'}>
        <div class="tw-fp-head">
          <div>
            <h2>TB1 · Công trình thu</h2>
            <p>Trạm bơm nước thô bên sông Hồng</p>
          </div>
          {close}
        </div>
        <Row k="Mực nước sông" v={`+${(v(), f2(sim.riverLevel))} m`} />
        <Row k="Lưu lượng nước thô" v={`${(v(), f0(sim.qRaw))} m³/h`} />
        <Row k="Độ đục nước thô" v={`${(v(), f1(sim.rawTurb))} NTU`} warn={(v(), sim.rawTurb > 180)} />
        <div class="tw-h">Bơm (Q=1450 m³/h · H=45 m)</div>
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
        <div class="tw-hint">{INTAKE.source}</div>
      </Match>
      <Match when={props.sel.type === 'plant'}>
        <div class="tw-fp-head">
          <div>
            <h2>{PLANT.name}</h2>
            <p>Công suất {PLANT.capacity}</p>
          </div>
          {close}
        </div>
        <div class="tw-hint">{PLANT.source}</div>
      </Match>
    </Switch>
  )
}
