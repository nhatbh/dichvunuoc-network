/* Bản đồ mạng lưới GIS — SVG map renderer (SolidJS port of mapcanvas.jsx).
   Synthetic basemap (blocks/river/lake/parks/grid) + network layers
   (DMA/pipes/valves/hydrants/nodes/sources) with pan (drag), zoom (wheel/buttons),
   selection, legend, scale bar, measure overlay. THIS is the viewer map — not OpenLayers. */
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { StatusDot } from './kit'
import { midOf, useGis, type GisData, type Pipe } from '../lib/gis-data'
import { IcExpand, IcMinus, IcPlus } from '../lib/icons'
import { cAccent, chex, cTheme, fmtKm, lighten, tone, type ThemeName } from '../lib/theme'

export type Selection = { type: string; id: string } | null
export interface LayerVis {
  [k: string]: boolean
}
export interface Emphasis {
  dim?: boolean
  pipes?: Set<string> | string[]
  valvesClosed?: Set<string>
  valvesOpen?: Set<string>
}
export interface FocusBox {
  x: number
  y: number
  w: number
  h: number
  _k?: number
}
export interface Pin {
  id?: string
  x: number
  y: number
  col: string
  shape?: 'diamond' | 'marker'
  pulse?: boolean
  sel?: boolean
  onClick?: () => void
}

function centroid(pts: [number, number][]): [number, number] {
  const n = pts.length
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
}
export function roundedPoly(pts: [number, number][], r = 16, shrink = 0.985): string {
  const [cx, cy] = centroid(pts)
  const q = pts.map(([x, y]) => [cx + (x - cx) * shrink, cy + (y - cy) * shrink] as [number, number])
  const n = q.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const p0 = q[(i + n - 1) % n]!,
      p1 = q[i]!,
      p2 = q[(i + 1) % n]!
    const v1 = [p1[0] - p0[0], p1[1] - p0[1]],
      v2 = [p2[0] - p1[0], p2[1] - p1[1]]
    const l1 = Math.hypot(v1[0]!, v1[1]!) || 1,
      l2 = Math.hypot(v2[0]!, v2[1]!) || 1
    const r1 = Math.min(r, l1 / 2),
      r2 = Math.min(r, l2 / 2)
    const a = [p1[0] - (v1[0]! / l1) * r1, p1[1] - (v1[1]! / l1) * r1]
    const b = [p1[0] + (v2[0]! / l2) * r2, p1[1] + (v2[1]! / l2) * r2]
    d += (i === 0 ? `M ${a[0]} ${a[1]} ` : `L ${a[0]} ${a[1]} `) + `Q ${p1[0]} ${p1[1]} ${b[0]} ${b[1]} `
  }
  return d + 'Z'
}

const MAP_PAL = {
  light: {
    bg: '#E7ECEF',
    water: '#aaccE3',
    waterLine: '#8DBBD6',
    park: '#CDE6C4',
    parkLine: '#B6D7AB',
    block: '#D9DEE3',
    block2: '#D0D6DC',
    blockLine: 'rgba(30,40,55,0.05)',
    road: '#FFFFFF',
    roadMinor: '#F3F1EB',
    roadLine: 'rgba(30,40,55,0.05)',
    grid: 'rgba(30,40,55,0.03)',
  },
  dark: {
    bg: '#0D1117',
    water: '#13293f',
    waterLine: '#1d3a55',
    park: '#13241a',
    parkLine: '#1c3326',
    block: '#161b22',
    block2: '#1a212a',
    blockLine: 'rgba(240,246,252,0.04)',
    road: 'rgba(240,246,252,0.10)',
    roadMinor: 'rgba(240,246,252,0.045)',
    roadLine: 'rgba(240,246,252,0.05)',
    grid: 'rgba(240,246,252,0.02)',
  },
} as const

const PAINT_MAT: Record<string, string> = {
  'Gang dẻo': '#0E7C86',
  HDPE: '#1A7F37',
  uPVC: '#0969DA',
  Thép: '#8250DF',
  'Gang xám': '#9A6700',
}

function pipeColor(p: Pipe, theme: ThemeName, paint: { mode?: string } | undefined, G: GisData): string {
  const t = (h: string) => (theme === 'light' ? h : lighten(h))
  const mode = paint && paint.mode
  if (mode && mode !== 'status') {
    if (p.status === 'abandoned') return theme === 'light' ? '#C2CAD3' : '#4a5260'
    if (mode === 'material') return t(PAINT_MAT[p.material] || '#7E8997')
    if (mode === 'cond') return t((G.COND[p.cond] || { col: '#7E8997' }).col || '#7E8997')
    if (mode === 'dma') return t((G.dmas.find((d) => d.id === p.dma) || { col: '#7E8997' }).col || '#7E8997')
    if (mode === 'dn') {
      const d = p.dn
      return t(d >= 500 ? '#8250DF' : d >= 300 ? '#0969DA' : d >= 200 ? '#0E7C86' : d >= 150 ? '#1A7F37' : '#9A6700')
    }
    if (mode === 'age') {
      const a = 2026 - p.year
      return t(a > 30 ? '#D1242F' : a > 18 ? '#D86C1F' : a > 8 ? '#9A6700' : '#1A7F37')
    }
  }
  if (p.status === 'leak') return t('#D1242F')
  if (p.status === 'planned') return t('#0969DA')
  if (p.status === 'abandoned') return theme === 'light' ? '#AEB8C4' : '#5a6573'
  return p.trunk ? t('#0E7C86') : theme === 'light' ? '#3FA0A8' : '#7fd0db'
}

export function NetworkMap(props: {
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
  const pal = () => MAP_PAL[theme()]
  let svgRef: SVGSVGElement | undefined
  const W = G.world.w,
    H = G.world.h
  const fullVB: [number, number, number, number] = [-40, -40, W + 80, H + 80]
  const [vb, setVb] = createSignal<[number, number, number, number]>(fullVB)
  let drag: { sx: number; sy: number; vb: [number, number, number, number]; moved: boolean } | null = null

  const minor = createMemo(() => {
    const out: [[number, number], [number, number]][] = []
    G.blocks.forEach((b, i) => {
      if (i % 4 === 0) out.push([[b.x - 8, b.y + b.h / 2], [b.x + b.w + 8, b.y + b.h / 2]])
    })
    return out
  })

  // focus → set viewBox
  createEffect(() => {
    const f = props.focus
    if (!f) return
    void f._k
    const pad = Math.max(f.w, f.h) * 0.18 + 40
    let x = f.x - pad,
      y = f.y - pad,
      w = f.w + pad * 2,
      h = f.h + pad * 2
    const ar = fullVB[2] / fullVB[3]
    if (w / h > ar) {
      const nh = w / ar
      y -= (nh - h) / 2
      h = nh
    } else {
      const nw = h * ar
      x -= (nw - w) / 2
      w = nw
    }
    setVb([x, y, w, h])
  })

  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const r = svgRef!.getBoundingClientRect()
    const [x, y, w, h] = vb()
    return [x + ((clientX - r.left) / r.width) * w, y + ((clientY - r.top) / r.height) * h]
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const [x, y, w, h] = vb()
    const f = e.deltaY > 0 ? 1.12 : 1 / 1.12
    let nw = w * f
    nw = Math.max(180, Math.min(W * 1.6, nw))
    const nh = nw * (h / w)
    const nx = wx - ((wx - x) / w) * nw,
      ny = wy - ((wy - y) / h) * nh
    setVb([nx, ny, nw, nh])
  }
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    drag = { sx: e.clientX, sy: e.clientY, vb: vb(), moved: false }
  }
  const onMove = (e: MouseEvent) => {
    if (!drag) return
    const r = svgRef!.getBoundingClientRect()
    const [x, y, w, h] = drag.vb
    const dx = ((e.clientX - drag.sx) / r.width) * w,
      dy = ((e.clientY - drag.sy) / r.height) * h
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true
    setVb([x - dx, y - dy, w, h])
  }
  const onUp = (e: MouseEvent) => {
    const wasMove = drag && drag.moved
    drag = null
    if (wasMove) return
    if (props.onMeasureClick) {
      const [wx, wy] = toWorld(e.clientX, e.clientY)
      props.onMeasureClick([Math.round(wx), Math.round(wy)])
      return
    }
    if (props.onBg) props.onBg()
  }
  const zoomBtn = (f: number) => {
    const [x, y, w, h] = vb()
    const cx = x + w / 2,
      cy = y + h / 2
    const nw = Math.max(180, Math.min(W * 1.6, w * f))
    const nh = nw * (h / w)
    setVb([cx - nw / 2, cy - nh / 2, nw, nh])
  }

  const L = () => props.layers || {}
  const emp = () => props.emphasis || {}
  const dimAll = () => !!emp().dim
  const empSet = () => {
    const e = emp().pipes
    return e instanceof Set ? e : new Set(e || [])
  }
  const selId = () => (props.selected ? props.selected.id : null)
  const selType = () => (props.selected ? props.selected.type : null)
  const scalePx = () => vb()[2] / W

  const scaleM = () => {
    const metersAcross = Math.round(vb()[2] * 1.15)
    return metersAcross > 4000 ? 1000 : metersAcross > 1500 ? 500 : metersAcross > 700 ? 200 : 100
  }
  const scaleFrac = () => scaleM() / 1.15 / vb()[2]

  return (
    <div class="relative h-full w-full overflow-hidden" style={{ background: pal().bg }}>
      <svg
        ref={svgRef}
        viewBox={vb().join(' ')}
        class="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        style={{ cursor: drag ? 'grabbing' : 'grab', 'touch-action': 'none' }}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => (drag = null)}
      >
        <defs>
          <pattern id="gispar" width="46" height="46" patternUnits="userSpaceOnUse">
            <path d="M46 0H0V46" fill="none" stroke={pal().grid} stroke-width="1" />
          </pattern>
          <filter id="pinsh" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="rgba(0,0,0,0.35)" />
          </filter>
        </defs>
        <rect x={-200} y={-200} width={W + 400} height={H + 400} fill={pal().bg} />
        <rect x={-200} y={-200} width={W + 400} height={H + 400} fill="url(#gispar)" />

        {/* nước */}
        <path d={`${G.lake.reduce((s, p, i) => s + (i ? 'L' : 'M') + p[0] + ' ' + p[1] + ' ', '')}Z`} fill={pal().water} stroke={pal().waterLine} stroke-width="2" />
        <path d={G.river} fill="none" stroke={pal().water} stroke-width="46" stroke-linecap="round" />
        <path d={G.river} fill="none" stroke={pal().waterLine} stroke-width="48" stroke-linecap="round" opacity="0.4" style={{ 'mix-blend-mode': theme() === 'light' ? 'multiply' : 'screen' }} />

        {/* công viên */}
        <For each={G.parks}>{(p) => <path d={roundedPoly(p.poly, 18)} fill={pal().park} stroke={pal().parkLine} stroke-width="1.5" />}</For>

        {/* khối nhà */}
        <For each={G.blocks}>
          {(b) => <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="2.5" fill={b.t > 0.6 ? pal().block2 : pal().block} stroke={pal().blockLine} stroke-width="1" />}
        </For>

        {/* đường phụ */}
        <For each={minor()}>{(s) => <line x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]} stroke={pal().roadMinor} stroke-width="5" stroke-linecap="round" />}</For>
        {/* casing đường (theo tuyến ống) */}
        <For each={G.pipes.filter((p) => p.status !== 'abandoned')}>
          {(p) => <line x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={pal().road} stroke-width={p.trunk ? 12 : 7} stroke-linecap="round" />}
        </For>

        {/* DMA */}
        <Show when={L().dma}>
          <For each={G.dmas}>
            {(d) => {
              const sel = () => selType() === 'dma' && selId() === d.id
              return (
                <path
                  d={roundedPoly(d.poly, 22, 0.97)}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onSelect?.({ type: 'dma', id: d.id })
                  }}
                  fill={chex(d.col, theme() === 'light' ? 0.07 : 0.1)}
                  stroke={tone(d.col)}
                  stroke-width={sel() ? 2.6 : 1.4}
                  stroke-dasharray="7 5"
                  class="cursor-pointer"
                  style={{ opacity: dimAll() ? 0.4 : 1 }}
                />
              )
            }}
          </For>
        </Show>

        {/* tuyến ống */}
        <Show when={L().pipe}>
          <For each={G.pipes}>
            {(p) => {
              const col = () => pipeColor(p, theme(), props.paint, G)
              const emphasized = () => empSet().has(p.id)
              const dimmed = () => dimAll() && !emphasized()
              const sel = () => selType() === 'pipe' && selId() === p.id
              const wBase = p.dn >= 500 ? 6 : p.dn >= 300 ? 4.6 : p.dn >= 200 ? 3 : 2.2
              const dash = p.status === 'planned' ? '8 5' : p.status === 'abandoned' ? '3 6' : undefined
              return (
                <g style={{ opacity: dimmed() ? 0.16 : 1 }}>
                  <Show when={sel() || emphasized()}>
                    <line x1={p.pts[0][0]} y1={p.pts[0][1]} x2={p.pts[1][0]} y2={p.pts[1][1]} stroke={cAccent()} stroke-width={wBase + 5} stroke-linecap="round" opacity="0.34" />
                  </Show>
                  <line
                    x1={p.pts[0][0]}
                    y1={p.pts[0][1]}
                    x2={p.pts[1][0]}
                    y2={p.pts[1][1]}
                    stroke={col()}
                    stroke-width={wBase}
                    stroke-linecap="round"
                    stroke-dasharray={dash}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSelect?.({ type: 'pipe', id: p.id })
                    }}
                    class="cursor-pointer"
                  />
                  <Show when={p.status === 'leak'}>
                    <circle cx={(p.pts[0][0] + p.pts[1][0]) / 2} cy={(p.pts[0][1] + p.pts[1][1]) / 2} r="6" fill="none" stroke={lighten('#D1242F')} stroke-width="1.5" class="gis-pulse" />
                  </Show>
                </g>
              )
            }}
          </For>
        </Show>

        {/* nhãn ống */}
        <Show when={L().label && scalePx() < 0.55}>
          <For each={G.pipes.filter((p) => p.trunk)}>
            {(p) => {
              const m = midOf(p)
              const ang = (Math.atan2(p.pts[1][1] - p.pts[0][1], p.pts[1][0] - p.pts[0][0]) * 180) / Math.PI
              const a = Math.abs(ang) > 90 ? ang + 180 : ang
              return (
                <text x={m[0]} y={m[1] - 5} font-size="8.5" text-anchor="middle" fill={theme() === 'light' ? '#0E7C86' : '#7fd0db'} transform={`rotate(${a} ${m[0]} ${m[1] - 5})`} class="font-mono pointer-events-none">
                  DN{p.dn}
                </text>
              )
            }}
          </For>
        </Show>

        {/* đấu nối khách hàng */}
        <Show when={L().conn && scalePx() < 0.85}>
          <For each={G.connDots}>
            {(c) => <circle cx={c.x} cy={c.y} r={scalePx() < 0.4 ? 2.4 : 1.7} fill={theme() === 'light' ? '#9A6700' : '#E3B341'} opacity={dimAll() ? 0.25 : 0.62} />}
          </For>
        </Show>

        {/* nút */}
        <Show when={L().node && scalePx() < 0.6}>
          <For each={G.nodes}>
            {(n) => {
              const sel = () => selType() === 'node' && selId() === n.id
              return (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={sel() ? 4.5 : 2.6}
                  fill={theme() === 'light' ? '#fff' : '#0D1117'}
                  stroke={sel() ? cAccent() : tone('#8250DF')}
                  stroke-width={sel() ? 2 : 1.4}
                  class="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onSelect?.({ type: 'node', id: n.id })
                  }}
                />
              )
            }}
          </For>
        </Show>

        {/* van */}
        <Show when={L().valve}>
          <For each={G.valves}>
            {(v) => {
              const closed = () => (emp().valvesClosed && emp().valvesClosed!.has(v.id)) || (!emp().valvesClosed && v.state === 'closed')
              const opened = () => emp().valvesOpen && emp().valvesOpen!.has(v.id)
              const sel = () => selType() === 'valve' && selId() === v.id
              const col = () => (closed() ? tone('#D1242F') : v.kind === 'boundary' ? tone('#0969DA') : tone('#0E7C86'))
              const sz = () => (sel() ? 6 : v.kind === 'boundary' ? 4.6 : 3.8)
              const dimmed = () => dimAll() && !sel() && !closed() && !opened()
              return (
                <g
                  style={{ opacity: dimmed() ? 0.2 : 1 }}
                  class="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onSelect?.({ type: 'valve', id: v.id })
                  }}
                >
                  <Show when={sel() || opened()}>
                    <circle cx={v.x} cy={v.y} r={sz() + 4} fill="none" stroke={cAccent()} stroke-width="2" opacity="0.6" />
                  </Show>
                  <rect x={v.x - sz()} y={v.y - sz()} width={sz() * 2} height={sz() * 2} rx="1" transform={`rotate(45 ${v.x} ${v.y})`} fill={theme() === 'light' ? '#fff' : '#0D1117'} stroke={col()} stroke-width="1.6" />
                  <Show when={closed()}>
                    <rect x={v.x - sz() + 1.4} y={v.y - sz() + 1.4} width={(sz() - 1.4) * 2} height={(sz() - 1.4) * 2} transform={`rotate(45 ${v.x} ${v.y})`} fill={col()} />
                  </Show>
                </g>
              )
            }}
          </For>
        </Show>

        {/* trụ cứu hoả */}
        <Show when={L().hydrant}>
          <For each={G.hydrants}>
            {(h) => {
              const sel = () => selType() === 'hydrant' && selId() === h.id
              const col = () => (h.status === 'fault' ? tone('#D86C1F') : tone('#D1242F'))
              return (
                <g
                  class="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onSelect?.({ type: 'hydrant', id: h.id })
                  }}
                  style={{ opacity: dimAll() && !sel() ? 0.3 : 1 }}
                >
                  <Show when={sel()}>
                    <circle cx={h.x} cy={h.y} r="8" fill="none" stroke={cAccent()} stroke-width="2" />
                  </Show>
                  <circle cx={h.x} cy={h.y} r="3.4" fill={col()} stroke="#fff" stroke-width="1.1" />
                </g>
              )
            }}
          </For>
        </Show>

        {/* nguồn */}
        <Show when={L().source}>
          <g>
            <g transform={`translate(${G.plant.x},${G.plant.y})`}>
              <rect x="-11" y="-11" width="22" height="22" rx="3" fill={theme() === 'light' ? '#fff' : '#10243a'} stroke={tone('#0E7C86')} stroke-width="2" />
              <path d="M0 -5 C3 -1 5 1 5 3 a5 5 0 0 1 -10 0 c0 -2 2 -4 5 -8z" fill={tone('#0E7C86')} transform="translate(0,1)" />
            </g>
            <For each={G.reservoirs}>
              {(r) => {
                const sel = () => selType() === 'reservoir' && selId() === r.id
                return (
                  <g
                    transform={`translate(${r.x},${r.y})`}
                    class="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSelect?.({ type: 'reservoir', id: r.id })
                    }}
                  >
                    <Show when={sel()}>
                      <rect x="-14" y="-13" width="28" height="26" rx="4" fill="none" stroke={cAccent()} stroke-width="2" />
                    </Show>
                    <rect x="-10" y="-9" width="20" height="18" rx="2.5" fill={theme() === 'light' ? '#fff' : '#131a24'} stroke={tone('#1A7F37')} stroke-width="1.8" />
                    <rect x="-8" y={7 - 14 * (r.level / 100)} width="16" height={14 * (r.level / 100)} rx="1" fill={tone('#1A7F37')} opacity="0.5" />
                  </g>
                )
              }}
            </For>
            <For each={G.pumps}>
              {(s) => {
                const sel = () => selType() === 'pump' && selId() === s.id
                return (
                  <g
                    transform={`translate(${s.x},${s.y})`}
                    class="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSelect?.({ type: 'pump', id: s.id })
                    }}
                  >
                    <Show when={sel()}>
                      <circle r="13" fill="none" stroke={cAccent()} stroke-width="2" />
                    </Show>
                    <circle r="9" fill={theme() === 'light' ? '#fff' : '#10243a'} stroke={tone('#D86C1F')} stroke-width="1.8" />
                    <text y="3.4" text-anchor="middle" font-size="10" font-weight="700" fill={tone('#D86C1F')} class="font-mono pointer-events-none">
                      P
                    </text>
                  </g>
                )
              }}
            </For>
          </g>
        </Show>

        {/* pins overlay */}
        <For each={props.pins || []}>
          {(pin) => (
            <g
              transform={`translate(${pin.x},${pin.y})`}
              class={pin.onClick ? 'cursor-pointer' : ''}
              onClick={(e) => {
                if (pin.onClick) {
                  e.stopPropagation()
                  pin.onClick()
                }
              }}
            >
              <Show when={pin.pulse}>
                <circle r="12" fill="none" stroke={pin.col} stroke-width="1.6" class="gis-pulse" />
              </Show>
              <Show
                when={pin.shape === 'diamond'}
                fallback={
                  <g filter="url(#pinsh)">
                    <path d="M0 -11 C5 -11 8 -7 8 -3 C8 2 0 9 0 9 C0 9 -8 2 -8 -3 C-8 -7 -5 -11 0 -11z" fill={pin.col} stroke="#fff" stroke-width="1.3" />
                    <circle cy="-3" r="2.6" fill="#fff" />
                  </g>
                }
              >
                <rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" fill={pin.col} stroke="#fff" stroke-width="1.4" filter="url(#pinsh)" />
              </Show>
              <Show when={pin.sel}>
                <circle r="16" fill="none" stroke={cAccent()} stroke-width="2" />
              </Show>
            </g>
          )}
        </For>

        {/* overlay đo khoảng cách */}
        <Show when={props.measure && props.measure.length}>
          {(() => {
            const pxw = () => vb()[2] / (svgRef ? svgRef.clientWidth : 1000)
            const ac = cAccent()
            const m = () => props.measure!
            return (
              <g class="pointer-events-none">
                <Show when={m().length > 1}>
                  <polyline points={m().map((p) => p[0] + ',' + p[1]).join(' ')} fill="none" stroke={ac} stroke-width={2.2 * pxw()} stroke-dasharray={`${6 * pxw()} ${4 * pxw()}`} stroke-linejoin="round" stroke-linecap="round" />
                </Show>
                <For each={m()}>
                  {(p, i) => {
                    const seg = () => {
                      if (i() === 0) return null
                      const a = m()[i() - 1]!
                      const d = Math.hypot(p[0] - a[0], p[1] - a[1]) * 1.15
                      const mx = (p[0] + a[0]) / 2,
                        my = (p[1] + a[1]) / 2
                      return (
                        <text x={mx} y={my - 5 * pxw()} font-size={String(10 * pxw())} text-anchor="middle" fill={ac} class="font-mono" style={{ 'paint-order': 'stroke' }} stroke={theme() === 'light' ? '#fff' : '#0D1117'} stroke-width={3.5 * pxw()}>
                          {fmtKm(d)}
                        </text>
                      )
                    }
                    return (
                      <g>
                        {seg()}
                        <circle cx={p[0]} cy={p[1]} r={3.6 * pxw()} fill={theme() === 'light' ? '#fff' : '#0D1117'} stroke={ac} stroke-width={1.9 * pxw()} />
                      </g>
                    )
                  }}
                </For>
              </g>
            )
          })()}
        </Show>
      </svg>

      {/* zoom controls */}
      <Show when={props.controls !== false}>
        <div class="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-lg border border-line bg-[var(--surface)]" style={{ 'box-shadow': 'var(--card-shadow)' }}>
          <button onClick={() => zoomBtn(1 / 1.4)} title="Phóng to" class="flex h-8 w-8 items-center justify-center text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
            <IcPlus size={16} />
          </button>
          <button onClick={() => zoomBtn(1.4)} title="Thu nhỏ" class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
            <IcMinus size={16} />
          </button>
          <button onClick={() => setVb(fullVB)} title="Toàn mạng" class="flex h-8 w-8 items-center justify-center border-t border-line text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
            <IcExpand size={15} />
          </button>
        </div>
      </Show>

      {/* thước tỉ lệ */}
      <Show when={props.controls !== false}>
        <div class="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-0.5">
          <div class="h-1.5 rounded-sm" style={{ width: `${Math.max(28, Math.min(160, scaleFrac() * (svgRef ? svgRef.clientWidth : 600)))}px`, background: theme() === 'light' ? '#1B2733' : '#c6cfd9' }} />
          <span class="font-mono text-[10px]" style={{ color: theme() === 'light' ? '#566270' : '#8B949E' }}>
            {scaleM() >= 1000 ? scaleM() / 1000 + ' km' : scaleM() + ' m'}
          </span>
        </div>
      </Show>

      {/* legend */}
      <Show when={props.legend !== false}>
        <div class="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-line bg-[var(--surface)]/90 px-3 py-1.5 text-[10.5px] text-[color:var(--muted)] backdrop-blur" style={{ 'max-width': '440px' }}>
          <Show
            when={props.legendRows && props.legendRows.length}
            fallback={
              <>
                <span class="flex items-center gap-1.5"><span class="inline-block h-[3px] w-5 rounded" style={{ background: tone('#0E7C86') }} />Ống chính</span>
                <span class="flex items-center gap-1.5"><span class="inline-block h-[3px] w-5 rounded" style={{ background: theme() === 'light' ? '#3FA0A8' : '#7fd0db' }} />Ống phân phối</span>
                <span class="flex items-center gap-1.5"><span class="inline-block h-2.5 w-2.5 rotate-45 border" style={{ 'border-color': tone('#0969DA') }} />Van</span>
                <span class="flex items-center gap-1.5"><StatusDot color={tone('#D1242F')} size={8} />Rò rỉ / cảnh báo</span>
                <span class="flex items-center gap-1.5"><span class="inline-block h-2.5 w-3.5 rounded-sm border border-dashed" style={{ 'border-color': tone('#9A6700') }} />Ranh DMA</span>
              </>
            }
          >
            <For each={props.legendRows!}>
              {(r) => (
                <span class="flex items-center gap-1.5">
                  <span class="inline-block h-[3px] w-5 rounded" style={{ background: tone(r.col) }} />
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
