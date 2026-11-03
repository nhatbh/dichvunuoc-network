/* GIS — Biên tập mạng lưới: canvas (SolidJS port of editor.jsx EditorCanvas).
   Interactive SVG editing surface — pan/zoom, OSNAP, draw pipe, place point features,
   split/merge/offset/match, window-select, vertex reshape. Context (existing) geometry
   is drawn dimmed; drafts are drawn in add/mod/del colors. */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import {
  ED_U2M,
  KIND_META,
  type Draft,
  type CanvasSel,
  type Hit,
  type Pt,
  edDist,
  edDmaAt,
  edOffsetPts,
  edOrtho,
  edPolyLen,
  edProj,
  newDraftId,
} from './model'
import { useGis } from '../lib/gis-data'
import { IcExpand, IcMinus, IcPlus } from '../lib/icons'
import { cAccent, cTheme, chex, fmtKm, tone } from '../lib/theme'
import { roundedPoly } from '../ui/network-map'

export interface EditorDefaults {
  pipe: { dn: number; material: string; trunk: boolean; cond: string }
  valve: { dn: number; vkind: string }
}
export interface SnapModes {
  node: boolean
  vertex: boolean
  edge: boolean
  grid: boolean
}

interface SnapResult {
  x: number
  y: number
  snap: 'node' | 'vertex' | 'edge' | 'point' | 'grid' | null
  ref?: string
}

export function EditorCanvas(props: {
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
}) {
  const G = useGis()
  const theme = () => cTheme()
  let svgRef: SVGSVGElement | undefined
  const W = G.world.w,
    H = G.world.h
  const fullVB: [number, number, number, number] = [-40, -40, W + 80, H + 80]
  const [vb, setVb] = createSignal<[number, number, number, number]>(fullVB)

  // imperative interaction refs (no render)
  let drag: { sx: number; sy: number; vb: [number, number, number, number]; moved: boolean } | null = null
  let moveRef: { id: string; idx?: number } | null = null
  // reactive interaction state (drives render)
  const [box, setBox] = createSignal<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  let boxing = false
  const [pend, setPend] = createSignal<string | null>(null)
  const [draw, setDraw] = createSignal<{ pts: Pt[] } | null>(null)
  const [hover, setHover] = createSignal<SnapResult | null>(null)

  const pxScale = () => vb()[2] / W

  const pal = () =>
    theme() === 'light'
      ? { bg: '#EEF1F4', water: '#cfe0ee', block: '#E1E5EA', blockLine: 'rgba(30,40,55,0.05)', road: '#FFFFFF', grid: 'rgba(30,40,55,0.035)', ctxPipe: '#C2CAD3', ctxNode: '#AEB8C4' }
      : { bg: '#0C1015', water: '#13202f', block: '#141a22', blockLine: 'rgba(240,246,252,0.04)', road: 'rgba(240,246,252,0.08)', grid: 'rgba(240,246,252,0.02)', ctxPipe: '#39424f', ctxNode: '#39424f' }

  // focus → reset to full extent
  createEffect(() => {
    if (!props.focusKey) return
    setVb(fullVB)
  })

  const toWorld = (cx: number, cy: number): Pt => {
    const r = svgRef!.getBoundingClientRect()
    const [x, y, w, h] = vb()
    return [x + ((cx - r.left) / r.width) * w, y + ((cy - r.top) / r.height) * h]
  }
  const tolWorld = () => {
    const cw = svgRef ? svgRef.clientWidth : 800
    return (14 / cw) * vb()[2]
  }

  /* điểm để snap: nút gốc + đầu ống gốc + đỉnh ống nháp + điểm nháp */
  const snapPoint = (wx: number, wy: number, opts: { toLine?: boolean } = {}): SnapResult => {
    if (!props.snap) return { x: wx, y: wy, snap: null }
    const sm = props.snapModes
    const tol = tolWorld()
    let best: (SnapResult & { d: number }) | null = null
    const consider = (x: number, y: number, type: SnapResult['snap'], ref?: string) => {
      const d = edDist(wx, wy, x, y)
      if (d < tol && (!best || d < best.d)) best = { x, y, d, snap: type, ref }
    }
    if (sm.node) G.nodes.forEach((n) => consider(n.x, n.y, 'node', n.id))
    if (sm.vertex)
      G.pipes.forEach((p) => {
        consider(p.pts[0][0], p.pts[0][1], 'vertex', p.id)
        consider(p.pts[1][0], p.pts[1][1], 'vertex', p.id)
      })
    props.drafts.forEach((f) => {
      if (f.op === 'del') return
      if (f.kind === 'pipe' && sm.vertex && f.pts) f.pts.forEach((pt) => consider(pt[0], pt[1], 'vertex', f.id))
      else if (f.geom !== 'line' && sm.node) consider(f.x!, f.y!, 'point', f.id)
    })
    if (opts.toLine && sm.edge) {
      const segBest: { d: number; x?: number; y?: number; ref?: string } = { d: tol }
      const test = (pts: Pt[], ref: string) => {
        for (let i = 1; i < pts.length; i++) {
          const pr = edProj(wx, wy, pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1])
          if (pr.d < segBest.d) {
            segBest.d = pr.d
            segBest.x = pr.x
            segBest.y = pr.y
            segBest.ref = ref
          }
        }
      }
      G.pipes.forEach((p) => test(p.pts, p.id))
      props.drafts.forEach((f) => {
        if (f.kind === 'pipe' && f.op !== 'del' && f.pts) test(f.pts, f.id)
      })
      const b0 = best as (SnapResult & { d: number }) | null
      if (segBest.x != null && (!b0 || segBest.d < b0.d - 0.01)) return { x: segBest.x, y: segBest.y!, snap: 'edge', ref: segBest.ref }
    }
    const bf = best as (SnapResult & { d: number }) | null
    if (bf) return bf
    if (sm.grid) {
      const g = 46
      return { x: Math.round(wx / g) * g, y: Math.round(wy / g) * g, snap: 'grid' }
    }
    return { x: wx, y: wy, snap: null }
  }

  const wantLine = () => props.tool === 'valve' || props.tool === 'split' || props.tool === 'node' || props.tool === 'offset' || props.tool === 'merge' || props.tool === 'match'

  const hitVertex = (wx: number, wy: number): { id: string; idx: number } | null => {
    const tol = tolWorld()
    for (const f of props.drafts) {
      if (f.kind === 'pipe' && f.op !== 'del' && f.pts) {
        for (let i = 0; i < f.pts.length; i++) {
          if (edDist(wx, wy, f.pts[i]![0], f.pts[i]![1]) < tol) return { id: f.id, idx: i }
        }
      }
    }
    return null
  }

  const hitTest = (wx: number, wy: number): Hit | null => {
    const tol = tolWorld()
    for (const f of props.drafts) {
      if (f.geom === 'point' && f.op !== 'del' && edDist(wx, wy, f.x!, f.y!) < tol) return { kind: 'draft', f }
    }
    for (const f of props.drafts) {
      if (f.kind === 'pipe' && f.op !== 'del' && f.pts) {
        for (let i = 1; i < f.pts.length; i++) {
          if (edProj(wx, wy, f.pts[i - 1]![0], f.pts[i - 1]![1], f.pts[i]![0], f.pts[i]![1]).d < tol) return { kind: 'draft', f }
        }
      }
    }
    let bestP: { d: number; p: (typeof G.pipes)[number] } | null = null
    for (const p of G.pipes) {
      const pr = edProj(wx, wy, p.pts[0][0], p.pts[0][1], p.pts[1][0], p.pts[1][1])
      if (pr.d < tol && (!bestP || pr.d < bestP.d)) bestP = { d: pr.d, p }
    }
    for (const v of G.valves) if (edDist(wx, wy, v.x, v.y) < tol) return { kind: 'base', base: { type: 'valve', id: v.id, x: v.x, y: v.y } }
    if (bestP) return { kind: 'base', base: { type: 'pipe', id: bestP.p.id, geom: 'line', pts: bestP.p.pts } }
    return null
  }

  /* ── mouse ── */
  const onMove = (e: MouseEvent) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    props.onCoord(Math.round(wx), Math.round(wy))
    if (drag) {
      const r = svgRef!.getBoundingClientRect()
      const [x, y, w, h] = drag.vb
      const dx = ((e.clientX - drag.sx) / r.width) * w,
        dy = ((e.clientY - drag.sy) / r.height) * h
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true
      setVb([x - dx, y - dy, w, h])
      return
    }
    if (boxing) {
      const b = box()
      if (b) setBox({ x0: b.x0, y0: b.y0, x1: wx, y1: wy })
      return
    }
    if (moveRef) {
      const sp = snapPoint(wx, wy, { toLine: false })
      const mv = moveRef
      if (mv.idx != null) {
        const f = props.drafts.find((x) => x.id === mv.id)
        if (f && f.pts) {
          const pts = f.pts.map((p, i) => (i === mv.idx ? ([Math.round(sp.x), Math.round(sp.y)] as Pt) : p))
          props.onUpdate(mv.id, { pts, lenM: Math.round(edPolyLen(pts) * ED_U2M) })
        }
      } else props.onUpdate(mv.id, { x: Math.round(sp.x), y: Math.round(sp.y) })
      setHover(sp)
      return
    }
    if (props.tool === 'pipe') {
      let sp = snapPoint(wx, wy)
      const d = draw()
      if (props.ortho && d && d.pts.length && sp.snap == null) {
        const last = d.pts[d.pts.length - 1]!
        const o = edOrtho(last[0], last[1], wx, wy)
        sp = { x: o[0], y: o[1], snap: null }
      }
      setHover(sp)
    } else if (wantLine() || props.tool === 'hydrant') setHover(snapPoint(wx, wy, { toLine: wantLine() }))
    else if (props.tool === 'select') {
      const v = hitVertex(wx, wy)
      if (v) {
        const f = props.drafts.find((f) => f.id === v.id)
        setHover(f && f.pts ? { x: f.pts[v.idx]![0], y: f.pts[v.idx]![1], snap: 'vertex' } : null)
      } else setHover(null)
    } else setHover(null)
  }

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    if (props.tool === 'window') {
      boxing = true
      setBox({ x0: wx, y0: wy, x1: wx, y1: wy })
      return
    }
    if (props.tool === 'select') {
      const v = hitVertex(wx, wy)
      if (v) {
        moveRef = v
        props.onSelect(v.id)
        return
      }
      const hit = hitTest(wx, wy)
      if (hit && hit.kind === 'draft' && hit.f.geom === 'point') {
        moveRef = { id: hit.f.id }
        props.onSelect(hit.f.id)
        return
      }
    }
    drag = { sx: e.clientX, sy: e.clientY, vb: vb(), moved: false }
  }

  const onUp = (e: MouseEvent) => {
    if (moveRef) {
      moveRef = null
      return
    }
    if (boxing) {
      const b = box()
      boxing = false
      setBox(null)
      if (b) {
        const x0 = Math.min(b.x0, b.x1),
          x1 = Math.max(b.x0, b.x1),
          y0 = Math.min(b.y0, b.y1),
          y1 = Math.max(b.y0, b.y1)
        const inBox = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1
        const ids: string[] = []
        props.drafts.forEach((f) => {
          if (f.op === 'del') return
          if (f.geom === 'point' && inBox(f.x!, f.y!)) ids.push(f.id)
          else if (f.kind === 'pipe' && f.pts && f.pts.some((p) => inBox(p[0], p[1]))) ids.push(f.id)
        })
        G.pipes.forEach((p) => {
          if (inBox(p.pts[0][0], p.pts[0][1]) && inBox(p.pts[1][0], p.pts[1][1])) ids.push('base:' + p.id)
        })
        props.onMulti(ids)
        props.setStatus(ids.length ? 'Đã chọn ' + ids.length + ' đối tượng — sửa thuộc tính hàng loạt ở bảng bên phải.' : 'Khung rỗng — không có đối tượng.')
      }
      return
    }
    const wasPan = drag && drag.moved
    drag = null
    if (wasPan) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    handleClick(wx, wy)
  }

  const handleClick = (wx: number, wy: number) => {
    const tool = props.tool
    if (tool === 'select') {
      const hit = hitTest(wx, wy)
      if (hit) props.onSelect(hit.kind === 'draft' ? hit.f.id : { base: hit.base })
      else props.onSelect(null)
      return
    }
    if (tool === 'delete') {
      const hit = hitTest(wx, wy)
      if (hit) props.onDeleteAt(hit)
      return
    }
    if (tool === 'match') {
      const hit = hitTest(wx, wy)
      if (hit) props.onPaint(hit)
      else props.setStatus('Bấm đúng lên đối tượng')
      return
    }
    if (tool === 'pipe') {
      let sp = snapPoint(wx, wy)
      const d = draw()
      if (props.ortho && d && d.pts.length && sp.snap == null) {
        const last = d.pts[d.pts.length - 1]!
        const o = edOrtho(last[0], last[1], wx, wy)
        sp = { x: o[0], y: o[1], snap: null }
      }
      setDraw((d) => {
        const pts: Pt[] = d ? [...d.pts, [Math.round(sp.x), Math.round(sp.y)]] : [[Math.round(sp.x), Math.round(sp.y)]]
        return { pts }
      })
      return
    }
    if (tool === 'valve' || tool === 'node' || tool === 'hydrant') {
      const sp = snapPoint(wx, wy, { toLine: wantLine() })
      const dma = edDmaAt(G, sp.x, sp.y)
      const base: Draft = { id: newDraftId(), op: 'add', kind: tool, geom: 'point', x: Math.round(sp.x), y: Math.round(sp.y), dma, eam: null, onPipe: sp.snap === 'edge' ? sp.ref : null }
      if (tool === 'valve') Object.assign(base, { dn: props.defaults.valve.dn || 200, vkind: props.defaults.valve.vkind || 'gate', state: 'open' })
      if (tool === 'hydrant') Object.assign(base, { htype: '3 cửa' })
      if (tool === 'node') Object.assign(base, { ntype: 'Tê', z: 12 })
      props.onAdd(base)
      props.onSelect(base.id)
      return
    }
    if (tool === 'split') {
      const sp = snapPoint(wx, wy, { toLine: true })
      if (sp.snap !== 'edge') {
        props.setStatus('Bấm đúng lên tuyến ống để tách')
        return
      }
      const dma = edDmaAt(G, sp.x, sp.y)
      const nd: Draft = { id: newDraftId(), op: 'add', kind: 'node', geom: 'point', x: Math.round(sp.x), y: Math.round(sp.y), dma, ntype: 'Nút tách', z: 12, eam: null, splitOf: sp.ref }
      props.onAdd(nd)
      props.onSelect(nd.id)
      props.setStatus('Đã chèn nút tách trên ' + sp.ref)
      return
    }
    if (tool === 'offset') {
      const hit = hitTest(wx, wy)
      let pts: Pt[] | null = null,
        src: { dn?: number; material?: string; trunk?: boolean } | null = null
      if (hit && hit.kind === 'draft' && hit.f.kind === 'pipe' && hit.f.pts) {
        pts = hit.f.pts
        src = hit.f
      } else if (hit && hit.kind === 'base' && hit.base.type === 'pipe') {
        pts = hit.base.pts!
        src = G.pipeBy[hit.base.id] ?? null
      }
      if (!pts) {
        props.setStatus('Bấm lên tuyến ống để tạo song song')
        return
      }
      const mid = [(pts[0]![0] + pts[1]![0]) / 2, (pts[0]![1] + pts[1]![1]) / 2]
      let nx = -(pts[1]![1] - pts[0]![1]),
        ny = pts[1]![0] - pts[0]![0]
      const l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      const sgn = (wx - mid[0]!) * nx + (wy - mid[1]!) * ny >= 0 ? 1 : -1
      const distW = ((props.offsetDist || 2) / ED_U2M) * sgn
      const op = edOffsetPts(pts, distW)
      const dma = edDmaAt(G, op[0]![0], op[0]![1])
      const f: Draft = { id: newDraftId(), op: 'add', kind: 'pipe', geom: 'line', pts: op, dn: src && src.dn ? src.dn : 200, material: src && src.material ? src.material : 'HDPE', year: 2026, cond: 'good', trunk: src ? !!src.trunk : false, dma, lenM: Math.round(edPolyLen(op) * ED_U2M), eam: null }
      props.onAdd(f)
      props.onSelect(f.id)
      props.setStatus('Đã tạo ống song song offset ' + (props.offsetDist || 2) + ' m')
      return
    }
    if (tool === 'merge') {
      const hit = hitTest(wx, wy)
      if (!hit || hit.kind !== 'draft' || hit.f.kind !== 'pipe') {
        props.setStatus('Chỉ gộp được hai tuyến ống nháp (mới vẽ).')
        return
      }
      const cur = pend()
      if (!cur) {
        setPend(hit.f.id)
        props.setStatus('Đã chọn ' + hit.f.id + ' — bấm ống nháp thứ hai dùng chung đầu mút.')
        return
      }
      if (cur === hit.f.id) {
        setPend(null)
        props.setStatus('Đã huỷ chọn gộp.')
        return
      }
      const a = props.drafts.find((f) => f.id === cur),
        b = hit.f
      setPend(null)
      if (!a || !a.pts || !b.pts) return
      const tol = tolWorld() * 1.4
      let merged: Pt[] | null = null
      const aF = a.pts[0]!,
        aL = a.pts[a.pts.length - 1]!,
        bF = b.pts[0]!,
        bL = b.pts[b.pts.length - 1]!
      if (edDist(aL[0], aL[1], bF[0], bF[1]) < tol) merged = [...a.pts, ...b.pts.slice(1)]
      else if (edDist(aL[0], aL[1], bL[0], bL[1]) < tol) merged = [...a.pts, ...b.pts.slice(0, -1).reverse()]
      else if (edDist(aF[0], aF[1], bL[0], bL[1]) < tol) merged = [...b.pts, ...a.pts.slice(1)]
      else if (edDist(aF[0], aF[1], bF[0], bF[1]) < tol) merged = [...b.pts.slice().reverse(), ...a.pts.slice(1)]
      if (!merged) {
        props.setStatus('Hai ống không chung đầu mút — không gộp được.')
        return
      }
      props.onMerge(a, b, merged)
      return
    }
  }

  const finishPipe = () => {
    const d = draw()
    if (!d || d.pts.length < 2) {
      setDraw(null)
      return
    }
    const dma = edDmaAt(G, d.pts[0]![0], d.pts[0]![1])
    const lenM = Math.round(edPolyLen(d.pts) * ED_U2M)
    const dp = props.defaults.pipe
    const f: Draft = { id: newDraftId(), op: 'add', kind: 'pipe', geom: 'line', pts: d.pts, dn: dp.dn || 200, material: dp.material || 'HDPE', year: 2026, cond: dp.cond || 'good', trunk: !!dp.trunk, dma, lenM, eam: null }
    setDraw(null)
    props.onAdd(f)
    props.onSelect(f.id)
  }

  // keyboard: finish/cancel/backspace while drawing
  createEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && draw()) {
        e.preventDefault()
        finishPipe()
      }
      if (e.key === 'Escape') {
        if (draw()) setDraw(null)
        else props.onSelect(null)
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && draw()) {
        e.preventDefault()
        setDraw((d) => (d && d.pts.length > 1 ? { pts: d.pts.slice(0, -1) } : null))
      }
    }
    window.addEventListener('keydown', h)
    onCleanup(() => window.removeEventListener('keydown', h))
  })

  // reset transient state when tool changes
  createEffect(() => {
    const t = props.tool
    if (t !== 'pipe') setDraw(null)
    if (t !== 'merge' && t !== 'match') setPend(null)
    if (t !== 'window') {
      boxing = false
      setBox(null)
    }
    setHover(null)
  })

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const [x, y, w, h] = vb()
    const f = e.deltaY > 0 ? 1.12 : 1 / 1.12
    const nw = Math.max(150, Math.min(W * 1.7, w * f))
    const nh = nw * (h / w)
    setVb([wx - ((wx - x) / w) * nw, wy - ((wy - y) / h) * nh, nw, nh])
  }
  const zoomBtn = (f: number) => {
    const [x, y, w, h] = vb()
    const cx = x + w / 2,
      cy = y + h / 2
    const nw = Math.max(150, Math.min(W * 1.7, w * f))
    const nh = nw * (h / w)
    setVb([cx - nw / 2, cy - nh / 2, nw, nh])
  }

  const ac = () => cAccent()
  const addCol = () => tone('#1A7F37')
  const delCol = () => tone('#D1242F')
  const cursor = () => (props.tool === 'select' ? (drag ? 'grabbing' : 'grab') : 'crosshair')
  const multi = createMemo(() => new Set(props.multiSel))
  const RL = () => props.refLayers || {}

  return (
    <div class="relative h-full w-full overflow-hidden" style={{ background: pal().bg }}>
      <svg
        ref={svgRef}
        viewBox={vb().join(' ')}
        class="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        style={{ cursor: cursor(), 'touch-action': 'none' }}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => {
          drag = null
          moveRef = null
        }}
        onDblClick={() => {
          if (draw()) finishPipe()
        }}
      >
        <defs>
          <pattern id="edgrid" width="46" height="46" patternUnits="userSpaceOnUse">
            <path d="M46 0H0V46" fill="none" stroke={pal().grid} stroke-width="1" />
          </pattern>
        </defs>
        <rect x={-200} y={-200} width={W + 400} height={H + 400} fill={pal().bg} />
        <rect x={-200} y={-200} width={W + 400} height={H + 400} fill="url(#edgrid)" />
        <path d={G.river} fill="none" stroke={pal().water} stroke-width="46" stroke-linecap="round" opacity="0.7" />
        <path d={`${G.lake.reduce((s, p, i) => s + (i ? 'L' : 'M') + p[0] + ' ' + p[1] + ' ', '')}Z`} fill={pal().water} opacity="0.7" />
        <Show when={RL().block !== false}>
          <For each={G.blocks}>{(b) => <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="2.5" fill={pal().block} stroke={pal().blockLine} stroke-width="1" />}</For>
        </Show>

        {/* DMA ranh */}
        <Show when={RL().dma !== false}>
          <For each={G.dmas}>{(d) => <path d={roundedPoly(d.poly, 22, 0.97)} fill="none" stroke={tone(d.col)} stroke-width="1.2" stroke-dasharray="7 5" opacity="0.5" />}</For>
        </Show>

        {/* casing đường */}
        <Show when={RL().pipe !== false}>
          <For each={G.pipes}>{(p) => <line x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={pal().road} stroke-width={p.trunk ? 11 : 6.5} stroke-linecap="round" />}</For>
        </Show>

        {/* ống gốc (ngữ cảnh, mờ) + đánh dấu xoá/sửa */}
        <Show when={RL().pipe !== false}>
          <For each={G.pipes}>
            {(p) => {
              const df = () => props.drafts.find((f) => f.op !== 'add' && f.baseId === p.id)
              const isDel = () => df()?.op === 'del'
              const isMod = () => df()?.op === 'mod'
              const sel = () => {
                const s = props.selId
                return typeof s === 'object' && s !== null && 'base' in s && s.base.id === p.id
              }
              const mhl = () => multi().has('base:' + p.id)
              const col = () => (isDel() ? delCol() : isMod() ? tone('#9A6700') : pal().ctxPipe)
              const w = p.dn >= 500 ? 5.5 : p.dn >= 300 ? 4.2 : p.dn >= 200 ? 2.8 : 2
              return (
                <g>
                  <Show when={sel() || mhl()}>
                    <line x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={ac()} stroke-width={w + 5} stroke-linecap="round" opacity="0.3" />
                  </Show>
                  <line x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={col()} stroke-width={w} stroke-linecap="round" stroke-dasharray={isDel() ? '5 5' : undefined} opacity={isDel() ? 0.85 : 1} />
                </g>
              )
            }}
          </For>
        </Show>
        {/* nút gốc */}
        <Show when={RL().node !== false && pxScale() < 0.6}>
          <For each={G.nodes}>{(n) => <circle cx={n.x} cy={n.y} r="2" fill={theme() === 'light' ? '#fff' : '#0D1117'} stroke={pal().ctxNode} stroke-width="1.2" />}</For>
        </Show>
        {/* van gốc */}
        <Show when={RL().valve !== false}>
          <For each={G.valves}>
            {(v) => {
              const df = () => props.drafts.find((f) => f.op === 'del' && f.baseId === v.id)
              const col = () => (df() ? delCol() : tone('#9aa4b1'))
              return <rect x={v.x - 3.4} y={v.y - 3.4} width={6.8} height={6.8} transform={`rotate(45 ${v.x} ${v.y})`} fill={theme() === 'light' ? '#fff' : '#0D1117'} stroke={col()} stroke-width="1.3" stroke-dasharray={df() ? '2 2' : undefined} />
            }}
          </For>
        </Show>

        {/* ===== DRAFT (đối tượng mới) ===== */}
        <For each={props.drafts.filter((f) => f.op === 'add')}>
          {(f) => {
            const meta = KIND_META[f.kind]
            const col = () => tone(meta.col)
            const sel = () => props.selId === f.id
            const hl = () => sel() || multi().has(f.id) || pend() === f.id
            if (f.kind === 'pipe') {
              const d = () => f.pts!.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ')
              const dcol = () => (f.imported ? tone('#9A6700') : addCol())
              return (
                <g>
                  <Show when={hl()}>
                    <path d={d()} fill="none" stroke={ac()} stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.28" />
                  </Show>
                  <path d={d()} fill="none" stroke={dcol()} stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray={f.imported ? '8 5' : undefined} />
                  <For each={f.pts!}>{(p) => <circle cx={p[0]} cy={p[1]} r={sel() || pend() === f.id ? 3.4 : 2.6} fill={theme() === 'light' ? '#fff' : '#0D1117'} stroke={dcol()} stroke-width="1.6" />}</For>
                </g>
              )
            }
            const pcol = () => (f.imported ? tone('#9A6700') : col())
            return (
              <g class="cursor-pointer">
                <Show when={hl()}>
                  <circle cx={f.x} cy={f.y} r="9" fill="none" stroke={ac()} stroke-width="2" />
                </Show>
                <Show
                  when={f.kind === 'valve'}
                  fallback={
                    <Show
                      when={f.kind === 'hydrant'}
                      fallback={<circle cx={f.x} cy={f.y} r="3.6" fill={theme() === 'light' ? '#fff' : '#0D1117'} stroke={pcol()} stroke-width="1.9" />}
                    >
                      <circle cx={f.x} cy={f.y} r="4" fill={pcol()} stroke="#fff" stroke-width="1.3" />
                    </Show>
                  }
                >
                  <rect x={f.x! - 4.6} y={f.y! - 4.6} width={9.2} height={9.2} transform={`rotate(45 ${f.x} ${f.y})`} fill={theme() === 'light' ? '#fff' : '#0D1117'} stroke={pcol()} stroke-width="1.9" />
                </Show>
                <circle cx={f.x! + 6} cy={f.y! - 6} r="2.4" fill={pcol()} />
              </g>
            )
          }}
        </For>

        {/* ===== đang vẽ ống ===== */}
        <Show when={draw()}>
          {(d) => {
            const pts = () => d().pts
            const hp = () => {
              const h = hover()
              return props.tool === 'pipe' && h ? ([h.x, h.y] as Pt) : null
            }
            const dd = () => pts().map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ')
            return (
              <g>
                <path d={dd()} fill="none" stroke={ac()} stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
                <Show when={hp()}>
                  {(h) => <line x1={pts()[pts().length - 1]![0]} y1={pts()[pts().length - 1]![1]} x2={h()[0]} y2={h()[1]} stroke={ac()} stroke-width="2.4" stroke-dasharray="5 5" stroke-linecap="round" opacity="0.8" />}
                </Show>
                <For each={pts()}>{(p) => <circle cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke={ac()} stroke-width="1.8" />}</For>
                <Show when={pts().length}>
                  <text x={pts()[0]![0]} y={pts()[0]![1] - 9} text-anchor="middle" font-size="9" class="font-mono" fill={ac()}>
                    {fmtKm(Math.round(edPolyLen(hp() ? [...pts(), hp()!] : pts()) * ED_U2M))}
                  </text>
                </Show>
              </g>
            )
          }}
        </Show>

        {/* ===== chỉ báo snap / hover ===== */}
        <Show when={hover()}>
          {(h) => (
            <g>
              <Show when={h().snap}>
                <circle cx={h().x} cy={h().y} r="6.5" fill="none" stroke={ac()} stroke-width="2" />
              </Show>
              <circle cx={h().x} cy={h().y} r="2" fill={ac()} />
              <Show when={h().snap === 'edge'} fallback={<Show when={h().snap}><text x={h().x + 9} y={h().y - 7} font-size="8.5" class="font-mono" fill={ac()}>bắt nút</text></Show>}>
                <text x={h().x + 9} y={h().y - 7} font-size="8.5" class="font-mono" fill={ac()}>tim ống</text>
              </Show>
            </g>
          )}
        </Show>
        {/* ===== chọn vùng (window) ===== */}
        <Show when={box()}>
          {(b) => <rect x={Math.min(b().x0, b().x1)} y={Math.min(b().y0, b().y1)} width={Math.abs(b().x1 - b().x0)} height={Math.abs(b().y1 - b().y0)} fill={chex(cAccent(), 0.1)} stroke={ac()} stroke-width="1.4" stroke-dasharray="5 4" />}
        </Show>
      </svg>
      {/* zoom */}
      <div class="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-line bg-[var(--surface)]" style={{ 'box-shadow': 'var(--card-shadow)' }}>
        <button onClick={() => zoomBtn(1 / 1.4)} class="flex h-8 w-8 items-center justify-center text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
          <IcPlus size={16} />
        </button>
        <button onClick={() => zoomBtn(1.4)} class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
          <IcMinus size={16} />
        </button>
        <button onClick={() => setVb(fullVB)} class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
          <IcExpand size={15} />
        </button>
      </div>
    </div>
  )
}
