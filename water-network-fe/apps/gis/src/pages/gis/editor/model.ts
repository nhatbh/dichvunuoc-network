/* GIS — Biên tập mạng lưới: model layer (SolidJS port of the non-component parts of
   editor.jsx + editor-cad.jsx). Geometry helpers, tool/template/rule catalogs and the
   business-rule engine. The design read a global `window.GIS`; here every function that
   needs the dataset takes the `GisData` value from `useGis()` explicitly. */
import type { GisData } from '../lib/gis-data'

/* ── geometry ── */
export function edDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}
export function edProj(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay,
    l2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const x = ax + t * dx,
    y = ay + t * dy
  return { x, y, t, d: Math.hypot(px - x, py - y) }
}
export function edPolyLen(pts: Pt[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += edDist(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1])
  return s
}
export function edOrtho(ax: number, ay: number, bx: number, by: number): Pt {
  const dx = bx - ax,
    dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return [bx, by]
  const step = Math.PI / 4
  const a = Math.round(Math.atan2(dy, dx) / step) * step
  return [ax + Math.cos(a) * len, ay + Math.sin(a) * len]
}
export function edOffsetPts(pts: Pt[], dist: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!,
      b = pts[Math.min(pts.length - 1, i + 1)]!
    let nx = -(b[1] - a[1]),
      ny = b[0] - a[0]
    const l = Math.hypot(nx, ny) || 1
    nx /= l
    ny /= l
    out.push([Math.round(pts[i]![0] + nx * dist), Math.round(pts[i]![1] + ny * dist)])
  }
  return out
}
export function edBearing(ax: number, ay: number, bx: number, by: number): number {
  let deg = (Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI
  if (deg < 0) deg += 360
  return deg
}

export const ED_U2M = 1.15
export const ED_DN = [100, 110, 150, 160, 200, 250, 300, 400, 500, 600]

/* ── types ── */
export type Pt = [number, number]
export type DraftOp = 'add' | 'mod' | 'del'
export type DraftKind = 'pipe' | 'valve' | 'hydrant' | 'node'

export interface EamRec {
  code: string
  kind: DraftKind
  name: string
  serial: string
  maker: string
  year: number
}

export interface Draft {
  id: string
  op: DraftOp
  kind: DraftKind
  geom: 'line' | 'point'
  baseId?: string
  pts?: Pt[]
  x?: number
  y?: number
  dn?: number
  material?: string
  year?: number
  cond?: string
  trunk?: boolean
  vkind?: string
  state?: string
  htype?: string
  ntype?: string
  z?: number
  dma: string
  eam?: EamRec | null
  onPipe?: string | null
  lenM?: number
  imported?: boolean
  splitOf?: string
}

/** Base object referenced from a selection (an existing, non-draft feature). */
export interface BaseRef {
  type: DraftKind
  id: string
  x?: number
  y?: number
  geom?: 'line' | 'point'
  pts?: Pt[]
}
export type CanvasSel = string | { base: BaseRef } | null
export type Hit = { kind: 'draft'; f: Draft } | { kind: 'base'; base: BaseRef }

export interface RuleIssue {
  sev: 'error' | 'warn'
  rule: string
  msg: string
}

/* ── tool catalog ── */
export interface EdTool {
  id: string
  grp: 'sel' | 'draw' | 'mod'
  label: string
  icon: string
  cmd: string
  hint: string
}
export const ED_TOOLS: EdTool[] = [
  { id: 'select', grp: 'sel', label: 'Chọn / di chuyển', icon: 'IcCrosshair', cmd: 'S', hint: 'Chọn đối tượng nháp, kéo điểm/đỉnh để di chuyển. Bấm đối tượng gốc để khoá sửa.' },
  { id: 'window', grp: 'sel', label: 'Chọn vùng (lô)', icon: 'IcGridSq', cmd: 'W', hint: 'Kéo một khung để chọn nhiều đối tượng — sửa thuộc tính hàng loạt ở bảng bên phải.' },
  { id: 'pipe', grp: 'draw', label: 'Vẽ tuyến ống', icon: 'IcPipe', cmd: 'PL', hint: 'Bấm để đặt đỉnh. Enter/nhấp đúp kết thúc, Esc huỷ. Bật ORTHO để khoá góc 45°.' },
  { id: 'valve', grp: 'draw', label: 'Đặt van', icon: 'IcValve', cmd: 'VA', hint: 'Bấm lên tuyến ống — van bắt dính vào tim ống.' },
  { id: 'hydrant', grp: 'draw', label: 'Đặt trụ cứu hoả', icon: 'IcHydrant', cmd: 'HY', hint: 'Bấm để đặt trụ cứu hoả.' },
  { id: 'node', grp: 'draw', label: 'Đặt nút / phụ kiện', icon: 'IcNode', cmd: 'ND', hint: 'Bấm để đặt nút, cút, tê, côn…' },
  { id: 'split', grp: 'mod', label: 'Tách ống', icon: 'IcGitBranch', cmd: 'SP', hint: 'Bấm lên ống để chèn nút tách tại vị trí đó.' },
  { id: 'merge', grp: 'mod', label: 'Gộp ống', icon: 'IcMerge', cmd: 'MG', hint: 'Bấm 2 ống nháp dùng chung 1 đầu mút để gộp thành một tuyến.' },
  { id: 'offset', grp: 'mod', label: 'Vẽ song song', icon: 'IcOffset', cmd: 'OF', hint: 'Bấm tuyến ống để tạo ống song song theo khoảng cách offset.' },
  { id: 'match', grp: 'mod', label: 'Sao chép thuộc tính', icon: 'IcCopy', cmd: 'MA', hint: 'Bấm đối tượng nguồn (lấy mẫu), rồi bấm các đối tượng đích để gán thuộc tính.' },
  { id: 'delete', grp: 'mod', label: 'Xoá', icon: 'IcTrash', cmd: 'E', hint: 'Bấm đối tượng để xoá (đối tượng gốc sẽ đánh dấu xoá).' },
]
export const ED_TOOL_GRP: [string, string][] = [
  ['sel', 'Chọn'],
  ['draw', 'Vẽ'],
  ['mod', 'Sửa'],
]

export interface KindMeta {
  label: string
  icon: string
  col: string
  geom: 'line' | 'point'
}
export const KIND_META: Record<DraftKind, KindMeta> = {
  pipe: { label: 'Tuyến ống', icon: 'IcPipe', col: '#0E7C86', geom: 'line' },
  valve: { label: 'Van', icon: 'IcValve', col: '#0969DA', geom: 'point' },
  hydrant: { label: 'Trụ cứu hoả', icon: 'IcHydrant', col: '#D1242F', geom: 'point' },
  node: { label: 'Nút / Phụ kiện', icon: 'IcNode', col: '#8250DF', geom: 'point' },
}

/* mock danh mục lý lịch tài sản (EAM) để gắn vào geometry */
export const EAM_REG: EamRec[] = [
  { code: 'EAM-VAN-2291', kind: 'valve', name: 'Van cổng DN300 gang dẻo', serial: 'AVK-300-8841', maker: 'AVK', year: 2024 },
  { code: 'EAM-VAN-2288', kind: 'valve', name: 'Van bướm DN200 PN16', serial: 'KSB-200-1190', maker: 'KSB', year: 2023 },
  { code: 'EAM-VAN-2275', kind: 'valve', name: 'Van xả khí DN80', serial: 'ARI-080-3321', maker: 'A.R.I', year: 2023 },
  { code: 'EAM-ONG-5512', kind: 'pipe', name: 'Ống HDPE DN160 PN10', serial: 'LOT-24-HDPE-160', maker: 'Nhựa Bình Minh', year: 2024 },
  { code: 'EAM-ONG-5489', kind: 'pipe', name: 'Ống gang dẻo DN300 K9', serial: 'LOT-23-DI-300', maker: 'Saint-Gobain', year: 2023 },
  { code: 'EAM-ONG-5460', kind: 'pipe', name: 'Ống uPVC DN200', serial: 'LOT-23-UPVC-200', maker: 'Tiền Phong', year: 2023 },
  { code: 'EAM-PCC-0771', kind: 'hydrant', name: 'Trụ cứu hoả 3 cửa', serial: 'PCC-3C-0771', maker: 'Shinyi', year: 2023 },
  { code: 'EAM-PK-1203', kind: 'node', name: 'Cút / Tê gang DN300', serial: 'FIT-DI-300-77', maker: 'Saint-Gobain', year: 2024 },
]

/* ── feature templates (presets) ── */
export interface EdTemplate {
  id: string
  kind: DraftKind
  label: string
  sub: string
  attrs: Record<string, string | number | boolean>
}
export const ED_TEMPLATES: EdTemplate[] = [
  { id: 'trunk300', kind: 'pipe', label: 'Ống chính DN300 HDPE', sub: 'Truyền tải', attrs: { dn: 300, material: 'HDPE', trunk: true, cond: 'good' } },
  { id: 'di300', kind: 'pipe', label: 'Ống gang dẻo DN300', sub: 'Truyền tải', attrs: { dn: 300, material: 'Gang dẻo', trunk: true, cond: 'good' } },
  { id: 'dist160', kind: 'pipe', label: 'Ống phân phối DN160', sub: 'HDPE PN10', attrs: { dn: 160, material: 'HDPE', trunk: false, cond: 'good' } },
  { id: 'dist110', kind: 'pipe', label: 'Ống dịch vụ DN110', sub: 'uPVC', attrs: { dn: 110, material: 'uPVC', trunk: false, cond: 'good' } },
  { id: 'gate200', kind: 'valve', label: 'Van cổng DN200', sub: 'Van chặn', attrs: { dn: 200, vkind: 'gate' } },
  { id: 'bound200', kind: 'valve', label: 'Van biên DMA DN200', sub: 'Phân vùng', attrs: { dn: 200, vkind: 'boundary' } },
  { id: 'hyd3', kind: 'hydrant', label: 'Trụ cứu hoả 3 cửa', sub: 'PCC', attrs: { htype: '3 cửa' } },
]

/* ── business rules ── */
export interface RuleDef {
  label: string
  sev: 'error' | 'warn'
  lock?: boolean
}
export const ED_RULE_DEFS: Record<string, RuleDef> = {
  dangling: { label: 'Đầu ống đấu nối (chống dangling)', sev: 'error', lock: true },
  boundaryValve: { label: 'Van bắt buộc tại ranh DMA', sev: 'error' },
  eam: { label: 'Gắn EAM trước khi commit', sev: 'error' },
  material: { label: 'Tương thích vật liệu mối nối', sev: 'warn' },
  dn: { label: 'Chênh DN — cần côn thu', sev: 'warn' },
  overlap: { label: 'Cảnh báo trùng/đè geometry', sev: 'warn' },
  connectivity: { label: 'Liên thông tới nguồn (realtime)', sev: 'warn' },
}

/* dma theo vị trí (xấp xỉ từ ranh giới DMA) */
export function edDmaAt(G: GisData, x: number, y: number): string {
  let hit: string | null = null
  G.dmas.forEach((d) => {
    const xs = d.poly.map((p) => p[0]),
      ys = d.poly.map((p) => p[1])
    if (x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)) hit = d.id
  })
  return hit || 'DMA-01'
}

export function edRules(G: GisData, drafts: Draft[], flags: Record<string, boolean>): RuleIssue[] {
  const f = flags || {}
  const tol = 14
  const issues: RuleIssue[] = []
  const adds = drafts.filter((d) => d.op !== 'del')
  const baseEndpts: Pt[] = []
  G.nodes.forEach((n) => baseEndpts.push([n.x, n.y]))
  G.pipes.forEach((p) => {
    baseEndpts.push(p.pts[0], p.pts[1])
  })
  const near = (pt: Pt, arr: Pt[]) => arr.some((q) => q !== pt && Math.hypot(q[0] - pt[0], q[1] - pt[1]) < tol)
  const allEnds: Pt[] = [...baseEndpts]
  adds.forEach((d) => {
    if (d.kind === 'pipe' && d.pts) d.pts.forEach((p) => allEnds.push(p))
    else if (d.geom === 'point') allEnds.push([d.x!, d.y!])
  })
  const valvePts: Pt[] = [
    ...G.valves.map((v) => [v.x, v.y] as Pt),
    ...adds.filter((d) => d.kind === 'valve').map((d) => [d.x!, d.y!] as Pt),
  ]
  adds
    .filter((d) => d.kind === 'pipe' && d.op === 'add')
    .forEach((d) => {
      const pts = d.pts!
      const ends: Pt[] = [pts[0]!, pts[pts.length - 1]!]
      if (f.dangling !== false)
        ends.forEach((e, i) => {
          if (!near(e, allEnds)) issues.push({ sev: 'error', rule: 'dangling', msg: `${d.id}: đầu ${i ? 'cuối' : 'đầu'} ống chưa đấu nối (dangling).` })
        })
      if (f.boundaryValve !== false) {
        const da = edDmaAt(G, pts[0]![0], pts[0]![1]),
          db = edDmaAt(G, pts[pts.length - 1]![0], pts[pts.length - 1]![1])
        if (da !== db) {
          const hasV = valvePts.some((v) => pts.some((p) => Math.hypot(p[0] - v[0], p[1] - v[1]) < tol * 5))
          if (!hasV) issues.push({ sev: 'error', rule: 'boundaryValve', msg: `${d.id}: cắt ranh ${da}/${db} nhưng chưa đặt van biên.` })
        }
      }
      if (f.connectivity !== false && !ends.some((e) => near(e, baseEndpts))) issues.push({ sev: 'warn', rule: 'connectivity', msg: `${d.id}: chưa nối vào mạng hiện trạng (đoạn cô lập).` })
      ends.forEach((e) =>
        G.pipes.forEach((bp) => {
          if (Math.hypot(bp.pts[0][0] - e[0], bp.pts[0][1] - e[1]) < tol || Math.hypot(bp.pts[1][0] - e[0], bp.pts[1][1] - e[1]) < tol) {
            if (f.dn !== false && Math.abs((bp.dn || 0) - (d.dn || 0)) >= 200) {
              const hasNode = adds.some((nf) => nf.kind === 'node' && Math.hypot(nf.x! - e[0], nf.y! - e[1]) < tol)
              if (!hasNode) issues.push({ sev: 'warn', rule: 'dn', msg: `${d.id}: chênh DN với ${bp.id} (DN${bp.dn}→DN${d.dn}) — cần côn thu.` })
            }
            if (f.material !== false && bp.material && d.material && bp.material !== d.material) issues.push({ sev: 'warn', rule: 'material', msg: `${d.id}: mối nối khác vật liệu (${bp.material}→${d.material}).` })
          }
        }),
      )
    })
  if (f.overlap !== false) {
    const ap = adds.filter((d) => d.kind === 'pipe' && d.op === 'add')
    for (let i = 0; i < ap.length; i++)
      for (let j = i + 1; j < ap.length; j++) {
        const a = ap[i]!,
          b = ap[j]!
        const e = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol
        const aL = a.pts![a.pts!.length - 1]!,
          bL = b.pts![b.pts!.length - 1]!
        if ((e(a.pts![0]!, b.pts![0]!) && e(aL, bL)) || (e(a.pts![0]!, bL) && e(aL, b.pts![0]!))) issues.push({ sev: 'warn', rule: 'overlap', msg: `${a.id} & ${b.id}: trùng/đè tuyến ống.` })
      }
  }
  if (f.eam !== false)
    adds.filter((d) => d.op === 'add' && (d.kind === 'pipe' || d.kind === 'valve') && !d.eam).forEach((d) => issues.push({ sev: 'error', rule: 'eam', msg: `${d.id}: chưa gắn lý lịch tài sản EAM.` }))
  const seen = new Set<string>()
  return issues.filter((i) => {
    if (seen.has(i.msg)) return false
    seen.add(i.msg)
    return true
  })
}

/* ── draft id sequence ── */
let edSeq = 1
export const newDraftId = (): string => 'DRF-' + String(edSeq++).padStart(3, '0')
export const newRandDraftId = (): string => 'DRF-' + genToken(3)

/** Deterministic-ish token without Math.random collisions in the same tick. */
let tokSeq = 0
function genToken(len: number): string {
  const src = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  let n = (tokSeq++ * 2654435761 + edSeq * 40503) >>> 0
  for (let i = 0; i < len; i++) {
    out += src[n % src.length]
    n = Math.floor(n / src.length) + 7
  }
  return out
}

/* Sample import features (RTK survey) loaded onto the canvas as drafts. */
export function genImportFeatures(G: GisData): Draft[] {
  const ox = 16,
    oy = 12
  const N = (id: string) => G.nodes.find((n) => n.id === id)
  const pairs = [
    ['ND-60', 'ND-70'],
    ['ND-70', 'ND-80'],
    ['ND-60', 'ND-61'],
    ['ND-70', 'ND-71'],
    ['ND-80', 'ND-81'],
  ]
  const out: Draft[] = []
  pairs.forEach(([a, b]) => {
    const na = N(a!),
      nb = N(b!)
    if (!na || !nb) return
    const pts: Pt[] = [
      [na.x + ox, na.y + oy],
      [nb.x + ox, nb.y + oy],
    ]
    out.push({ id: newDraftId(), op: 'add', kind: 'pipe', geom: 'line', pts, dn: 400, material: 'Gang dẻo', year: 2026, cond: 'good', trunk: true, dma: 'DMA-03', lenM: Math.round(edPolyLen(pts) * ED_U2M), eam: null, imported: true })
  })
  ;[0, 2].forEach((idx) => {
    const p = out[idx]
    if (!p || !p.pts) return
    const mx = (p.pts[0]![0] + p.pts[1]![0]) / 2,
      my = (p.pts[0]![1] + p.pts[1]![1]) / 2
    out.push({ id: newDraftId(), op: 'add', kind: 'valve', geom: 'point', x: Math.round(mx), y: Math.round(my), dma: 'DMA-03', dn: 400, vkind: 'gate', state: 'open', onPipe: p.id, eam: null, imported: true })
  })
  return out
}
