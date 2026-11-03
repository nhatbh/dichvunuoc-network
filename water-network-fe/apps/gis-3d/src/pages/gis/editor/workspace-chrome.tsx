/* GIS — Biên tập mạng lưới: Photoshop-style workspace chrome.
   Menu bar (Tệp · Sửa · Chọn · Xem) → options bar (context: selection commands or the active
   tool's options) → vertical tool strip on the left (grouped, with hover tooltips) → canvas →
   docked, tabbed panels on the right. */
import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { ED_TEMPLATES, ED_TOOLS, ED_TOOL_GRP, KIND_META, type EdTemplate, type EdTool } from './model'
import { Icon } from '../lib/icons'
import { cAccent, cTheme, chex, tone } from '../lib/theme'
import type { EditorDefaults, SnapModes } from './canvas'

/* ───────────────────────────── menu bar ───────────────────────────── */

export type MenuItem =
  | 'sep'
  | {
      label: string
      icon?: string
      kbd?: string
      onClick: () => void
      disabled?: boolean
      /** Checkbox-style item: shows a tick when true. */
      checked?: boolean
      danger?: boolean
    }
export interface MenuDef {
  id: string
  label: string
  items: MenuItem[]
}

export function EdMenuBar(props: { menus: MenuDef[]; left?: JSX.Element; right?: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal<string | null>(null)
  const close = () => setOpen(null)
  const onDocDown = (e: MouseEvent) => {
    if (!(e.target as HTMLElement | null)?.closest('[data-menubar]')) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open()) {
      e.stopPropagation()
      close()
    }
  }
  document.addEventListener('mousedown', onDocDown)
  window.addEventListener('keydown', onKey, true)
  onCleanup(() => {
    document.removeEventListener('mousedown', onDocDown)
    window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-[var(--surface)] px-2" data-menubar role="menubar">
      {props.left}
      <For each={props.menus}>
        {(m) => (
          <div class="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open() === m.id}
              onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
              onMouseEnter={() => open() && setOpen(m.id)}
              class="h-7 rounded-md px-2.5 text-[12.5px] font-medium transition-colors"
              classList={{
                'bg-[var(--surface2)] text-[color:var(--text)]': open() === m.id,
                'text-[color:var(--text2)] hover:bg-[var(--surface2)]': open() !== m.id,
              }}
            >
              {m.label}
            </button>
            <Show when={open() === m.id}>
              <div role="menu" class="absolute left-0 top-[calc(100%+4px)] z-[80] min-w-[244px] rounded-lg border border-line bg-[var(--surface)] p-1.5" style={{ 'box-shadow': 'var(--toast-shadow)' }}>
                <For each={m.items}>
                  {(it) =>
                    it === 'sep' ? (
                      <div class="my-1 h-px bg-[var(--line)]" />
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={it.disabled}
                        onClick={() => {
                          close()
                          it.onClick()
                        }}
                        class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors enabled:hover:bg-[var(--surface2)] disabled:cursor-default disabled:opacity-40"
                        classList={{ 'text-[color:var(--danger,#D1242F)]': !!it.danger, 'text-[color:var(--text2)]': !it.danger }}
                      >
                        <span class="flex w-4 justify-center opacity-85">
                          <Show when={it.checked !== undefined} fallback={<Show when={it.icon}><Icon name={it.icon} size={14} /></Show>}>
                            <Show when={it.checked}><Icon name="IcCheck" size={14} /></Show>
                          </Show>
                        </span>
                        <span class="flex-1">{it.label}</span>
                        <Show when={it.kbd}><span class="font-mono text-[10px] text-[color:var(--muted2)]">{it.kbd}</span></Show>
                      </button>
                    )
                  }
                </For>
              </div>
            </Show>
          </div>
        )}
      </For>
      <div class="ml-auto flex items-center gap-1.5">{props.right}</div>
    </div>
  )
}

/* ───────────────────────────── tool strip ───────────────────────────── */

export function EdToolStrip(props: { tool: string; setTool: (id: string) => void; disabled?: boolean }): JSX.Element {
  const [tip, setTip] = createSignal<{ t: EdTool; grp: string; top: number; left: number } | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  const show = (t: EdTool, grp: string, el: HTMLElement) => {
    clearTimeout(timer)
    const r = el.getBoundingClientRect()
    // first tooltip waits a moment; moving along the strip updates it at once
    const delay = tip() ? 0 : 350
    timer = setTimeout(() => setTip({ t, grp, top: r.top + r.height / 2, left: r.right + 8 }), delay)
  }
  const hide = () => {
    clearTimeout(timer)
    setTip(null)
  }
  onCleanup(() => clearTimeout(timer))
  const groups = () => ED_TOOL_GRP.map(([g, label]) => ({ g, label, items: ED_TOOLS.filter((t) => t.grp === g) }))

  return (
    <div class="flex w-[48px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-[var(--surface)] py-2" role="toolbar" aria-orientation="vertical" aria-label="Công cụ" onMouseLeave={hide}>
      <For each={groups()}>
        {(grp, i) => (
          <>
            <Show when={i() > 0}><div class="my-1.5 h-px w-7 bg-[var(--line)]" /></Show>
            <For each={grp.items}>
              {(t) => {
                const on = () => props.tool === t.id
                return (
                  <button
                    type="button"
                    aria-label={t.label}
                    aria-pressed={on()}
                    data-tool={t.id}
                    disabled={props.disabled && t.grp !== 'sel'}
                    onClick={() => {
                      hide()
                      props.setTool(t.id)
                    }}
                    onMouseEnter={(e) => show(t, grp.label, e.currentTarget)}
                    onFocus={(e) => show(t, grp.label, e.currentTarget)}
                    onBlur={hide}
                    class="flex h-9 w-9 items-center justify-center rounded-md transition-colors disabled:opacity-30"
                    style={{
                      background: on() ? chex(cAccent(), cTheme() === 'light' ? 0.16 : 0.28) : 'transparent',
                      color: on() ? tone(cAccent()) : 'var(--muted)',
                    }}
                  >
                    <Icon name={t.icon} size={18} />
                  </button>
                )
              }}
            </For>
          </>
        )}
      </For>
      <Show when={tip()}>
        {(tp) => (
          <Portal>
            <div
              role="tooltip"
              class="pointer-events-none fixed z-[90] w-[248px] -translate-y-1/2 rounded-lg border border-line bg-[var(--surface)] px-3 py-2"
              style={{ top: `${tp().top}px`, left: `${tp().left}px`, 'box-shadow': 'var(--toast-shadow)' }}
            >
              <div class="flex items-center gap-2">
                <span class="text-[12.5px] font-semibold text-[color:var(--text)]">{tp().t.label}</span>
                <span class="ml-auto rounded border border-line px-1.5 font-mono text-[10px] text-[color:var(--muted)]">{tp().t.cmd}</span>
              </div>
              <div class="mt-0.5 text-[10px] uppercase tracking-wider text-[color:var(--muted2)]">Nhóm {tp().grp}</div>
              <div class="mt-1 text-[11.5px] leading-snug text-[color:var(--muted)]">{tp().t.hint}</div>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  )
}

/* ───────────────────────────── options bar ───────────────────────────── */

const DN_OPTIONS = [50, 63, 75, 90, 100, 110, 150, 160, 200, 250, 300, 400, 500, 600, 800, 1000]
const VALVE_KINDS = [
  { value: 'gate', label: 'Van cổng' },
  { value: 'butterfly', label: 'Van bướm' },
  { value: 'boundary', label: 'Van biên DMA' },
  { value: 'air', label: 'Van xả khí' },
]

function OptSep(): JSX.Element {
  return <span class="mx-1 h-5 w-px shrink-0 bg-[var(--line)]" />
}
function OptLabel(props: { children: JSX.Element }): JSX.Element {
  return <span class="shrink-0 text-[11px] text-[color:var(--muted)]">{props.children}</span>
}
function OptSelect(props: { value: string | number; options: { value: string | number; label: string }[]; onChange: (v: string) => void; label: string }): JSX.Element {
  return (
    <select
      aria-label={props.label}
      value={String(props.value)}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      class="h-7 shrink-0 rounded-md border border-line bg-[var(--surface)] px-1.5 text-[12px] text-[color:var(--text)] outline-none"
    >
      <For each={props.options}>{(o) => <option value={String(o.value)}>{o.label}</option>}</For>
    </select>
  )
}
function OptToggle(props: { on: boolean; label: string; title?: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      title={props.title}
      onClick={props.onClick}
      class="h-7 shrink-0 rounded-md border px-2 text-[11.5px] font-medium transition-colors"
      style={{
        'border-color': props.on ? cAccent() : 'var(--line)',
        color: props.on ? tone(cAccent()) : 'var(--muted)',
        background: props.on ? chex(cAccent(), cTheme() === 'light' ? 0.1 : 0.2) : 'transparent',
      }}
    >
      {props.label}
    </button>
  )
}
function OptButton(props: { icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; kbd?: string }): JSX.Element {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.kbd ? `${props.label} (${props.kbd})` : props.label}
      class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium transition-colors enabled:hover:bg-[var(--surface2)] disabled:opacity-35"
      classList={{ 'text-[color:var(--danger,#D1242F)]': !!props.danger, 'text-[color:var(--text2)]': !props.danger }}
    >
      <Icon name={props.icon} size={14} />
      {props.label}
    </button>
  )
}

export interface SelectionSummary {
  count: number
  /** e.g. "2 ống · 1 van" */
  detail: string
}

export function EdOptionsBar(props: {
  tool: EdTool
  locked: boolean
  selection: SelectionSummary
  /** Run a selection / edit action by id (see actions.ts). */
  run: (id: string) => void
  can: (id: string) => boolean
  defaults: EditorDefaults
  setDefaults: (d: EditorDefaults) => void
  materials: string[]
  offsetDist: number
  setOffsetDist: (v: number) => void
  snap: boolean
  setSnap: (v: boolean) => void
  snapModes: SnapModes
  setSnapModes: (v: SnapModes) => void
  ortho: boolean
  setOrtho: (v: boolean) => void
}): JSX.Element {
  const t = () => props.tool
  const isSel = () => t().grp === 'sel'
  const SNAPS: [keyof SnapModes, string][] = [
    ['node', 'Nút'],
    ['vertex', 'Đỉnh'],
    ['edge', 'Tim ống'],
    ['grid', 'Lưới'],
  ]
  const dnOpts = (cur: number) => (DN_OPTIONS.includes(cur) ? DN_OPTIONS : [...DN_OPTIONS, cur].sort((a, b) => a - b)).map((d) => ({ value: d, label: 'DN' + d }))

  return (
    <div class="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-[var(--bg2)] px-3" data-testid="editor-options-bar">
      <span class="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-[color:var(--text)]">
        <span style={{ color: tone(cAccent()) }}><Icon name={t().icon} size={15} /></span>
        {t().label}
      </span>
      <OptSep />

      {/* selection commands (select tools) */}
      <Show when={isSel()}>
        <span class="shrink-0 rounded-md bg-[var(--surface2)] px-2 py-1 text-[11.5px] text-[color:var(--text2)]" data-testid="selection-summary">
          <Show when={props.selection.count} fallback={'Chưa chọn'}>
            <b class="text-[color:var(--text)]">{props.selection.count}</b> đã chọn
            <Show when={props.selection.detail}><span class="text-[color:var(--muted)]"> · {props.selection.detail}</span></Show>
          </Show>
        </span>
        <OptButton icon="IcGridSq" label="Tất cả" kbd="Ctrl+A" disabled={!props.can('select-all')} onClick={() => props.run('select-all')} />
        <OptButton icon="IcX" label="Bỏ chọn" kbd="Esc" disabled={!props.can('deselect')} onClick={() => props.run('deselect')} />
        <OptButton icon="IcRefresh" label="Đảo" kbd="Ctrl+Shift+I" disabled={!props.can('invert-selection')} onClick={() => props.run('invert-selection')} />
        <OptButton icon="IcLayers" label="Cùng loại" disabled={!props.can('select-same-kind')} onClick={() => props.run('select-same-kind')} />
        <OptButton icon="IcZoomIn" label="Phóng tới" disabled={!props.can('zoom-to')} onClick={() => props.run('zoom-to')} />
        <OptSep />
        <OptButton icon="IcRows" label="Sửa hàng loạt" disabled={!props.can('batch-edit')} onClick={() => props.run('batch-edit')} />
        <OptButton icon="IcTrash" label="Xoá" kbd="Del" danger disabled={props.locked || !(props.can('delete') || props.can('delete-all'))} onClick={() => props.run(props.can('delete-all') ? 'delete-all' : 'delete')} />
      </Show>

      {/* draw tool options */}
      <Show when={t().id === 'pipe'}>
        <OptLabel>Đường kính</OptLabel>
        <OptSelect label="Đường kính" value={props.defaults.pipe.dn} options={dnOpts(props.defaults.pipe.dn)} onChange={(v) => props.setDefaults({ ...props.defaults, pipe: { ...props.defaults.pipe, dn: +v } })} />
        <OptLabel>Vật liệu</OptLabel>
        <OptSelect label="Vật liệu" value={props.defaults.pipe.material} options={props.materials.map((m) => ({ value: m, label: m }))} onChange={(v) => props.setDefaults({ ...props.defaults, pipe: { ...props.defaults.pipe, material: v } })} />
        <OptToggle on={props.defaults.pipe.trunk} label="Ống truyền tải" onClick={() => props.setDefaults({ ...props.defaults, pipe: { ...props.defaults.pipe, trunk: !props.defaults.pipe.trunk } })} />
        <OptToggle on={props.ortho} label="ORTHO" title="Khoá góc 45°" onClick={() => props.setOrtho(!props.ortho)} />
      </Show>
      <Show when={t().id === 'valve'}>
        <OptLabel>Đường kính</OptLabel>
        <OptSelect label="Đường kính van" value={props.defaults.valve.dn} options={dnOpts(props.defaults.valve.dn)} onChange={(v) => props.setDefaults({ ...props.defaults, valve: { ...props.defaults.valve, dn: +v } })} />
        <OptLabel>Loại</OptLabel>
        <OptSelect label="Loại van" value={props.defaults.valve.vkind} options={VALVE_KINDS} onChange={(v) => props.setDefaults({ ...props.defaults, valve: { ...props.defaults.valve, vkind: v } })} />
      </Show>
      <Show when={t().id === 'offset'}>
        <OptLabel>Khoảng cách</OptLabel>
        <input
          type="number"
          aria-label="Khoảng cách offset"
          value={props.offsetDist}
          min="0.5"
          step="0.5"
          onInput={(e) => props.setOffsetDist(Math.max(0.5, +e.currentTarget.value || 0.5))}
          class="h-7 w-[72px] shrink-0 rounded-md border border-line bg-[var(--surface)] px-2 font-mono text-[12px] text-[color:var(--text)] outline-none"
        />
        <OptLabel>m</OptLabel>
      </Show>
      <Show when={!isSel() && t().id !== 'pipe' && t().id !== 'valve' && t().id !== 'offset'}>
        <span class="min-w-0 truncate text-[11.5px] text-[color:var(--muted)]">{t().hint}</span>
      </Show>

      {/* snapping (everything that places or moves geometry) */}
      <div class="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <OptToggle on={props.snap} label="SNAP" title="Bắt điểm" onClick={() => props.setSnap(!props.snap)} />
        <For each={SNAPS}>
          {([k, lbl]) => (
            <button
              type="button"
              aria-pressed={props.snapModes[k]}
              disabled={!props.snap}
              onClick={() => props.setSnapModes({ ...props.snapModes, [k]: !props.snapModes[k] })}
              class="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
              style={{ color: props.snapModes[k] ? 'var(--text2)' : 'var(--muted2)' }}
              title={'Bắt điểm: ' + lbl}
            >
              <span class="h-2.5 w-2.5 rounded-sm" style={{ background: props.snapModes[k] ? cAccent() : 'var(--surface-active, var(--line))' }} />
              {lbl}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

/* ───────────────────────────── right dock ───────────────────────────── */

/** Collapsible dock panel with a header (Photoshop-style). */
export function EdDockPanel(props: {
  title: string
  actions?: JSX.Element
  collapsed?: boolean
  onToggle?: () => void
  class?: string
  children: JSX.Element
}): JSX.Element {
  return (
    <section class={'flex min-h-0 flex-col border-b border-line ' + (props.class ?? '')}>
      <header class="flex h-8 shrink-0 items-center gap-1 bg-[var(--bg2)] px-2">
        <Show when={props.onToggle}>
          <button type="button" onClick={() => props.onToggle?.()} aria-label={props.collapsed ? 'Mở rộng' : 'Thu gọn'} class="flex h-5 w-5 items-center justify-center rounded text-[color:var(--muted2)] hover:text-[color:var(--text)]">
            <Icon name={props.collapsed ? 'IcChevR' : 'IcChevD'} size={13} />
          </button>
        </Show>
        <span class="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--muted)]">{props.title}</span>
        <div class="ml-auto flex items-center gap-0.5">{props.actions}</div>
      </header>
      <Show when={!props.collapsed}>{props.children}</Show>
    </section>
  )
}

export interface DockTab {
  id: string
  label: string
  badge?: string | number
}

/** Tab strip for a group of dock panels. */
export function EdDockTabs(props: { tabs: DockTab[]; active: string; onSelect: (id: string) => void; actions?: JSX.Element }): JSX.Element {
  return (
    <div class="flex h-8 shrink-0 items-end gap-0.5 border-b border-line bg-[var(--bg2)] px-1.5" role="tablist">
      <For each={props.tabs}>
        {(tab) => {
          const on = () => props.active === tab.id
          return (
            <button
              type="button"
              role="tab"
              aria-selected={on()}
              onClick={() => props.onSelect(tab.id)}
              class="flex h-7 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[11.5px] font-medium transition-colors"
              style={{
                'border-color': on() ? 'var(--line)' : 'transparent',
                background: on() ? 'var(--surface)' : 'transparent',
                color: on() ? 'var(--text)' : 'var(--muted)',
                'margin-bottom': '-1px',
              }}
            >
              {tab.label}
              <Show when={tab.badge !== undefined && tab.badge !== ''}>
                <span class="font-mono text-[10px] text-[color:var(--muted2)]">{tab.badge}</span>
              </Show>
            </button>
          )
        }}
      </For>
      <div class="ml-auto flex items-center self-center">{props.actions}</div>
    </div>
  )
}

export const REF_LAYERS: [string, string][] = [
  ['pipe', 'Ống hiện trạng'],
  ['valve', 'Van'],
  ['hydrant', 'Trụ cứu hoả'],
  ['node', 'Nút'],
  ['dma', 'Ranh DMA'],
  ['block', 'Nền khối nhà'],
]

export function EdLayersPanel(props: { refLayers: Record<string, boolean>; setRefLayers: (v: Record<string, boolean>) => void }): JSX.Element {
  return (
    <div class="flex flex-col gap-0.5 p-2">
      <For each={REF_LAYERS}>
        {([k, lbl]) => {
          const on = () => props.refLayers[k] !== false
          return (
            <button type="button" aria-pressed={on()} onClick={() => props.setRefLayers({ ...props.refLayers, [k]: !on() })} class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--surface2)]" style={{ color: on() ? 'var(--text2)' : 'var(--muted2)' }}>
              <span style={{ color: on() ? tone(cAccent()) : 'var(--muted2)' }}>
                <Icon name={on() ? 'IcEye' : 'IcEyeOff'} size={14} />
              </span>
              {lbl}
            </button>
          )
        }}
      </For>
    </div>
  )
}

export function EdPresetsPanel(props: { activeTmpl: string | null; onTemplate: (t: EdTemplate) => void; disabled?: boolean }): JSX.Element {
  return (
    <div class="flex flex-col gap-1 p-2">
      <For each={ED_TEMPLATES}>
        {(t) => {
          const meta = KIND_META[t.kind]
          const on = () => props.activeTmpl === t.id
          return (
            <button type="button" disabled={props.disabled} onClick={() => props.onTemplate(t)} class="flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors disabled:opacity-40" style={{ 'border-color': on() ? cAccent() : 'var(--line)', background: on() ? chex(cAccent(), cTheme() === 'light' ? 0.1 : 0.2) : 'transparent' }}>
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: chex(meta.col, 0.14), color: tone(meta.col) }}>
                <Icon name={meta.icon} size={14} />
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[11.5px] font-medium text-[color:var(--text)]">{t.label}</div>
                <div class="truncate text-[9.5px] text-[color:var(--muted)]">{t.sub}</div>
              </div>
            </button>
          )
        }}
      </For>
    </div>
  )
}
