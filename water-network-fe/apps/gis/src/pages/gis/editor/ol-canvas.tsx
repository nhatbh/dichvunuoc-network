/* GIS — Biên tập mạng lưới: canvas trên OpenLayers (nền bản đồ THẬT).
   Drop-in thay `canvas.tsx` — CÙNG hợp đồng prop với EditorCanvas. Nền tiles thật
   (Carto/OSM/Vệ tinh) qua @wn/map-runtime `MapEnginePort`; mạng lưới (mock) chiếu
   px→4326 bằng affine. Vẽ/sửa dùng interaction OL (Draw/Modify/DragBox/Snap); mọi
   geometry OL trả về 4326 được đổi về px cho model Draft (giữ model theo px). */
import { pxToLonLat, lonLatToPx, pxBboxToExtent, type FeatureStyle, type StyleSpec } from '@wn/map-runtime'
import { createMapRuntime } from '@wn/map-runtime/solid'
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import {
  ED_U2M,
  KIND_META,
  type BaseRef,
  type CanvasSel,
  type Draft,
  type Hit,
  type Pt,
  edDist,
  edDmaAt,
  edOffsetPts,
  edPolyLen,
  edProj,
  newDraftId,
} from './model'
import { useGis } from '../lib/gis-data'
import { IcExpand, IcMinus, IcPlus, IcLayers, IcCheck } from '../lib/icons'
import { cAccent, cTheme, tone } from '../lib/theme'
import type { EditorDefaults, SnapModes } from './canvas'
import type { FeatureCollection, Feature, Geometry } from 'geojson'
import type { ActionTarget } from './actions'
import { buildContextTarget } from './context-target'

const BASEMAP_OPTS = [
  { id: 'carto-light', label: 'Carto Light' },
  { id: 'carto-dark', label: 'Carto Dark' },
  { id: 'osm', label: 'OSM' },
  { id: 'satellite', label: 'Vệ tinh' },
] as const
type BasemapOpt = (typeof BASEMAP_OPTS)[number]['id']

/* ── GeoJSON builders (px → 4326) ── */
const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })
const lineFeat = (id: string, pts: Pt[], props: Record<string, unknown>): Feature => ({
  type: 'Feature',
  id,
  geometry: { type: 'LineString', coordinates: pts.map((p) => pxToLonLat(p[0], p[1])) },
  properties: { id, ...props },
})
const pointFeat = (id: string, x: number, y: number, props: Record<string, unknown>): Feature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: pxToLonLat(x, y) },
  properties: { id, ...props },
})
const polyFeat = (id: string, poly: [number, number][], props: Record<string, unknown>): Feature => {
  const ring = [...poly.map((q) => pxToLonLat(q[0], q[1])), pxToLonLat(poly[0]![0], poly[0]![1])]
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id, ...props } }
}

export function EditorOLCanvas(props: {
  tool: string
  drafts: Draft[]
  selId: CanvasSel
  multiSel: string[]
  onSelect: (s: CanvasSel) => void
  onMulti: (ids: string[]) => void
  onAdd: (f: Draft) => void
  onUpdate: (id: string, patch: Partial<Draft>) => void
  onDeleteAt: (hit: Hit) => void
  onMerge: (a: Draft, b: Draft, mergedPts: Pt[]) => void
  onPaint: (hit: Hit) => void
  snap: boolean
  snapModes: SnapModes
  ortho: boolean
  grid: boolean
  offsetDist: number
  defaults: EditorDefaults
  refLayers: Record<string, boolean>
  setStatus: (s: string | null) => void
  onCoord: (x: number, y: number) => void
  focusKey: number
  onContextMenu?: (t: ActionTarget, screenXY: [number, number]) => void
}) {
  const G = useGis()
  const W = G.world.w
  const H = G.world.h
  // Actual data extent in px — the network may sit anywhere in px space (synthetic data
  // starts at 0,0; a real import re-anchored elsewhere can be negative). Derive the view
  // from the geometry, not an assumed [0,W]×[0,H] box, so fit/center work for any dataset.
  const dataBbox = (): { x: number; y: number; w: number; h: number } => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    const ext = (x: number, y: number) => {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    G.pipes.forEach((p) => p.pts.forEach((pt) => ext(pt[0], pt[1])))
    G.valves.forEach((v) => ext(v.x, v.y))
    G.nodes.forEach((n) => ext(n.x, n.y))
    G.dmas.forEach((d) => d.poly.forEach((pt) => ext(pt[0], pt[1])))
    if (!isFinite(minX)) return { x: 0, y: 0, w: W, h: H }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  const bb0 = dataBbox()
  const [cLon, cLat] = pxToLonLat(bb0.x + bb0.w / 2, bb0.y + bb0.h / 2)
  const { containerRef, port } = createMapRuntime({ view: { center: { lon: cLon, lat: cLat }, zoom: 14, minZoom: 9, maxZoom: 20 } })
  let mapEl: HTMLDivElement | undefined

  const [basemap, setBasemap] = createSignal<BasemapOpt>(cTheme() === 'dark' ? 'carto-dark' : 'carto-light')
  const [bmOpen, setBmOpen] = createSignal(false)
  const [pend, setPend] = createSignal<string | null>(null)
  const [tip, setTip] = createSignal<string | null>(null)
  let lastPx: Pt = [W / 2, H / 2]

  /* ── selection helpers ── */
  const RL = () => props.refLayers || {}
  const draftById = (id: string) => props.drafts.find((d) => d.id === id)
  const baseRefFor = (id: string): BaseRef | null => {
    const p = G.pipeBy[id]
    if (p) return { type: 'pipe', id, geom: 'line', pts: p.pts as unknown as Pt[] }
    const v = G.valves.find((x) => x.id === id)
    if (v) return { type: 'valve', id, x: v.x, y: v.y }
    const n = G.nodes.find((x) => x.id === id)
    if (n) return { type: 'node', id, x: n.x, y: n.y, geom: 'point' }
    return null
  }
  const hitFor = (fid: string): Hit | null => {
    const d = draftById(fid)
    if (d) return { kind: 'draft', f: d }
    const base = baseRefFor(fid)
    return base ? { kind: 'base', base } : null
  }

  /* ── context features (existing network — mock, dimmed) ── */
  const ctxDraftMark = (baseId: string): 'del' | 'mod' | null => {
    const df = props.drafts.find((f) => f.op !== 'add' && f.baseId === baseId)
    return df ? (df.op as 'del' | 'mod') : null
  }
  const selBaseId = () => {
    const s = props.selId
    return typeof s === 'object' && s !== null && 'base' in s ? s.base.id : null
  }
  const multi = () => new Set(props.multiSel)

  const buildCtx = () => {
    const feats: Feature[] = []
    if (RL().dma !== false) G.dmas.forEach((d) => feats.push(polyFeat(d.id, d.poly, { kind: 'dma', col: d.col })))
    if (RL().pipe !== false) G.pipes.forEach((p) => feats.push(lineFeat(p.id, p.pts as unknown as Pt[], { kind: 'pipe', dn: p.dn, trunk: p.trunk, mark: ctxDraftMark(p.id), sel: selBaseId() === p.id, mhl: multi().has('base:' + p.id) })))
    if (RL().valve !== false) G.valves.forEach((v) => feats.push(pointFeat(v.id, v.x, v.y, { kind: 'valve', vkind: v.kind, mark: ctxDraftMark(v.id) })))
    if (RL().node !== false) G.nodes.forEach((n) => feats.push(pointFeat(n.id, n.x, n.y, { kind: 'node' })))
    return fc(feats)
  }

  const ctxStyle = (): StyleSpec => {
    const th = cTheme()
    const ac = cAccent()
    const ctxPipe = th === 'light' ? '#C2CAD3' : '#39424f'
    const ctxNode = th === 'light' ? '#AEB8C4' : '#39424f'
    return (p): FeatureStyle => {
      const kind = p.kind as string
      if (kind === 'dma') return { stroke: { color: tone((p.col as string) || '#9A6700'), width: 1.2, dash: [7, 5] }, opacity: 0.5 }
      if (kind === 'pipe') {
        const mark = p.mark as string | null
        const dn = (p.dn as number) || 100
        const w = dn >= 500 ? 5.5 : dn >= 300 ? 4.2 : dn >= 200 ? 2.8 : 2
        const col = mark === 'del' ? tone('#D1242F') : mark === 'mod' ? tone('#9A6700') : ctxPipe
        const style: FeatureStyle = { stroke: { color: col, width: w, dash: mark === 'del' ? [5, 5] : undefined }, opacity: mark === 'del' ? 0.85 : 1 }
        if (p.sel || p.mhl) style.halo = { color: ac, width: w + 5 }
        return style
      }
      if (kind === 'valve') {
        const del = p.mark === 'del'
        return { image: { shape: 'diamond', radius: 3.8, color: th === 'light' ? '#fff' : '#0D1117', stroke: del ? tone('#D1242F') : tone('#9aa4b1'), strokeWidth: 1.3 } }
      }
      return { image: { shape: 'circle', radius: 2, color: th === 'light' ? '#fff' : '#0D1117', stroke: ctxNode, strokeWidth: 1.2 } }
    }
  }

  /* ── draft features ── */
  const buildDraft = () => {
    const sel = props.selId
    const selStr = typeof sel === 'string' ? sel : null
    const m = multi()
    const pd = pend()
    const feats: Feature[] = props.drafts
      .filter((f) => f.op === 'add')
      .map((f) => {
        const common = { kind: f.kind, op: f.op, imported: !!f.imported, sel: selStr === f.id || m.has(f.id) || pd === f.id }
        return f.kind === 'pipe' && f.pts ? lineFeat(f.id, f.pts, common) : pointFeat(f.id, f.x!, f.y!, common)
      })
    return fc(feats)
  }

  const draftStyle = (): StyleSpec => {
    const th = cTheme()
    const ac = cAccent()
    const add = tone('#1A7F37')
    const imp = tone('#9A6700')
    return (p): FeatureStyle => {
      const kind = p.kind as string
      const imported = !!p.imported
      const meta = KIND_META[kind as keyof typeof KIND_META]
      const col = imported ? imp : kind === 'pipe' ? add : tone(meta ? meta.col : '#0E7C86')
      if (kind === 'pipe') {
        const style: FeatureStyle = { stroke: { color: col, width: 3.4, dash: imported ? [8, 5] : undefined } }
        if (p.sel) style.halo = { color: ac, width: 8 }
        return style
      }
      const shape = kind === 'valve' ? 'diamond' : 'circle'
      const style: FeatureStyle = { image: { shape, radius: kind === 'hydrant' ? 4 : 4.6, color: kind === 'hydrant' ? col : th === 'light' ? '#fff' : '#0D1117', stroke: kind === 'hydrant' ? '#fff' : col, strokeWidth: 1.9 } }
      if (p.sel) style.halo = { color: ac, width: 4 }
      return style
    }
  }

  /* ── push features to the port (reactive) ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    p.setFeatures('ctx', buildCtx(), ctxStyle())
    p.setLayerVisible('ctx', true)
  })
  createEffect(() => {
    const p = port()
    if (!p) return
    p.setFeatures('draft', buildDraft(), draftStyle())
    p.setLayerVisible('draft', true)
  })

  /* ── basemap + snap + focus effects ── */
  createEffect(() => {
    const p = port()
    if (p) p.setBasemap(basemap())
  })
  createEffect(() => {
    const p = port()
    if (!p) return
    p.setSnapModes(props.snap ? props.snapModes : { node: false, vertex: false, edge: false })
  })
  // initial fit to the data once the map is ready
  let fitted = false
  createEffect(() => {
    const p = port()
    if (!p || fitted) return
    fitted = true
    p.fitToBbox(pxBboxToExtent(dataBbox()), { padding: 48 })
  })
  createEffect(() => {
    const p = port()
    if (!p || !props.focusKey) return
    p.fitToBbox(pxBboxToExtent(dataBbox()), { padding: 40 })
  })

  /* ── pointer readout (lon/lat → px) + select-tool hover tooltip ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    const off = p.onPointerMove((c) => {
      if (!c) { setTip(null); return }
      const [x, y] = lonLatToPx(c.lon, c.lat)
      lastPx = [Math.round(x), Math.round(y)]
      props.onCoord(lastPx[0], lastPx[1])
      if (props.tool !== 'select') { setTip(null); return }
      // Hit tolerance in world-px (matches the "on pipe" tolerance used elsewhere).
      // TODO(Phase 2): make this zoom-relative so it stays ~constant on screen at any zoom.
      const pid = nearestPipe(lastPx[0], lastPx[1], 14)
      if (pid) {
        const bp = G.pipeBy[pid]
        setTip(pid + (bp ? ` · DN${bp.dn}${bp.material ? ' · ' + bp.material : ''}` : ''))
      } else {
        setTip(null)
      }
    })
    onCleanup(off)
  })

  /* ── right-click context menu (fires AFTER mousedown, so window mousedown close is safe) ── */
  createEffect(() => {
    const p = port()
    if (!p || !props.onContextMenu) return
    const off = p.onContextMenu((ev) => {
      const [x, y] = lonLatToPx(ev.coordinate.lon, ev.coordinate.lat)
      const px: Pt = [Math.round(x), Math.round(y)]
      const rect = mapEl?.getBoundingClientRect()
      const screenXY: [number, number] = [
        (rect?.left ?? 0) + ev.pixel[0],
        (rect?.top ?? 0) + ev.pixel[1],
      ]
      const target = buildContextTarget(ev, px, props.multiSel, hitFor)
      props.onContextMenu!(target, screenXY)
    })
    onCleanup(off)
  })

  /* ── geometry → px helpers (GRID snap applied app-side when enabled) ── */
  const GRID = 46
  const gsnap = (p: Pt): Pt => (props.grid ? [Math.round(p[0] / GRID) * GRID, Math.round(p[1] / GRID) * GRID] : p)
  const geomLinePx = (g: Geometry): Pt[] => (g.type === 'LineString' ? g.coordinates.map((c) => { const [x, y] = lonLatToPx(c[0]!, c[1]!); return gsnap([Math.round(x), Math.round(y)]) }) : [])
  const geomPointPx = (g: Geometry): Pt => { const c = (g as { coordinates: number[] }).coordinates; const [x, y] = lonLatToPx(c[0]!, c[1]!); return gsnap([Math.round(x), Math.round(y)]) }
  const nearestPipe = (x: number, y: number, tol = 10): string | null => {
    let best: { d: number; id: string } | null = null
    for (const p of G.pipes) {
      const pr = edProj(x, y, p.pts[0][0], p.pts[0][1], p.pts[1][0], p.pts[1][1])
      if (pr.d < tol && (!best || pr.d < best.d)) best = { d: pr.d, id: p.id }
    }
    return best ? best.id : null
  }

  /* ── draw complete ── */
  const onDraw = (g: Geometry) => {
    const tool = props.tool
    if (tool === 'pipe' && g.type === 'LineString') {
      const pts = geomLinePx(g)
      if (pts.length < 2) return
      const dp = props.defaults.pipe
      const dma = edDmaAt(G, pts[0]![0], pts[0]![1])
      const f: Draft = { id: newDraftId(), op: 'add', kind: 'pipe', geom: 'line', pts, dn: dp.dn || 200, material: dp.material || 'HDPE', year: 2026, cond: dp.cond || 'good', trunk: !!dp.trunk, dma, lenM: Math.round(edPolyLen(pts) * ED_U2M), eam: null }
      props.onAdd(f)
      props.onSelect(f.id)
      return
    }
    if (g.type === 'Point') {
      const [x, y] = geomPointPx(g)
      const dma = edDmaAt(G, x, y)
      if (tool === 'split') {
        const onPipe = nearestPipe(x, y, 14)
        if (!onPipe) { props.setStatus('Bấm đúng lên tuyến ống để tách'); return }
        const nd: Draft = { id: newDraftId(), op: 'add', kind: 'node', geom: 'point', x, y, dma, ntype: 'Nút tách', z: 12, eam: null, splitOf: onPipe }
        props.onAdd(nd)
        props.onSelect(nd.id)
        props.setStatus('Đã chèn nút tách trên ' + onPipe)
        return
      }
      const kind = tool as 'valve' | 'hydrant' | 'node'
      const base: Draft = { id: newDraftId(), op: 'add', kind, geom: 'point', x, y, dma, eam: null, onPipe: nearestPipe(x, y, 8) }
      if (kind === 'valve') Object.assign(base, { dn: props.defaults.valve.dn || 200, vkind: props.defaults.valve.vkind || 'gate', state: 'open' })
      if (kind === 'hydrant') Object.assign(base, { htype: '3 cửa' })
      if (kind === 'node') Object.assign(base, { ntype: 'Tê', z: 12 })
      props.onAdd(base)
      props.onSelect(base.id)
    }
  }

  /* ── click on a feature (select / delete / match / merge / offset) ── */
  const onClickFeature = (fid: string) => {
    const tool = props.tool
    const hit = hitFor(fid)
    if (tool === 'delete') { if (hit) props.onDeleteAt(hit); return }
    if (tool === 'match') { if (hit) props.onPaint(hit); else props.setStatus('Bấm đúng lên đối tượng'); return }
    if (tool === 'merge') {
      const d = draftById(fid)
      if (!d || d.kind !== 'pipe') { props.setStatus('Chỉ gộp được hai tuyến ống nháp.'); return }
      const cur = pend()
      if (!cur) { setPend(d.id); props.setStatus('Đã chọn ' + d.id + ' — bấm ống nháp thứ hai chung đầu mút.'); return }
      if (cur === d.id) { setPend(null); props.setStatus('Đã huỷ chọn gộp.'); return }
      const a = draftById(cur), b = d
      setPend(null)
      if (!a || !a.pts || !b.pts) return
      const tol = 14
      const aF = a.pts[0]!, aL = a.pts[a.pts.length - 1]!, bF = b.pts[0]!, bL = b.pts[b.pts.length - 1]!
      let merged: Pt[] | null = null
      if (edDist(aL[0], aL[1], bF[0], bF[1]) < tol) merged = [...a.pts, ...b.pts.slice(1)]
      else if (edDist(aL[0], aL[1], bL[0], bL[1]) < tol) merged = [...a.pts, ...b.pts.slice(0, -1).reverse()]
      else if (edDist(aF[0], aF[1], bL[0], bL[1]) < tol) merged = [...b.pts, ...a.pts.slice(1)]
      else if (edDist(aF[0], aF[1], bF[0], bF[1]) < tol) merged = [...b.pts.slice().reverse(), ...a.pts.slice(1)]
      if (!merged) { props.setStatus('Hai ống không chung đầu mút.'); return }
      props.onMerge(a, b, merged)
      return
    }
    if (tool === 'offset') {
      let pts: Pt[] | null = null
      let src: { dn?: number; material?: string; trunk?: boolean } | null = null
      const d = draftById(fid)
      if (d && d.kind === 'pipe' && d.pts) { pts = d.pts; src = d }
      else { const bp = G.pipeBy[fid]; if (bp) { pts = bp.pts as unknown as Pt[]; src = bp } }
      if (!pts) { props.setStatus('Bấm lên tuyến ống để tạo song song'); return }
      const mid = [(pts[0]![0] + pts[1]![0]) / 2, (pts[0]![1] + pts[1]![1]) / 2]
      let nx = -(pts[1]![1] - pts[0]![1]), ny = pts[1]![0] - pts[0]![0]
      const l = Math.hypot(nx, ny) || 1
      nx /= l; ny /= l
      const sgn = (lastPx[0] - mid[0]!) * nx + (lastPx[1] - mid[1]!) * ny >= 0 ? 1 : -1
      const op = edOffsetPts(pts, ((props.offsetDist || 2) / ED_U2M) * sgn)
      const f: Draft = { id: newDraftId(), op: 'add', kind: 'pipe', geom: 'line', pts: op, dn: src && src.dn ? src.dn : 200, material: src && src.material ? src.material : 'HDPE', year: 2026, cond: 'good', trunk: src ? !!src.trunk : false, dma: edDmaAt(G, op[0]![0], op[0]![1]), lenM: Math.round(edPolyLen(op) * ED_U2M), eam: null }
      props.onAdd(f)
      props.onSelect(f.id)
      props.setStatus('Đã tạo ống song song offset ' + (props.offsetDist || 2) + ' m')
      return
    }
    // select
    const dd = draftById(fid)
    if (dd) props.onSelect(dd.id)
    else { const base = baseRefFor(fid); props.onSelect(base ? { base } : null) }
  }

  const onBox = (ids: string[]) => {
    const out = ids.filter((id) => draftById(id) || G.pipeBy[id]).map((id) => (draftById(id) ? id : 'base:' + id))
    props.onMulti(out)
    props.setStatus(out.length ? 'Đã chọn ' + out.length + ' đối tượng.' : 'Khung rỗng.')
  }

  /* ── selection highlight to port ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    const s = props.selId
    p.setSelection(typeof s === 'string' ? s : typeof s === 'object' && s !== null && 'base' in s ? s.base.id : null)
  })

  /* ── tool → interactions ── */
  createEffect(() => {
    const p = port()
    if (!p) return
    const tool = props.tool
    const ortho = props.ortho
    p.setDrawMode(null)
    p.setModifyMode(false)
    p.setBoxSelectMode(false)
    const offs: Array<() => void> = []
    if (tool === 'select') {
      p.setModifyMode(true)
      offs.push(p.onModifyComplete((id, g) => { if (g.type === 'LineString') { const pts = geomLinePx(g); props.onUpdate(id, { pts, lenM: Math.round(edPolyLen(pts) * ED_U2M) }) } else if (g.type === 'Point') { const [x, y] = geomPointPx(g); props.onUpdate(id, { x, y }) } }))
      offs.push(p.onFeatureClick(onClickFeature))
    } else if (tool === 'pipe') {
      p.setDrawConstraint(ortho ? 'ortho' : null)
      p.setDrawMeasure(true)
      p.setDrawMode('LineString')
      offs.push(p.onDrawComplete(onDraw))
      onCleanup(() => p.setDrawMeasure(false))
    } else if (tool === 'valve' || tool === 'hydrant' || tool === 'node' || tool === 'split') {
      p.setDrawMode('Point')
      offs.push(p.onDrawComplete(onDraw))
    } else if (tool === 'window') {
      p.setBoxSelectMode(true)
      offs.push(p.onBoxSelect(onBox))
    } else {
      // delete / match / merge / offset
      offs.push(p.onFeatureClick(onClickFeature))
    }
    onCleanup(() => offs.forEach((f) => f()))
  })

  // reset merge-pending when leaving merge tool
  createEffect(() => { if (props.tool !== 'merge') setPend(null) })

  const zoomBy = (d: number) => {
    const p = port()
    if (!p) return
    const v = p.getView()
    p.setView({ center: v.center, zoom: v.zoom + d })
  }

  return (
    <div class="relative h-full w-full overflow-hidden">
      <div ref={(el) => { containerRef(el); mapEl = el; }} class="h-full w-full" style={{ 'touch-action': 'none' }} />

      {/* zoom + fit */}
      <div class="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-line bg-[var(--surface)]" style={{ 'box-shadow': 'var(--card-shadow)' }}>
        <button onClick={() => zoomBy(1)} class="flex h-8 w-8 items-center justify-center text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"><IcPlus size={16} /></button>
        <button onClick={() => zoomBy(-1)} class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"><IcMinus size={16} /></button>
        <button onClick={() => port()?.fitToBbox(pxBboxToExtent(dataBbox()), { padding: 40 })} class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"><IcExpand size={15} /></button>
      </div>

      {/* basemap picker */}
      <div class="absolute left-3 top-3 z-10">
        <button onClick={() => setBmOpen((o) => !o)} class="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[color:var(--text2)] hover:border-[color:var(--text2)]" style={{ 'box-shadow': 'var(--card-shadow)' }}>
          <IcLayers size={14} />
          {BASEMAP_OPTS.find((b) => b.id === basemap())?.label}
        </button>
        <Show when={bmOpen()}>
          <div class="crm-menu-in mt-1 flex w-40 flex-col overflow-hidden rounded-lg border border-line bg-[var(--surface)] py-1" style={{ 'box-shadow': 'var(--toast-shadow)' }}>
            <For each={BASEMAP_OPTS}>
              {(b) => (
                <button onClick={() => { setBasemap(b.id); setBmOpen(false) }} class="flex items-center justify-between px-3 py-1.5 text-left text-[12px] text-[color:var(--text2)] hover:bg-[var(--surface2)]">
                  {b.label}
                  <Show when={basemap() === b.id}><span style={{ color: cAccent() }}><IcCheck size={14} /></span></Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* hover tooltip: pipe id · DN · material (select tool only) */}
      <Show when={tip()}>
        {(t) => (
          <div class="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-line bg-[var(--surface)]/92 px-2.5 py-1 text-[11px] font-mono text-[color:var(--text2)] backdrop-blur">
            {t()}
          </div>
        )}
      </Show>
    </div>
  )
}
