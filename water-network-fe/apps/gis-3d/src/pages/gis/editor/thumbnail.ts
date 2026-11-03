/* GIS — Biên tập: small preview image of a branch (network + the branch's drafts), drawn with
   Canvas 2D from the data rather than captured from the WebGL map, so it works whatever the
   camera/basemap and never comes out blank. Stored on the branch as a PNG data URL. */
import type { GisData } from '../lib/gis-data'
import type { Draft, Pt } from './model'

export interface ThumbOptions {
  width?: number
  height?: number
  dark?: boolean
}

type Box = { minX: number; minY: number; maxX: number; maxY: number }

const grow = (b: Box, x: number, y: number) => {
  if (x < b.minX) b.minX = x
  if (y < b.minY) b.minY = y
  if (x > b.maxX) b.maxX = x
  if (y > b.maxY) b.maxY = y
}
const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
const valid = (b: Box) => Number.isFinite(b.minX) && b.maxX >= b.minX

/** Geometry a draft shows on the map (base geometry for a delete). */
function draftShape(G: GisData, d: Draft): { line?: Pt[]; point?: Pt } | null {
  if (d.pts && d.pts.length > 1) return { line: d.pts }
  if (d.x !== undefined && d.y !== undefined) return { point: [d.x, d.y] }
  if (d.baseId) {
    const p = G.pipeBy[d.baseId]
    if (p) return { line: p.pts as unknown as Pt[] }
    const pt = G.valves.find((v) => v.id === d.baseId) ?? G.hydrants.find((h) => h.id === d.baseId) ?? G.nodes.find((n) => n.id === d.baseId)
    if (pt) return { point: [pt.x, pt.y] }
  }
  return null
}

/** Area the thumbnail frames: around the drafts (with context), else the whole network. */
export function thumbFrame(G: GisData, drafts: Draft[], aspect: number): Box | null {
  const net = emptyBox()
  for (const p of G.pipes) for (const [x, y] of p.pts) grow(net, x, y)
  if (!valid(net)) return null
  const d = emptyBox()
  for (const f of drafts) {
    const s = draftShape(G, f)
    if (s?.line) for (const [x, y] of s.line) grow(d, x, y)
    if (s?.point) grow(d, s.point[0], s.point[1])
  }
  const base = valid(d) ? d : net
  // never zoom closer than ~22% of the network, so a single pipe still shows its surroundings
  const minW = (net.maxX - net.minX) * 0.22
  let w = Math.max(base.maxX - base.minX, minW) * 1.25
  let h = Math.max(base.maxY - base.minY, minW / aspect) * 1.25
  if (w / h > aspect) h = w / aspect
  else w = h * aspect
  const cx = (base.minX + base.maxX) / 2
  const cy = (base.minY + base.maxY) / 2
  return { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 }
}

/** Render the preview; returns a PNG data URL, or null where Canvas 2D is unavailable. */
export function renderBranchThumb(G: GisData, drafts: Draft[], opts: ThumbOptions = {}): string | null {
  const W = opts.width ?? 320
  const H = opts.height ?? 180
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const scale = 2 // crisp on high-DPI screens
  canvas.width = W * scale
  canvas.height = H * scale
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) return null
  const frame = thumbFrame(G, drafts, W / H)
  if (!frame) return null
  const k = (W / (frame.maxX - frame.minX)) * scale
  const tx = (x: number) => (x - frame.minX) * k
  const ty = (y: number) => (y - frame.minY) * k
  const dark = !!opts.dark

  ctx.fillStyle = dark ? '#0f1720' : '#eef2f5'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const path = (pts: readonly (readonly [number, number])[]) => {
    ctx!.beginPath()
    pts.forEach(([x, y], i) => (i ? ctx!.lineTo(tx(x), ty(y)) : ctx!.moveTo(tx(x), ty(y))))
  }

  // DMA outlines
  ctx.setLineDash([4 * scale, 3 * scale])
  for (const d of G.dmas) {
    if (!d.poly.length) continue
    path([...d.poly, d.poly[0]!])
    ctx.strokeStyle = d.col + '66'
    ctx.lineWidth = 1 * scale
    ctx.stroke()
  }
  ctx.setLineDash([])

  // existing network: distribution first, trunk mains on top
  const zoom = Math.min(3, Math.max(0.6, k / scale / 0.05))
  for (const trunk of [false, true]) {
    ctx.strokeStyle = trunk ? (dark ? '#56C7D6' : '#0E7C86') : dark ? 'rgba(127,208,219,0.55)' : 'rgba(63,160,168,0.6)'
    ctx.lineWidth = (trunk ? 1.4 : 0.6) * scale * zoom
    for (const p of G.pipes) {
      if (!!p.trunk !== trunk || p.status === 'abandoned') continue
      path(p.pts)
      ctx.stroke()
    }
  }

  // the branch's own changes, haloed so they read at thumbnail size
  const COL = { add: '#2DA44E', mod: '#D29922', del: '#E5534B' } as const
  for (const d of drafts) {
    const s = draftShape(G, d)
    if (!s) continue
    const col = COL[d.op]
    if (s.line) {
      ctx.setLineDash(d.op === 'del' ? [3 * scale, 3 * scale] : [])
      path(s.line)
      ctx.strokeStyle = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 5 * scale
      ctx.stroke()
      ctx.strokeStyle = col
      ctx.lineWidth = 2.6 * scale
      ctx.stroke()
      ctx.setLineDash([])
    } else if (s.point) {
      ctx.beginPath()
      ctx.arc(tx(s.point[0]), ty(s.point[1]), 3.4 * scale, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
      ctx.strokeStyle = dark ? '#000' : '#fff'
      ctx.lineWidth = 1.2 * scale
      ctx.stroke()
    }
  }
  try {
    // WebP keeps a stored preview at a few KB (falls back to PNG where unsupported)
    return canvas.toDataURL('image/webp', 0.82)
  } catch {
    return null
  }
}
