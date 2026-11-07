/* A day chart in plain SVG: lines, a shaded band, reference lines, shaded windows, flags on the time
   axis and the shared time cursor. Click or drag to move the cursor; hover to read values. */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'

export interface ChartLine {
  label: string
  values: readonly (number | null | undefined)[]
  color: string
  width?: number
  dash?: string
  faint?: boolean
  /** Draw as bars instead of a line. */
  bars?: boolean
}
export interface ChartBand {
  label: string
  lo: readonly number[]
  hi: readonly number[]
  mid?: readonly number[]
  color: string
}
export interface ChartRef {
  label: string
  value: number
  color: string
}
export interface ChartWindow {
  from: number
  to: number
  color: string
  label?: string
}
export interface ChartFlag {
  at: number
  color: string
  label: string
  onClick?: () => void
}

export function TimeChart(props: {
  /** Number of points on the x axis (96 slots or 24 hours). */
  n: number
  /** Points per hour (4 for 15-minute slots, 1 for hourly). */
  perHour: number
  lines: ChartLine[]
  band?: ChartBand
  refs?: ChartRef[]
  windows?: ChartWindow[]
  flags?: ChartFlag[]
  /** Cursor position in points (fractional allowed). */
  cursor?: number
  onCursor?: (at: number) => void
  unit: string
  height?: number
  /** Fix the y range; default fits the data with 8 % padding. */
  yMin?: number
  yMax?: number
  format?: (v: number) => string
  ariaLabel: string
}): JSX.Element {
  const W = 640
  const H = () => props.height ?? 220
  const pad = { l: 42, r: 10, t: 20, b: 24 }
  const fmt = (v: number) => (props.format ? props.format(v) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))
  const range = createMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    const take = (v: number | null | undefined) => {
      if (v === null || v === undefined || !Number.isFinite(v)) return
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    for (const l of props.lines) l.values.forEach(take)
    props.band?.lo.forEach(take)
    props.band?.hi.forEach(take)
    for (const r of props.refs ?? []) take(r.value)
    if (props.lines.some(l => l.bars)) lo = Math.min(lo, 0)
    if (!Number.isFinite(lo)) return [0, 1] as const
    const span = hi - lo || Math.abs(hi) || 1
    return [props.yMin ?? lo - span * 0.08, props.yMax ?? hi + span * 0.08] as const
  })
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(props.n - (props.lines.some(l => l.bars) ? 0 : 1), 1)
  const y = (v: number) => {
    const [lo, hi] = range()
    return pad.t + (H() - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1))
  }
  const path = (vals: readonly (number | null | undefined)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null || v === undefined || !Number.isFinite(v)) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const bandPath = createMemo(() => {
    const b = props.band
    if (!b) return ''
    const top = b.hi.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
    const bottom = [...b.lo].map((v, i) => [i, v] as const).reverse().map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
    return `${top}${bottom}Z`
  })
  const yTicks = createMemo(() => {
    const [lo, hi] = range()
    const step = niceStep((hi - lo) / 4)
    const out: number[] = []
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6))
    return out
  })
  const hours = createMemo(() => Array.from({ length: 9 }, (_, i) => i * 3))
  const [hover, setHover] = createSignal<number | null>(null)
  let svg: SVGSVGElement | undefined
  const atPointer = (e: PointerEvent) => {
    const r = svg!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const i = ((px - pad.l) / (W - pad.l - pad.r)) * Math.max(props.n - 1, 1)
    return Math.max(0, Math.min(props.n - 1, Math.round(i)))
  }
  const [drag, setDrag] = createSignal(false)
  const barW = () => ((W - pad.l - pad.r) / props.n) * 0.7

  return (
    <div class="relative select-none">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H()}`}
        class="block w-full"
        role="img"
        aria-label={props.ariaLabel}
        style={{ cursor: props.onCursor ? 'crosshair' : 'default', 'touch-action': 'none' }}
        onPointerDown={e => {
          if (!props.onCursor) return
          setDrag(true)
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          props.onCursor(atPointer(e))
        }}
        onPointerMove={e => {
          const i = atPointer(e)
          setHover(i)
          if (drag()) props.onCursor?.(i)
        }}
        onPointerUp={() => setDrag(false)}
        onPointerLeave={() => setHover(null)}
      >
        {/* grid */}
        <For each={yTicks()}>
          {v => (
            <>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" stroke-width="1" />
              <text x={pad.l - 6} y={y(v) + 3.5} text-anchor="end" font-size="10" fill="var(--muted)">
                {fmt(v)}
              </text>
            </>
          )}
        </For>
        <For each={hours()}>
          {h => (
            <text x={x(Math.min(h * props.perHour, props.n - 1))} y={H() - 7} text-anchor="middle" font-size="10" fill="var(--muted)">
              {String(h).padStart(2, '0')}h
            </text>
          )}
        </For>
        <text x={4} y={10} font-size="10" fill="var(--muted)">
          {props.unit}
        </text>
        {/* windows (event / evidence) */}
        <For each={props.windows ?? []}>
          {w => (
            <rect
              x={x(w.from)}
              y={pad.t}
              width={Math.max(2, x(w.to) - x(w.from))}
              height={H() - pad.t - pad.b}
              fill={w.color}
              opacity="0.12"
            >
              <title>{w.label}</title>
            </rect>
          )}
        </For>
        {/* band */}
        <Show when={props.band}>
          {b => (
            <>
              <path d={bandPath()} fill={b().color} opacity="0.16" />
              <Show when={b().mid}>
                {m => <path d={path(m())} fill="none" stroke={b().color} stroke-width="1" opacity="0.7" />}
              </Show>
            </>
          )}
        </Show>
        {/* reference lines (limits) */}
        <For each={props.refs ?? []}>
          {r => (
            <>
              <line x1={pad.l} x2={W - pad.r} y1={y(r.value)} y2={y(r.value)} stroke={r.color} stroke-width="1.2" stroke-dasharray="5 4" />
              <text x={W - pad.r - 2} y={y(r.value) - 3} text-anchor="end" font-size="9.5" fill={r.color}>
                {r.label}
              </text>
            </>
          )}
        </For>
        {/* series */}
        <For each={props.lines}>
          {l =>
            l.bars ? (
              <For each={[...l.values]}>
                {(v, i) => (
                  <Show when={v !== null && v !== undefined}>
                    <rect
                      x={x(i()) + ((W - pad.l - pad.r) / props.n - barW()) / 2}
                      y={Math.min(y(v!), y(Math.max(range()[0], 0)))}
                      width={barW()}
                      height={Math.abs(y(Math.max(range()[0], 0)) - y(v!))}
                      fill={l.color}
                      opacity={l.faint ? 0.35 : 0.85}
                    />
                  </Show>
                )}
              </For>
            ) : (
              <path
                d={path(l.values)}
                fill="none"
                stroke={l.color}
                stroke-width={l.width ?? 2}
                stroke-dasharray={l.dash}
                opacity={l.faint ? 0.4 : 1}
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            )
          }
        </For>
        {/* flags on the time axis */}
        <For each={props.flags ?? []}>
          {f => (
            <g style={{ cursor: f.onClick ? 'pointer' : 'default' }} onClick={() => f.onClick?.()}>
              <line x1={x(f.at)} x2={x(f.at)} y1={pad.t} y2={H() - pad.b} stroke={f.color} stroke-width="1.2" />
              <path d={`M${x(f.at)},${pad.t} l9,4 l-9,4 z`} fill={f.color} />
              <title>{f.label}</title>
            </g>
          )}
        </For>
        {/* cursor */}
        <Show when={props.cursor !== undefined}>
          <line x1={x(props.cursor!)} x2={x(props.cursor!)} y1={pad.t - 4} y2={H() - pad.b} stroke="var(--text)" stroke-width="1.4" opacity="0.75" />
        </Show>
        <Show when={hover() !== null}>
          <line x1={x(hover()!)} x2={x(hover()!)} y1={pad.t} y2={H() - pad.b} stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3" />
        </Show>
      </svg>
      <Show when={hover() !== null}>
        <div
          class="pointer-events-none absolute top-1 rounded-md border border-line bg-[var(--surface)] px-2 py-1 text-[11px] shadow-sm"
          style={{ left: hover()! / props.n > 0.6 ? '8px' : 'auto', right: hover()! / props.n > 0.6 ? 'auto' : '8px' }}
        >
          <div class="font-mono text-[color:var(--muted)]">{label(hover()!, props.perHour)}</div>
          <For each={props.lines.filter(l => !l.faint || props.lines.length <= 3)}>
            {l => {
              const v = l.values[hover()!]
              return (
                <div class="flex items-center gap-1.5">
                  <span class="inline-block h-0.5 w-3" style={{ background: l.color }} />
                  <span class="text-[color:var(--muted)]">{l.label}</span>
                  <span class="ml-auto pl-2 font-mono">{v === null || v === undefined ? '—' : `${fmt(v)} ${props.unit}`}</span>
                </div>
              )
            }}
          </For>
          <Show when={props.band}>
            {b => (
              <div class="flex items-center gap-1.5">
                <span class="inline-block h-2 w-3 opacity-40" style={{ background: b().color }} />
                <span class="text-[color:var(--muted)]">{b().label}</span>
                <span class="ml-auto pl-2 font-mono">
                  {fmt(b().lo[hover()!] ?? NaN)}–{fmt(b().hi[hover()!] ?? NaN)}
                </span>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}
const label = (i: number, perHour: number) => {
  const m = Math.round((i / perHour) * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Tiny inline sparkline (no axes). */
export function Sparkline(props: { values: readonly number[]; color: string; width?: number; height?: number; band?: readonly number[] }) {
  const w = () => props.width ?? 120
  const h = () => props.height ?? 26
  const d = createMemo(() => {
    const vals = props.values
    const lo = Math.min(...vals, ...(props.band ?? []))
    const hi = Math.max(...vals, ...(props.band ?? []))
    const sx = (i: number) => (w() * i) / Math.max(vals.length - 1, 1)
    const sy = (v: number) => h() - 2 - ((h() - 4) * (v - lo)) / (hi - lo || 1)
    return {
      line: vals.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(''),
      base: props.band ? props.band.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('') : '',
    }
  })
  return (
    <svg width={w()} height={h()} viewBox={`0 0 ${w()} ${h()}`} aria-hidden="true">
      <Show when={d().base}>
        <path d={d().base} fill="none" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 2" />
      </Show>
      <path d={d().line} fill="none" stroke={props.color} stroke-width="1.6" />
    </svg>
  )
}
