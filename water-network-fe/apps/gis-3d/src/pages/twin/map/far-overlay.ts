/**
 * What the network map shows from afar, where the 3D layer draws pipes as plain lines.
 *
 * MapLibre layers:
 *  - the catalog symbols of the components that matter (inlet station, sensors, valves, air valves, washouts, loggers),
 *    coloured by live state; they make room for each other by priority, so zooming in reveals more. Hydrants and
 *    sampling points wait for the closer levels: their red and orange symbols would read as alarms from afar;
 *  - the outline of the supply zone.
 * DOM labels (the map style loads no fonts):
 *  - pipe labels on the mains and on the longest pipe of each size: size and live flow;
 *  - the zone's inlet reading (flow, head, chlorine), which stands for the inlet station's sensors until they are
 *    far enough apart on screen to carry their own callouts.
 *
 * From LOD_ZOOM.l1 the 3D layer draws the components itself (flat symbols, then models), so the symbols hide there.
 */
import { mapSymbolSVG, type Status } from '@wn/component-models'
import * as maplibregl from 'maplibre-gl'
import { LOD_ZOOM } from './network-lod'
import { toLonLat, type XY } from '../data/geo'
import { isServiceDevice, NET_DEVICES, type NetDevice } from '../data/network-devices'
import { NET, type NetPipe } from '../data/network-model'
import type { Map as MlMap, MapGeoJSONFeature, PointLike } from 'maplibre-gl'

/** symbols drawn from afar, by priority (0 first) */
const FAR: Record<string, number> = {
  MotorisedValve: 0,
  BulkMeter: 0,
  ButterflyValve: 1,
  PressureSensor: 1,
  ChlorineAnalyser: 1,
  GateValve: 2,
  AirValve: 3,
  Washout: 3,
  AcousticLogger: 4,
}
const STATUSES: Status[] = ['normal', 'warning', 'critical', 'offline']
const ICONS = 'tw-far-icons'
const ZONE = 'tw-far-zone'
/** pipe labels are shown up to this zoom */
export const LABEL_MAX_ZOOM = LOD_ZOOM.l2
/** below this zoom the pipe labels would pile up on each other */
export const LABEL_MIN_ZOOM = 13
/** from this zoom the inlet station's own callouts are apart enough to replace the zone reading */
export const ZONE_CALLOUT_ZOOM = 15.5

const ll = (p: XY): [number, number] => toLonLat(p[0], p[1])

function convexHull(points: XY[]): XY[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: XY[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: XY[] = []
  for (const p of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** the supply zone: the hull of its distribution and service pipes, grown by a margin */
export function zoneOutline(margin = 60): XY[] {
  const pts = NET.pipes.filter(p => (p.kind === 'dist' || p.kind === 'trunk' || p.kind === 'service') && !p.assumed).flatMap(p => p.path)
  const hull = convexHull(pts)
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
  return hull.map(([x, y]): XY => {
    const l = Math.hypot(x - cx, y - cy) || 1
    return [x + ((x - cx) / l) * margin, y + ((y - cy) / l) * margin]
  })
}

/** the pipes that carry a label: the assumed mains, and the longest drawn pipe of each size */
export function labelledPipes(): NetPipe[] {
  const out = NET.pipes.filter(p => p.kind === 'transmission' || p.kind === 'raw' || p.id === 'TM-02')
  const bySize = new Map<number, NetPipe>()
  for (const p of NET.pipes) if ((p.kind === 'dist' || p.kind === 'trunk') && !p.assumed && p.len > (bySize.get(p.dn)?.len ?? 0)) bySize.set(p.dn, p)
  return out.concat([...bySize.values()].sort((a, b) => b.dn - a.dn))
}

/** where a pipe label sits: the middle of the pipe's longest segment */
function labelPoint(p: NetPipe): XY {
  let best = 1
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1]!
    const b = p.path[i]!
    const c = p.path[best]!
    const d = p.path[best - 1]!
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > Math.hypot(c[0] - d[0], c[1] - d[1])) best = i
  }
  const a = p.path[best - 1]!
  const b = p.path[best]!
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

export interface FarState {
  zoom: number
  statusOf: (d: NetDevice) => Status
  /** label text of a pipe (size, live flow) */
  pipeText: (p: NetPipe) => string
  /** the zone inlet reading */
  zoneText: () => string
  zoneLevel: () => 'crit' | 'warn' | null
  show: { mains: boolean; dist: boolean }
}

export class FarOverlay {
  readonly devices = NET_DEVICES.filter(d => FAR[d.code] !== undefined && !isServiceDevice(d))
  #signature = ''
  #labels: Array<{ pipe: NetPipe; el: HTMLElement; marker: maplibregl.Marker }> = []
  #zone: { el: HTMLElement; marker: maplibregl.Marker } | null = null
  #ready = false

  constructor(
    private map: MlMap,
    private onPick: (id: string) => void,
  ) {}

  /** add the icons, the zone outline and the labels (after the map's style has loaded) */
  async add() {
    const map = this.map
    const codes = [...new Set(this.devices.map(d => d.code))]
    await Promise.all(
      codes.flatMap(code =>
        STATUSES.map(async st => {
          const name = `far-${code}-${st}`
          if (map.hasImage(name)) return
          const img = new Image(48, 48)
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mapSymbolSVG(code, { status: st === 'normal' ? undefined : st, size: 48 }))}`
          await img.decode()
          if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 })
        }),
      ),
    )
    const zone = zoneOutline()
    // the zone lies under the 3D pipes: its dashed outline drawn on top read as a pipe crossing the network
    const under = map.getLayer('twin-3d') ? 'twin-3d' : undefined
    map.addSource(ZONE, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...zone, zone[0]!].map(ll)] } } })
    map.addLayer({ id: `${ZONE}-fill`, type: 'fill', source: ZONE, paint: { 'fill-color': '#1d6cae', 'fill-opacity': 0.05 } }, under)
    map.addLayer({ id: `${ZONE}-line`, type: 'line', source: ZONE, paint: { 'line-color': '#1d6cae', 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [3, 2] } }, under)
    map.addSource(ICONS, { type: 'geojson', data: this.#features(() => 'normal') })
    map.addLayer({
      id: ICONS,
      type: 'symbol',
      source: ICONS,
      maxzoom: LOD_ZOOM.l1,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 15, 1],
        'symbol-sort-key': ['get', 'prio'],
        'icon-padding': 3,
        'icon-pitch-alignment': 'viewport',
        'icon-rotation-alignment': 'viewport',
      },
    })
    // pipe labels and the zone reading
    for (const pipe of labelledPipes()) {
      const el = document.createElement('div')
      el.className = 'tw-pipelabel'
      el.dataset.kind = pipe.kind
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(ll(labelPoint(pipe))).addTo(map)
      this.#labels.push({ pipe, el, marker })
    }
    const zel = document.createElement('button')
    zel.type = 'button'
    zel.className = 'tw-zonelabel'
    zel.innerHTML = '<b></b><span></span>'
    zel.querySelector('b')!.textContent = 'Vùng Vĩnh Thịnh'
    zel.addEventListener('click', e => {
      e.stopPropagation()
      this.onPick('FT-VT3')
    })
    this.#zone = { el: zel, marker: new maplibregl.Marker({ element: zel, anchor: 'bottom', offset: [0, -10] }).setLngLat(ll(NET.entry)).addTo(map) }
    this.#ready = true
  }

  #features(statusOf: (d: NetDevice) => Status): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.devices.map(d => ({
        type: 'Feature',
        properties: { id: d.id, icon: `far-${d.code}-${statusOf(d)}`, prio: FAR[d.code]! },
        geometry: { type: 'Point', coordinates: ll(d.at) },
      })),
    }
  }

  /** live state, visibility and labels; call about once a second and on zoom */
  update(s: FarState) {
    if (!this.#ready) return
    const map = this.map
    const states = this.devices.map(d => s.statusOf(d))
    const sig = states.join(',')
    if (sig !== this.#signature) {
      this.#signature = sig
      const i = new Map(this.devices.map((d, k) => [d.id, states[k]!]))
      ;(map.getSource(ICONS) as maplibregl.GeoJSONSource).setData(this.#features(d => i.get(d.id)!))
    }
    map.setLayoutProperty(ICONS, 'visibility', s.show.dist || s.show.mains ? 'visible' : 'none')
    for (const z of [`${ZONE}-fill`, `${ZONE}-line`]) map.setLayoutProperty(z, 'visibility', s.show.dist ? 'visible' : 'none')
    const labels = s.zoom < LABEL_MAX_ZOOM && s.zoom >= LABEL_MIN_ZOOM
    for (const l of this.#labels) {
      const on = labels && (l.pipe.kind === 'dist' || l.pipe.kind === 'trunk' ? s.show.dist : s.show.mains)
      l.el.classList.toggle('tw-hidden', !on)
      if (on) l.el.textContent = s.pipeText(l.pipe)
    }
    if (this.#zone) {
      const on = s.zoom < ZONE_CALLOUT_ZOOM && s.show.dist
      this.#zone.el.classList.toggle('tw-hidden', !on)
      if (on) {
        this.#zone.el.querySelector('span')!.textContent = s.zoneText()
        this.#zone.el.dataset.st = s.zoneLevel() ?? ''
      }
    }
  }

  /** the far symbol under a screen point, if any */
  hit(point: PointLike): string | null {
    if (!this.#ready || !this.map.getLayer(ICONS)) return null
    const f: MapGeoJSONFeature | undefined = this.map.queryRenderedFeatures(point, { layers: [ICONS] })[0]
    return (f?.properties?.id as string | undefined) ?? null
  }
}
