/**
 * Overlay shell of the twin: everything that floats over the full-screen 3D view.
 *
 * Every panel folds down to an icon: rail flyouts close to their rail button, each live chart card folds to a
 * chip, the whole chart column folds to one button, hints hide behind the rail's "Hướng dẫn". What a viewer folded
 * is remembered in this browser (localStorage, best effort: a blocked storage just means defaults next time).
 */
import { Bell, ChartLine, ChevronDown, Minus, Moon, Pause, Play, Sun, X } from 'lucide-solid'
import { createEffect, createSignal, For, onCleanup, Show, type Accessor, type JSX, type Setter } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { f0, f1, f2, useSim } from './sim-context'
import { EQUIPMENT_BY_TAG } from '../data/plant-model'
import { fmtClock } from '../sim/plant-sim'

export type Icon = (p: { size?: number | string; 'stroke-width'?: number | string }) => JSX.Element

/** A signal kept in localStorage under `tw.<key>`. */
export function persisted<T>(key: string, init: T): [Accessor<T>, Setter<T>] {
  let start = init
  try {
    const raw = localStorage.getItem(`tw.${key}`)
    if (raw !== null) start = JSON.parse(raw) as T
  } catch {
    /* storage blocked or bad JSON: use the default */
  }
  const [get, set] = createSignal<T>(start)
  createEffect(() => {
    const v = get()
    try {
      localStorage.setItem(`tw.${key}`, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  })
  return [get, set]
}

/** phone-width layout (bottom tab bar, sheets); read once when a screen mounts */
export const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches

/** Escape closes the topmost thing that registered last. */
export function onEscape(fn: () => void) {
  const h = (e: KeyboardEvent) => {
    if (e.key === 'Escape') fn()
  }
  window.addEventListener('keydown', h)
  onCleanup(() => window.removeEventListener('keydown', h))
}

// ───────────── top bar ─────────────
export interface Crumb {
  label: string
  icon?: Icon
  onClick?: () => void
  title?: string
}
export function TopBar(props: { crumbs: Crumb[]; children?: JSX.Element }) {
  return (
    <header class="tw-top tw-glass">
      <a class="tw-logo" href="/gis" title="Về ứng dụng GIS" aria-label="Về ứng dụng GIS">
        <img src="/system-logo.png" alt="" />
      </a>
      <nav class="tw-crumbs" aria-label="Vị trí hiện tại">
        <For each={props.crumbs}>
          {(c, i) => (
            <>
              <Show when={i() > 0}>
                <span class="sep" aria-hidden="true">
                  /
                </span>
              </Show>
              <Show
                when={c.onClick}
                fallback={
                  <h1 class="tw-crumb" classList={{ last: i() === props.crumbs.length - 1 }}>
                    {c.label}
                  </h1>
                }
              >
                <button type="button" class="tw-crumb link" onClick={() => c.onClick?.()} title={c.title}>
                  <Show when={c.icon}>{ic => <Dynamic component={ic()} size={15} />}</Show>
                  <span>{c.label}</span>
                </button>
              </Show>
            </>
          )}
        </For>
      </nav>
      <div class="tw-spacer" />
      {props.children}
    </header>
  )
}

/** light / dark switch; stays in sync when the other screen flips it, and tells the 3D scenes (`tw-theme`) */
export function ThemeButton() {
  const read = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  const [t, setT] = createSignal<'light' | 'dark'>(read())
  const mo = new MutationObserver(() => setT(read()))
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  onCleanup(() => mo.disconnect())
  const label = () => (t() === 'light' ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng')
  return (
    <button
      type="button"
      class="tw-btn icon ghost"
      onClick={() => {
        document.documentElement.setAttribute('data-theme', t() === 'light' ? 'dark' : 'light')
        window.dispatchEvent(new CustomEvent('tw-theme'))
      }}
      aria-label={label()}
      title={label()}
    >
      {t() === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  )
}

// ───────────── simulation clock + scenarios ─────────────
export interface Scenario {
  label: string
  hint: string
  run: () => void
}
export function SimControl(props: { scenarios: Scenario[] }) {
  const { sim, v } = useSim()
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement
  const onDoc = (e: PointerEvent) => {
    if (open() && !root.contains(e.target as Node)) setOpen(false)
  }
  document.addEventListener('pointerdown', onDoc)
  onCleanup(() => document.removeEventListener('pointerdown', onDoc))
  onEscape(() => setOpen(false))
  const paused = () => (v(), sim.paused)
  return (
    <div class="tw-sim" ref={root}>
      <button
        type="button"
        class="tw-sim-play"
        aria-label={paused() ? 'Chạy tiếp mô phỏng' : 'Tạm dừng mô phỏng'}
        title={paused() ? 'Chạy tiếp mô phỏng' : 'Tạm dừng mô phỏng'}
        onClick={() => {
          sim.paused = !sim.paused
          sim.advance(0)
        }}
      >
        {paused() ? <Play size={15} /> : <Pause size={15} />}
      </button>
      <button type="button" class="tw-sim-clock" aria-expanded={open()} aria-haspopup="dialog" onClick={() => setOpen(x => !x)} title="Tốc độ và tình huống mô phỏng">
        <span class="tw-live" classList={{ on: !paused() }} aria-hidden="true" />
        <span class="t">{(v(), sim.clock)}</span>
        <span class="x">×{(v(), sim.speed)}</span>
        <ChevronDown size={14} />
      </button>
      <Show when={open()}>
        <div class="tw-pop tw-glass" role="dialog" aria-label="Điều khiển mô phỏng">
          <div class="tw-pop-h">Tốc độ mô phỏng</div>
          <div class="tw-seg wide" role="group" aria-label="Tốc độ mô phỏng">
            <For each={[1, 10, 60, 300]}>
              {s => (
                <button
                  type="button"
                  aria-pressed={(v(), sim.speed === s)}
                  onClick={() => {
                    sim.speed = s
                    sim.advance(0)
                  }}
                >
                  ×{s}
                </button>
              )}
            </For>
          </div>
          <Show when={props.scenarios.length}>
            <div class="tw-pop-h">Tình huống</div>
            <For each={props.scenarios}>
              {s => (
                <button
                  type="button"
                  class="tw-scn"
                  onClick={() => {
                    s.run()
                    setOpen(false)
                  }}
                >
                  <b>{s.label}</b>
                  <span>{s.hint}</span>
                </button>
              )}
            </For>
          </Show>
          <p class="tw-pop-note">Số liệu mô phỏng.</p>
        </div>
      </Show>
    </div>
  )
}

export function AlarmBell(props: { onClick: () => void; pressed?: boolean }) {
  const { sim, v } = useSim()
  const n = () => (v(), sim.activeAlarms.length)
  const crit = () => (v(), sim.activeAlarms.some(a => a.level === 'crit'))
  const unacked = () => (v(), sim.unacked)
  const label = () => (n() ? `${n()} báo động đang hoạt động${unacked() ? `, ${unacked()} chưa xác nhận` : ''}` : 'Báo động: không có')
  return (
    <button type="button" class="tw-bell" classList={{ crit: crit(), warn: !crit() && n() > 0, ring: unacked() > 0 }} aria-pressed={!!props.pressed} aria-label={label()} title={label()} onClick={() => props.onClick()}>
      <Bell size={17} />
      <Show when={n()}>
        <span class="tw-badge">{n()}</span>
      </Show>
    </button>
  )
}

// ───────────── icon rail + flyouts ─────────────
export interface RailItem {
  id: string
  label: string
  icon: Icon
  badge?: () => number | string | null | undefined
  /** a toggle instead of a flyout */
  pressed?: () => boolean
  onClick?: () => void
}
export function Rail(props: { items: RailItem[]; foot?: RailItem[]; active: string | null; onSelect: (id: string | null) => void }) {
  const Btn = (p: { it: RailItem }) => (
    <button
      type="button"
      class="tw-rk"
      classList={{ toggle: !!p.it.pressed }}
      aria-pressed={p.it.pressed ? p.it.pressed() : props.active === p.it.id}
      onClick={() => (p.it.onClick ? p.it.onClick() : props.onSelect(props.active === p.it.id ? null : p.it.id))}
      title={p.it.label}
    >
      <Dynamic component={p.it.icon} size={19} stroke-width={1.8} />
      <span class="l">{p.it.label}</span>
      <Show when={p.it.badge?.()}>{b => <span class="tw-badge">{b()}</span>}</Show>
    </button>
  )
  return (
    <nav class="tw-rail tw-glass" aria-label="Bảng công cụ">
      <For each={props.items}>{it => <Btn it={it} />}</For>
      <Show when={props.foot?.length}>
        <span class="sep" aria-hidden="true" />
        <For each={props.foot}>{it => <Btn it={it} />}</For>
      </Show>
    </nav>
  )
}

export function Flyout(props: { title: string; sub?: JSX.Element; onClose: () => void; actions?: JSX.Element; children: JSX.Element }) {
  onEscape(() => props.onClose())
  return (
    <section class="tw-fly tw-glass" aria-label={props.title}>
      <header class="tw-fly-h">
        <div class="tw-fly-t">
          <h2>{props.title}</h2>
          <Show when={props.sub}>
            <p>{props.sub}</p>
          </Show>
        </div>
        {props.actions}
        <button type="button" class="tw-x" onClick={() => props.onClose()} aria-label={`Đóng ${props.title.toLowerCase()}`} title="Đóng (Esc)">
          <X size={16} />
        </button>
      </header>
      <div class="tw-fly-b">{props.children}</div>
    </section>
  )
}

/** right-hand drawer (inspector, faceplate); its content brings its own header and close button */
export function Drawer(props: { label: string; onClose: () => void; children: JSX.Element }) {
  onEscape(() => props.onClose())
  return (
    <aside class="tw-drawer tw-glass" aria-label={props.label}>
      {props.children}
    </aside>
  )
}

export function CloseBtn(props: { onClick: () => void; label?: string }) {
  return (
    <button type="button" class="tw-x" onClick={() => props.onClick()} aria-label={props.label ?? 'Đóng'} title="Đóng (Esc)">
      <X size={16} />
    </button>
  )
}

// ───────────── live charts ─────────────
export type Level = 'warn' | 'crit' | null
export interface ChartDef {
  id: string
  label: string
  unit: string
  digits: 0 | 1 | 2
  value: () => number
  data: () => number[]
  color: string
  /** normal operating band, drawn behind the line */
  band?: [number, number]
  min?: number
  max?: number
  level?: () => Level
  note?: () => string
  /** what the x axis covers */
  span?: string
  /** click on the card: fly to where it is measured */
  onFocus?: () => void
  focusLabel?: string
}
const fmt = (n: number, d: 0 | 1 | 2) => (d === 0 ? f0(n) : d === 1 ? f1(n) : f2(n))

export function LiveChart(props: { data: number[]; color: string; band?: [number, number]; min?: number; max?: number; id: string }) {
  const W = 240
  const H = 50
  const geo = () => {
    const d = props.data
    if (d.length < 2) return null
    let lo = props.min ?? Math.min(...d)
    let hi = props.max ?? Math.max(...d)
    if (props.band && props.min === undefined) lo = Math.min(lo, props.band[0])
    if (props.band && props.max === undefined) hi = Math.max(hi, props.band[1])
    const pad = (hi - lo || 1) * 0.08
    lo -= props.min === undefined ? pad : 0
    hi += props.max === undefined ? pad : 0
    const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6)
    const x = (i: number) => (i / (d.length - 1)) * W
    const line = d.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')
    const band = props.band ? { y: Math.max(0, y(props.band[1])), h: Math.max(0, Math.min(H, y(props.band[0])) - Math.max(0, y(props.band[1]))) } : null
    return { line, area: `${line}L${W} ${H}L0 ${H}Z`, band, end: { x: W, y: y(d[d.length - 1]!) } }
  }
  const gid = () => `tw-g-${props.id}`
  return (
    <svg class="tw-chart" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid()} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color={props.color} stop-opacity="0.28" />
          <stop offset="1" stop-color={props.color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <Show when={geo()} fallback={<text x={W / 2} y={H / 2 + 4} class="tw-chart-wait" text-anchor="middle">Đang thu thập số liệu…</text>}>
        {g => (
          <>
            <Show when={g().band}>{b => <rect x="0" y={b().y} width={W} height={b().h} class="tw-chart-band" />}</Show>
            <path d={g().area} fill={`url(#${gid()})`} />
            <path d={g().line} fill="none" stroke={props.color} stroke-width="1.7" stroke-linejoin="round" />
            <circle cx={g().end.x - 2.5} cy={g().end.y} r="3" fill={props.color} class="tw-chart-dot" />
          </>
        )}
      </Show>
    </svg>
  )
}

/**
 * Column of live chart cards floating over the 3D view (top right). A card folds to a chip, the column folds
 * to one button; `compact` (an inspector is open) shows chips only.
 */
export function ChartStack(props: { store: string; title: string; charts: ChartDef[]; compact?: boolean; defaultClosed?: string[] }) {
  const { v } = useSim()
  // eslint-disable-next-line solid/reactivity -- defaults are read once
  const [st, setSt] = persisted(`charts.${props.store}`, { min: isNarrow(), closed: props.defaultClosed ?? [] })
  const closed = (id: string) => st().closed.includes(id)
  const fold = (id: string) => setSt(s => ({ ...s, closed: [...s.closed.filter(x => x !== id), id] }))
  const unfold = (id: string) => setSt(s => ({ ...s, min: false, closed: s.closed.filter(x => x !== id) }))
  const levelOf = (c: ChartDef) => (v(), c.level?.() ?? null)
  const valueOf = (c: ChartDef) => (v(), fmt(c.value(), c.digits))
  const worst = () => (props.charts.some(c => levelOf(c) === 'crit') ? 'crit' : props.charts.some(c => levelOf(c) === 'warn') ? 'warn' : null)

  const Chip = (p: { c: ChartDef }) => (
    <button type="button" class={`tw-mchip ${levelOf(p.c) ?? ''}`} onClick={() => unfold(p.c.id)} title={`Mở biểu đồ ${p.c.label.toLowerCase()}`}>
      <span class="sw" style={{ background: p.c.color }} />
      <span class="l">{p.c.label}</span>
      <span class="v">
        {valueOf(p.c)}
        <small>{p.c.unit}</small>
      </span>
    </button>
  )

  return (
    <Show
      when={!st().min}
      fallback={
        <button type="button" class={`tw-stack-fab tw-glass ${worst() ?? ''}`} aria-expanded="false" onClick={() => setSt(s => ({ ...s, min: false }))} title="Mở biểu đồ theo dõi">
          <ChartLine size={18} />
          <span>Biểu đồ</span>
          <span class="n">{props.charts.length}</span>
        </button>
      }
    >
      <section class="tw-stack" classList={{ compact: !!props.compact }} aria-label={props.title}>
        <header class="tw-stack-h tw-glass">
          <span class="tw-live on" aria-hidden="true" />
          <h2>{props.title}</h2>
          <button type="button" class="tw-x" aria-expanded="true" onClick={() => setSt(s => ({ ...s, min: true }))} aria-label="Thu gọn biểu đồ thành biểu tượng" title="Thu gọn">
            <Minus size={16} />
          </button>
        </header>
        <Show
          when={!props.compact}
          fallback={
            <div class="tw-chips col">
              <For each={props.charts}>{c => <Chip c={c} />}</For>
            </div>
          }
        >
          <Show when={props.charts.some(c => closed(c.id))}>
            <div class="tw-chips">
              <For each={props.charts.filter(c => closed(c.id))}>{c => <Chip c={c} />}</For>
            </div>
          </Show>
          <div class="tw-cards">
            <For each={props.charts.filter(c => !closed(c.id))}>
              {c => (
                <article class={`tw-card tw-glass ${levelOf(c) ?? ''}`}>
                  <div class="tw-card-top">
                    <h3>{c.label}</h3>
                    <button type="button" class="tw-fold" onClick={() => fold(c.id)} aria-label={`Thu nhỏ biểu đồ ${c.label.toLowerCase()}`} title="Thu nhỏ thành nhãn">
                      <Minus size={14} />
                    </button>
                  </div>
                  <div class="tw-card-val">
                    <b>{valueOf(c)}</b>
                    <small>{c.unit}</small>
                    <Show when={c.note}>{n => <span class="note">{(v(), n()())}</span>}</Show>
                  </div>
                  <Show
                    when={c.onFocus}
                    fallback={<LiveChart id={c.id} data={(v(), c.data())} color={c.color} band={c.band} min={c.min} max={c.max} />}
                  >
                    <button type="button" class="tw-card-chart" onClick={() => c.onFocus?.()} title={c.focusLabel}>
                      <LiveChart id={c.id} data={(v(), c.data())} color={c.color} band={c.band} min={c.min} max={c.max} />
                    </button>
                  </Show>
                  <div class="tw-card-axis">
                    <span>{c.span ?? '−24 giờ'}</span>
                    <Show when={c.band}>{b => <span>Ngưỡng {fmt(b()[0], c.digits)}–{fmt(b()[1], c.digits)}</span>}</Show>
                    <span>bây giờ</span>
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  )
}

// ───────────── hints ─────────────
export function HintBar(props: { hints: Array<{ icon: Icon; text: string }>; onHide: () => void }) {
  return (
    <aside class="tw-hints tw-glass" aria-label="Gợi ý thao tác">
      <For each={props.hints}>
        {h => (
          <span class="tw-hint-i">
            <Dynamic component={h.icon} size={16} />
            {h.text}
          </span>
        )}
      </For>
      <button type="button" class="tw-x" onClick={() => props.onHide()} aria-label="Ẩn gợi ý" title="Ẩn gợi ý">
        <X size={15} />
      </button>
    </aside>
  )
}

// ───────────── alarms ─────────────
export function AlarmPanel(props: { onTag?: (tag: string) => void }) {
  const { sim, v } = useSim()
  const [tab, setTab] = createSignal<'active' | 'log'>('active')
  const active = () => (v(), sim.activeAlarms)
  return (
    <>
      <div class="tw-fly-tools">
        <div class="tw-seg" role="group" aria-label="Báo động hoặc nhật ký">
          <button type="button" aria-pressed={tab() === 'active'} onClick={() => setTab('active')}>
            Đang hoạt động ({active().length})
          </button>
          <button type="button" aria-pressed={tab() === 'log'} onClick={() => setTab('log')}>
            Nhật ký vận hành
          </button>
        </div>
        <Show when={tab() === 'active' && (v(), sim.unacked)}>
          <button type="button" class="tw-btn sm" onClick={() => sim.ackAll()}>
            Xác nhận tất cả
          </button>
        </Show>
      </div>
      <Show
        when={tab() === 'active'}
        fallback={
          <ul class="tw-alist">
            <For each={(v(), sim.log.slice(0, 40))}>
              {l => (
                <li>
                  <time>{fmtClock(l.t)}</time>
                  <span class={`lv ${l.who}`} title={l.who === 'op' ? 'Vận hành viên' : l.who === 'auto' ? 'Tự động' : 'Hệ thống'} />
                  <span class="msg">
                    <b>{l.tag}</b> {l.msg}
                  </span>
                </li>
              )}
            </For>
          </ul>
        }
      >
        <Show when={active().length} fallback={<p class="tw-empty">Không có báo động.</p>}>
          <ul class="tw-alist">
            <For each={active().slice(0, 30)}>
              {a => (
                <li classList={{ unacked: !a.acked }}>
                  <time>{fmtClock(a.t)}</time>
                  <span class={`lv ${a.level}`} title={a.level === 'crit' ? 'Nguy cấp' : 'Cảnh báo'} />
                  <span class="msg">
                    <Show when={props.onTag && EQUIPMENT_BY_TAG[a.tag]} fallback={<b>{a.tag}</b>}>
                      <button type="button" class="tw-taglink" onClick={() => props.onTag?.(a.tag)} title="Xem thiết bị">
                        {a.tag}
                      </button>
                    </Show>{' '}
                    {a.msg}
                  </span>
                  <Show when={a.acked}>
                    <span class="ack">Đã xác nhận</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </>
  )
}
