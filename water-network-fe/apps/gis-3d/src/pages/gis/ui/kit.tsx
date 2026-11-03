/* Bản đồ mạng lưới GIS — UI kit atoms (SolidJS port of ui.jsx).
   Visuals (class strings, inline styles, sizes) copied verbatim from the design;
   only React idioms swapped for Solid (class/For/Show, JSX thunks). Helpers come
   from ./lib/theme; dataset-aware atoms (CondPill/AssetTypeChip/DmaChip) read useGis(). */
import { For, Show, createEffect, onCleanup, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { useGis } from '../lib/gis-data'
import { Icon, iconByName, IcAlert, IcCheck, IcCheckCircle, IcChevD, IcInfo, IcX, type IconComponent } from '../lib/icons'
import { cAccent, chex, cTheme, rad, tone } from '../lib/theme'

/* ── Tile ── */
export function Tile(props: { icon: string; col: string; size?: number; r?: number; glyph?: number }) {
  const size = () => props.size ?? 36
  const C: IconComponent = iconByName(props.icon)
  return (
    <span
      class="flex shrink-0 items-center justify-center"
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        'border-radius': `${props.r != null ? props.r : rad() * 0.9}px`,
        background: cTheme() === 'light' ? props.col : chex(props.col, 0.16),
        color: cTheme() === 'light' ? '#fff' : tone(props.col),
      }}
    >
      <C size={props.glyph || Math.round(size() * 0.5)} />
    </span>
  )
}

/* ── Badge ── */
export function Badge(props: {
  children?: JSX.Element
  color?: string
  soft?: boolean
  mono?: boolean
  dot?: boolean
  class?: string
}) {
  const c = () => props.color || (cTheme() === 'light' ? '#566270' : '#8B949E')
  return (
    <span
      class={
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] text-[10.5px] font-medium ' +
        (props.mono ? 'font-mono ' : '') +
        (props.class || '')
      }
      style={{
        background: props.soft ? chex(c(), cTheme() === 'light' ? 0.1 : 0.18) : 'transparent',
        color: c(),
        border: props.soft ? 'none' : '1px solid var(--line)',
      }}
    >
      <Show when={props.dot}>
        <span class="h-1.5 w-1.5 rounded-full" style={{ background: c() }} />
      </Show>
      {props.children}
    </span>
  )
}

export function StatusDot(props: { color: string; size?: number }) {
  const s = () => props.size ?? 8
  return (
    <span
      class="inline-block shrink-0 rounded-full"
      style={{ width: `${s()}px`, height: `${s()}px`, background: props.color }}
    />
  )
}

/* ── GIS pills ── */
export function CondPill(props: { cond: string; sm?: boolean }) {
  const G = useGis()
  const c = () => G.COND[props.cond] || G.COND.good!
  const col = () => tone(c().col)
  return (
    <span
      class={
        'inline-flex items-center whitespace-nowrap rounded-full font-medium ' +
        (props.sm ? 'px-1.5 py-[1px] text-[10px]' : 'px-2 py-[3px] text-[10.5px]')
      }
      style={{ background: chex(col(), cTheme() === 'light' ? 0.12 : 0.2), color: col() }}
    >
      {c().label}
    </span>
  )
}

export function AssetTypeChip(props: { type: string; sm?: boolean }) {
  const G = useGis()
  const t = () => G.ASSET_TYPES[props.type]
  return (
    <Show when={t()}>
      {(tt) => {
        const col = tone(tt().col)
        return (
          <span
            class={
              'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium ' +
              (props.sm ? 'px-1.5 py-[1px] text-[10px]' : 'px-2 py-[3px] text-[10.5px]')
            }
            style={{ background: chex(col, cTheme() === 'light' ? 0.12 : 0.2), color: col }}
          >
            <Icon name={tt().icon} size={props.sm ? 10 : 12} />
            {tt().label}
          </span>
        )
      }}
    </Show>
  )
}

export function DmaChip(props: { dma: string; sm?: boolean }) {
  const G = useGis()
  const d = () => G.dmas.find((x) => x.id === props.dma)
  return (
    <Show when={d()}>
      {(dd) => {
        const col = tone(dd().col)
        return (
          <span
            class={
              'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium ' +
              (props.sm ? 'px-1.5 py-[1px] text-[10px]' : 'px-2 py-[3px] text-[10.5px]')
            }
            style={{ background: chex(col, cTheme() === 'light' ? 0.1 : 0.18), color: col }}
          >
            <span class="h-1.5 w-1.5 rounded-full" style={{ background: col }} />
            {dd().id}
          </span>
        )
      }}
    </Show>
  )
}

/* ── Switch ── */
export function Switch(props: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; accent?: string }) {
  const ac = () => props.accent || cAccent()
  const Wd = 38,
    Hh = 22,
    K = 16
  const offBg = () => (cTheme() === 'light' ? '#D6DCE3' : 'rgba(240,246,252,0.16)')
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!props.disabled) props.onChange(!props.on)
      }}
      class="relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
      style={{
        width: `${Wd}px`,
        height: `${Hh}px`,
        background: props.on ? ac() : offBg(),
        opacity: props.disabled ? 0.45 : 1,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        class="absolute rounded-full bg-white transition-transform duration-200"
        style={{
          width: `${K}px`,
          height: `${K}px`,
          left: '3px',
          transform: props.on ? `translateX(${Wd - K - 6}px)` : 'translateX(0)',
          'box-shadow': '0 1px 2px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  )
}

/* ── Btn ── */
export function Btn(props: {
  children?: JSX.Element
  onClick?: (e: MouseEvent) => void
  variant?: 'default' | 'primary' | 'ghost'
  icon?: string
  iconR?: string
  danger?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  full?: boolean
  size?: 'sm' | 'md'
  title?: string
  class?: string
}) {
  const size = () => props.size ?? 'md'
  const h = () => (size() === 'sm' ? 'h-8 text-[12px] px-2.5 gap-1' : 'h-9 text-[12.5px] px-3.5 gap-1.5')
  const cls = () => {
    let c =
      'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
      h() +
      (props.full ? ' w-full' : '') +
      (props.class ? ' ' + props.class : '')
    if (props.variant === 'ghost')
      c += ' text-[color:var(--muted)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]'
    else if (props.variant !== 'primary') c += ' border border-line bg-[var(--surface)] hover:border-[color:var(--text2)]'
    return c
  }
  const style = () => {
    const s: JSX.CSSProperties = { 'border-radius': `${rad()}px` }
    const ac = cAccent()
    if (props.variant === 'primary') {
      s.background = props.danger ? (cTheme() === 'light' ? '#D1242F' : '#DA3633') : ac
      s.color = props.danger ? '#fff' : cTheme() === 'light' ? '#fff' : '#06231f'
    } else if (props.variant !== 'ghost') {
      s.color = props.danger ? tone('#D1242F') : 'var(--text2)'
    }
    return s
  }
  return (
    <button type={props.type ?? 'button'} title={props.title} onClick={props.onClick} disabled={props.disabled} class={cls()} style={style()}>
      <Show when={props.icon}>
        <Icon name={props.icon} size={size() === 'sm' ? 14 : 15} />
      </Show>
      {props.children}
      <Show when={props.iconR}>
        <Icon name={props.iconR} size={size() === 'sm' ? 14 : 15} />
      </Show>
    </button>
  )
}

/* ── Field / inputs ── */
export function Field(props: { label?: string; required?: boolean; error?: string; hint?: string; children?: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1.5">
      <Show when={props.label}>
        <label class="flex items-center gap-1 text-[12px] font-medium text-[color:var(--text2)]">
          {props.label}
          <Show when={props.required}>
            <span style={{ color: tone('#D1242F') }}>*</span>
          </Show>
        </label>
      </Show>
      {props.children}
      <Show
        when={props.error}
        fallback={
          <Show when={props.hint}>
            <span class="text-[11px] text-[color:var(--muted2)]">{props.hint}</span>
          </Show>
        }
      >
        <span class="flex items-center gap-1 text-[11px]" style={{ color: tone('#D1242F') }}>
          <IcAlert size={12} />
          {props.error}
        </span>
      </Show>
    </div>
  )
}

const inputCls =
  'h-9 w-full rounded-lg border bg-[var(--surface)] px-3 text-[12.5px] text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted2)] transition-colors'

export function TextInput(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  error?: string
  mono?: boolean
  icon?: string
}) {
  return (
    <div class="relative flex items-center">
      <Show when={props.icon}>
        <Icon name={props.icon} size={15} class="pointer-events-none absolute left-3 text-[color:var(--muted2)]" />
      </Show>
      <input
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        placeholder={props.placeholder}
        class={inputCls + (props.mono ? ' font-mono' : '') + (props.icon ? ' pl-9' : '')}
        style={{ 'border-color': props.error ? tone('#D1242F') : 'var(--line)', 'border-radius': `${rad()}px` }}
        onFocus={(e) => {
          if (!props.error) e.currentTarget.style.borderColor = cAccent()
        }}
        onBlur={(e) => {
          if (!props.error) e.currentTarget.style.borderColor = 'var(--line)'
        }}
      />
    </div>
  )
}

export function Select(props: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  error?: string
}) {
  return (
    <div class="relative">
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        class={inputCls + ' appearance-none pr-9'}
        style={{ 'border-color': props.error ? tone('#D1242F') : 'var(--line)', 'border-radius': `${rad()}px` }}
      >
        <For each={props.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
      </select>
      <IcChevD size={15} class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--muted2)]" />
    </div>
  )
}

/* ── ProgressBar / StackBar ── */
export function ProgressBar(props: { pct: number; tone?: string; h?: number; bg?: string }) {
  const p = () => Math.max(0, Math.min(100, props.pct))
  return (
    <div class="w-full overflow-hidden rounded-full" style={{ height: `${props.h ?? 8}px`, background: props.bg ?? 'var(--surface2)' }}>
      <div class="h-full rounded-full transition-all" style={{ width: p() + '%', background: props.tone || cAccent() }} />
    </div>
  )
}

export function StackBar(props: { rows: { label: string; n: number; col?: string }[]; h?: number }) {
  const total = () => props.rows.reduce((s, r) => s + r.n, 0) || 1
  return (
    <div>
      <div class="flex w-full overflow-hidden rounded-full" style={{ height: `${props.h ?? 14}px` }}>
        <For each={props.rows}>
          {(r) => <div style={{ width: (r.n / total()) * 100 + '%', background: tone(r.col || '#8B949E') }} title={r.label} />}
        </For>
      </div>
      <div class="mt-2.5 flex flex-col gap-1.5">
        <For each={props.rows}>
          {(r) => (
            <div class="flex items-center gap-2">
              <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: tone(r.col || '#8B949E') }} />
              <span class="min-w-0 flex-1 truncate text-[12px] text-[color:var(--text2)]">{r.label}</span>
              <span class="shrink-0 font-mono text-[11px] text-[color:var(--muted)]">{r.n}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

/* ── Modal (Portal — Solid needs explicit portal, design used React tree) ── */
export function Modal(props: {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  icon?: string
  accent?: string
  children?: JSX.Element
  footer?: JSX.Element
  wide?: boolean
  xwide?: boolean
}) {
  createEffect(() => {
    if (!props.open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', h)
    onCleanup(() => window.removeEventListener('keydown', h))
  })
  return (
    <Show when={props.open}>
      <Portal>
        {/* Click-outside backdrop (Escape also closes via the effect above). */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
          style={{
            background: cTheme() === 'light' ? 'rgba(20,30,45,0.34)' : 'rgba(0,0,0,0.62)',
            'backdrop-filter': 'blur(2px)',
          }}
          onClick={props.onClose}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            class="crm-modal-in relative my-auto w-full border border-line bg-[var(--surface)]"
            style={{
              'max-width': `${props.xwide ? 880 : props.wide ? 680 : 480}px`,
              'border-radius': `${rad() + 6}px`,
              'box-shadow': '0 24px 64px -16px rgba(0,0,0,0.45)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-start gap-3 border-b border-line px-5 py-4">
              <Show when={props.icon}>
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: chex(props.accent || cAccent(), cTheme() === 'light' ? 0.12 : 0.2),
                    color: tone(props.accent || cAccent()),
                    'border-radius': `${rad()}px`,
                  }}
                >
                  <Icon name={props.icon} size={18} />
                </span>
              </Show>
              <div class="min-w-0 flex-1">
                <h3 class="text-[15px] font-semibold text-[color:var(--text)]">{props.title}</h3>
                <Show when={props.subtitle}>
                  <p class="mt-0.5 text-[11.5px] text-[color:var(--muted)]">{props.subtitle}</p>
                </Show>
              </div>
              <button
                onClick={props.onClose}
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--muted2)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"
              >
                <IcX size={16} />
              </button>
            </div>
            <div class="px-5 py-4">{props.children}</div>
            <Show when={props.footer}>
              <div class="flex items-center justify-end gap-2.5 border-t border-line px-5 py-3.5">{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

/* ── ToastHost ── */
export interface Toast {
  id: string
  msg: string
  kind?: 'success' | 'error' | 'info'
}
export function ToastHost(props: { toasts: Toast[] }) {
  return (
    <Portal>
      <div class="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        <For each={props.toasts}>
          {(t) => {
            const cols: Record<string, string> = { success: '#1A7F37', error: '#D1242F', info: '#0969DA' }
            const col = tone(cols[t.kind || 'info'] || cols.info!)
            return (
              <div
                class="crm-toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-[var(--surface)] px-3.5 py-2.5"
                style={{ 'box-shadow': 'var(--toast-shadow)' }}
              >
                <span class="mt-px shrink-0" style={{ color: col }}>
                  <Show when={t.kind === 'success'} fallback={<Show when={t.kind === 'error'} fallback={<IcInfo size={16} />}><IcAlert size={16} /></Show>}>
                    <IcCheckCircle size={16} />
                  </Show>
                </span>
                <div class="min-w-0 flex-1 text-[12px] leading-snug text-[color:var(--text)]">{t.msg}</div>
              </div>
            )
          }}
        </For>
      </div>
    </Portal>
  )
}

/* ── Empty / KV / Card / Check / ScreenHead ── */
export function Empty(props: { icon?: string; title?: string; hint?: string; action?: JSX.Element }) {
  return (
    <div class="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
      <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface2)] text-[color:var(--faint)]">
        <Icon name={props.icon ?? 'IcSearch'} size={22} />
      </span>
      <div class="text-[13px] font-medium text-[color:var(--text2)]">{props.title}</div>
      <Show when={props.hint}>
        <div class="max-w-xs text-[11.5px] text-[color:var(--muted)]">{props.hint}</div>
      </Show>
      {props.action}
    </div>
  )
}

export function KV(props: { label: string; children?: JSX.Element; mono?: boolean }) {
  return (
    <div class="flex items-start gap-3 py-1.5">
      <div class="w-[116px] shrink-0 pt-px text-[12px] text-[color:var(--muted)]">{props.label}</div>
      <div class={'min-w-0 flex-1 text-[12.5px] text-[color:var(--text)] ' + (props.mono ? 'font-mono' : '')}>{props.children}</div>
    </div>
  )
}

export function Card(props: { children?: JSX.Element; class?: string; pad?: boolean }) {
  const pad = () => props.pad !== false
  return (
    <div
      class={'rounded-xl border border-line bg-[var(--surface)] ' + (pad() ? 'p-4 ' : '') + (props.class || '')}
      style={{ 'box-shadow': 'var(--card-shadow)', 'border-radius': `${rad() + 2}px` }}
    >
      {props.children}
    </div>
  )
}

export function Check(props: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        props.onChange()
      }}
      class="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors"
      style={{
        'border-color': props.on ? cAccent() : 'var(--line)',
        background: props.on ? cAccent() : 'transparent',
        color: cTheme() === 'light' ? '#fff' : '#06231f',
      }}
    >
      <Show when={props.on}>
        <IcCheck size={12} sw={2.4} />
      </Show>
    </button>
  )
}

export function SegToggle(props: { options: { id: string; label: string; icon?: string; title?: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div class="inline-flex items-center gap-0.5 rounded-lg border border-line bg-[var(--surface2)] p-0.5" style={{ 'border-radius': `${rad()}px` }}>
      <For each={props.options}>
        {(o) => {
          const on = () => o.id === props.value
          return (
            <button
              onClick={() => props.onChange(o.id)}
              title={o.title}
              class="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors"
              style={{
                background: on() ? 'var(--surface)' : 'transparent',
                color: on() ? 'var(--text)' : 'var(--muted)',
                'box-shadow': on() ? 'var(--card-shadow)' : 'none',
                'border-radius': `${rad() - 3}px`,
              }}
            >
              <Show when={o.icon}>
                <Icon name={o.icon} size={14} />
              </Show>
              {o.label}
            </button>
          )
        }}
      </For>
    </div>
  )
}

export function ScreenHead(props: { title: string; sub?: string; right?: JSX.Element }) {
  return (
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-[20px] font-semibold tracking-tight text-[color:var(--text)]">{props.title}</h1>
        <Show when={props.sub}>
          <p class="mt-0.5 text-[12.5px] text-[color:var(--muted)]">{props.sub}</p>
        </Show>
      </div>
      <Show when={props.right}>
        <div class="flex items-center gap-2">{props.right}</div>
      </Show>
    </div>
  )
}
