/* GIS shell — Command Palette (SolidJS port of tools.jsx CommandPalette). */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { NAV } from './nav'
import { useOptionalGis } from '../lib/gis-data'
import { Icon, IcSearch } from '../lib/icons'
import { cAccent, chex, cTheme, cnorm, rad, tone } from '../lib/theme'
import type { Route } from './nav'

interface CmdItem {
  id: string
  label: string
  sub?: string
  icon: string
  col?: string
  tag?: string
  run: () => void
}
interface CmdGroup {
  title: string
  items: CmdItem[]
}

function CmdRow(props: { item: CmdItem; active: boolean; onRun: () => void; onHover: () => void }) {
  return (
    <button
      onMouseMove={props.onHover}
      onClick={props.onRun}
      class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
      style={{ background: props.active ? 'var(--surface2)' : 'transparent' }}
    >
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{
          background: props.active
            ? chex(props.item.col || '#0E7C86', cTheme() === 'light' ? 0.14 : 0.22)
            : 'var(--surface2)',
          color: props.active ? tone(props.item.col || cAccent()) : 'var(--muted)',
        }}
      >
        <Icon name={props.item.icon} size={15} />
      </span>
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12.5px] font-medium text-[color:var(--text)]">{props.item.label}</div>
        <Show when={props.item.sub}>
          <div class="truncate font-mono text-[10px] text-[color:var(--muted)]">{props.item.sub}</div>
        </Show>
      </div>
      <Show when={props.item.tag}>
        <span class="shrink-0 rounded bg-[var(--surface2)] px-1.5 py-[1px] text-[9.5px] font-medium text-[color:var(--muted)]">{props.item.tag}</span>
      </Show>
      <Show when={props.active}>
        <span class="shrink-0 font-mono text-[10px] text-[color:var(--muted2)]">↵</span>
      </Show>
    </button>
  )
}

export function CommandPalette(props: { open: boolean; onClose: () => void; go: (r: Route) => void; toast?: (m: string, k?: string) => void }): JSX.Element {
  const G = useOptionalGis()
  const [q, setQ] = createSignal('')
  const [act, setAct] = createSignal(0)
  let inputRef: HTMLInputElement | undefined

  createEffect(() => {
    if (props.open) {
      setQ('')
      setAct(0)
      setTimeout(() => inputRef?.focus(), 30)
    }
  })

  const ACTIONS: CmdItem[] = [
    { id: 'a-trace', label: 'Cô lập van / truy vết sự cố', icon: 'IcRoute', col: '#0E7C86', run: () => props.go({ name: 'trace' }) },
    { id: 'a-query', label: 'Truy vấn nâng cao trên bản đồ', icon: 'IcFilter', col: '#0969DA', run: () => props.go({ name: 'map', openQuery: true }) },
    { id: 'a-import', label: 'Import dữ liệu khảo sát', icon: 'IcUpload', col: '#8250DF', run: () => props.go({ name: 'import' }) },
    { id: 'a-new', label: 'Thêm tài sản mới (biên tập)', icon: 'IcPlus', col: '#1A7F37', run: () => props.go({ name: 'editor' }) },
  ]
  const NAV_ITEMS: CmdItem[] = NAV.flatMap((g) =>
    g.items.map((it) => ({ id: 'n-' + it.id, label: it.label, icon: it.icon, run: () => props.go({ name: it.id }) })),
  )

  const groups = createMemo<CmdGroup[]>(() => {
    const k = cnorm(q().trim())
    if (!k) {
      return [
        { title: 'Hành động nhanh', items: ACTIONS },
        { title: 'Điều hướng', items: NAV_ITEMS },
      ]
    }
    const assetHits: CmdItem[] = (G?.assets ?? [])
      .filter((a) => cnorm(a.code).includes(k) || cnorm(a.name).includes(k))
      .slice(0, 6)
      .map((a) => ({
        id: 'as-' + a.id,
        label: a.name,
        sub: a.code,
        icon: G?.ASSET_TYPES[a.type]?.icon ?? 'IcPipe',
        col: G?.ASSET_TYPES[a.type]?.col,
        tag: a.dma,
        run: () => props.go({ name: 'map', focusAsset: { id: a.id } }),
      }))
    const connHits: CmdItem[] = ((G?.connections ?? []) as { id: string; name: string; danhbo: string; addr: string; dma: string }[])
      .filter((c) => cnorm(c.danhbo).includes(k) || cnorm(c.name).includes(k) || cnorm(c.addr).includes(k))
      .slice(0, 4)
      .map((c) => ({
        id: 'co-' + c.id,
        label: c.name,
        sub: c.danhbo + ' · ' + c.addr,
        icon: 'IcPlug',
        col: '#9A6700',
        tag: c.dma,
        run: () => {
          props.go({ name: 'connections' })
          props.toast?.('Danh bộ ' + c.danhbo + ' · ' + c.name, 'info')
        },
      }))
    const navHits = NAV_ITEMS.filter((n) => cnorm(n.label).includes(k))
    const actHits = ACTIONS.filter((a) => cnorm(a.label).includes(k))
    const out: CmdGroup[] = []
    if (assetHits.length) out.push({ title: 'Tài sản không gian', items: assetHits })
    if (connHits.length) out.push({ title: 'Đấu nối khách hàng', items: connHits })
    if (navHits.length) out.push({ title: 'Điều hướng', items: navHits })
    if (actHits.length) out.push({ title: 'Hành động', items: actHits })
    return out
  })

  const flat = createMemo(() => groups().flatMap((g) => g.items))

  createEffect(() => {
    // reset cursor when query changes
    q()
    setAct(0)
  })

  const runIdx = (i: number) => {
    const it = flat()[i]
    if (it) { it.run(); props.onClose() }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAct((a) => Math.min(flat().length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); runIdx(act()) }
    else if (e.key === 'Escape') { e.preventDefault(); props.onClose() }
  }

  // close on Escape via global handler when open
  createEffect(() => {
    if (!props.open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', h)
    onCleanup(() => window.removeEventListener('keydown', h))
  })

  return (
    <Show when={props.open}>
      <Portal>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          class="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]"
          style={{
            background: cTheme() === 'light' ? 'rgba(20,30,45,0.34)' : 'rgba(0,0,0,0.62)',
            'backdrop-filter': 'blur(2px)',
          }}
          onClick={props.onClose}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            class="crm-modal-in flex max-h-[72vh] w-full max-w-[560px] flex-col overflow-hidden border border-line bg-[var(--surface)]"
            style={{ 'border-radius': `${rad() + 6}px`, 'box-shadow': '0 24px 64px -16px rgba(0,0,0,0.45)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <span class="shrink-0 text-[color:var(--muted2)]">
                <IcSearch size={17} />
              </span>
              <input
                ref={inputRef}
                value={q()}
                onChange={(e) => setQ(e.currentTarget.value)}
                onKeyDown={onKey}
                placeholder="Tìm tài sản, danh bộ, địa chỉ, màn hình…"
                class="h-7 w-full bg-transparent text-[14px] text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted2)]"
              />
              <kbd class="hidden shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--muted2)] sm:block">esc</kbd>
            </div>
            <div class="flex-1 overflow-y-auto px-2 py-2">
              <Show
                when={flat().length > 0}
                fallback={
                  <div class="flex flex-col items-center gap-1.5 py-10 text-center">
                    <span class="text-[color:var(--faint)]"><IcSearch size={22} /></span>
                    <div class="text-[12.5px] text-[color:var(--muted)]">Không có kết quả cho "{q()}"</div>
                  </div>
                }
              >
                {/* Use index counter pattern — each group item needs absolute flat index */}
                <GroupList groups={groups()} act={act()} onRun={runIdx} onHover={setAct} />
              </Show>
            </div>
            <div class="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[10.5px] text-[color:var(--muted2)]">
              <span class="flex items-center gap-1"><kbd class="rounded border border-line px-1 font-mono">↑↓</kbd>chọn</span>
              <span class="flex items-center gap-1"><kbd class="rounded border border-line px-1 font-mono">↵</kbd>mở</span>
              <span class="ml-auto flex items-center gap-1"><kbd class="rounded border border-line px-1 font-mono">⌘K</kbd>tìm kiếm</span>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

/* Separate component to avoid closure issues with mutable index counter. */
function GroupList(props: { groups: CmdGroup[]; act: number; onRun: (i: number) => void; onHover: (i: number) => void }) {
  let idx = -1
  return (
    <For each={props.groups}>
      {(g) => (
        <div class="mb-1">
          <div class="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{g.title}</div>
          <For each={g.items}>
            {(it) => {
              idx++
              const my = idx
              return (
                <CmdRow
                  item={it}
                  active={my === props.act}
                  onRun={() => props.onRun(my)}
                  onHover={() => props.onHover(my)}
                />
              )
            }}
          </For>
        </div>
      )}
    </For>
  )
}
