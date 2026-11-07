/* SYSTEM 3D shell — the network map fills the window and is the centre of
   everything. Around it, all frosted glass and all floating:
     • top bar      brand · asset search · view switch · palette · theme · account
     • HUD          network KPI cards, top-left (slot: props.hud)
     • dock         one button per screen, right edge; opens …
     • side panel   … the screen as a glass panel beside the dock, map still live
     • work area    editor / CAD import take the viewport under the top bar
   Ported from the pump-station 3D prototype (simulator-trambom/web). */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { useSessionContext } from '@/entities/session'
import { getAccountUrl } from '@/shared/config/runtime-config'
import { navigateToMenuApp } from '@/shared/lib/cross-app-sso'
import { CommandPalette } from './command-palette'
import { PANELS, PANEL_BY_ID, TITLES, type PanelDef, type Route } from './nav'
import { Icon, IcChevD, IcGrid, IcMoon, IcSearch, IcSun, IcUser, IcX } from '../lib/icons'
import { useTheme } from '../lib/theme'

export interface ShellSlots {
  /** the full-screen map (or a placeholder scene when no network is loaded) */
  stage?: JSX.Element
  /** HUD cards, top-left over the map */
  hud?: JSX.Element
  /** things floating over the map: inspector drawer, banners, measure pill */
  overlay?: JSX.Element
  /** top-bar search box */
  search?: JSX.Element
  /** extra top-bar buttons (map tools) */
  tools?: JSX.Element
}

const isWorkspace = (name: string) => PANEL_BY_ID[name]?.workspace === true

export function GisShell(
  props: ShellSlots & {
    route: Route
    go: (route: Route) => void
    counts?: Record<string, number>
    /** the active screen: shown in the side panel, the work area, or nowhere (route "map") */
    children?: JSX.Element
    /** force the work-area layout (tenant import / editor without a loaded network) */
    workspace?: boolean
    /** false: no dock (the scalable viewer has no panels) */
    dock?: boolean
  }
) {
  const { theme, setTheme, tweaks } = useTheme()
  const [cmd, setCmd] = createSignal(false)
  const go = (route: Route) => {
    setCmd(false)
    props.go(route)
  }
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', theme())
    document.documentElement.classList.toggle('crm-dense', tweaks().density === 'compact')
    document.documentElement.classList.toggle('crm-comfy', tweaks().density === 'comfy')
  })
  const panel = createMemo<PanelDef | undefined>(() => PANEL_BY_ID[props.route.name])
  const workspace = () => props.workspace === true || isWorkspace(props.route.name)
  const sidePanel = () => (!workspace() ? panel() : undefined)
  const onKey = (event: KeyboardEvent) => {
    const t = event.target
    if (
      event.key === 'Escape' &&
      sidePanel() &&
      !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) &&
      !document.querySelector('[role="dialog"]')
    )
      go({ name: 'map' })
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'k' &&
      props.route.name !== 'editor'
    ) {
      event.preventDefault()
      setCmd(value => !value)
    }
  }
  window.addEventListener('keydown', onKey)
  onCleanup(() => window.removeEventListener('keydown', onKey))

  return (
    <div
      class="sx-app"
      data-testid="gis-shell"
      data-side={sidePanel() ? (sidePanel()!.wide ? 'wide' : 'true') : undefined}
      data-route={props.route.name}
      style={props.dock === false ? { '--dock-w': '0px' } : undefined}
    >
      <div class="sx-stage">{props.stage}</div>

      <Show when={!workspace()}>
        {props.hud}
        {props.overlay}
        <Show when={props.dock !== false}>
          <Dock route={props.route} go={go} counts={props.counts ?? {}} />
        </Show>
        <Show when={sidePanel()} keyed>
          {p => (
            <SidePanel panel={p} onClose={() => go({ name: 'map' })}>
              {props.children}
            </SidePanel>
          )}
        </Show>
      </Show>

      <Show when={workspace()}>
        <main class="sx-workspace" aria-label={TITLES[props.route.name] ?? 'Không gian làm việc'}>
          <Show when={props.route.name === 'map-drafts'}>
            <nav
              aria-label="Dữ liệu bản đồ"
              class="flex flex-wrap gap-3 border-b border-line bg-[var(--surface)] px-5 py-2.5 text-sm"
            >
              <a href="#map">Mạng đã xuất bản</a>
              <a href="#map-drafts" aria-current="page" class="font-semibold">
                Bản nháp đang chỉnh sửa
              </a>
            </nav>
          </Show>
          {props.children}
        </main>
      </Show>

      <TopBar
        route={props.route}
        go={go}
        theme={theme()}
        setTheme={setTheme}
        onCmd={() => setCmd(true)}
        search={props.search}
        tools={props.tools}
      />
      <CommandPalette open={cmd()} onClose={() => setCmd(false)} go={go} />
    </div>
  )
}

/* ── top bar ── */
function TopBar(props: {
  route: Route
  go: (r: Route) => void
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
  onCmd: () => void
  search?: JSX.Element
  tools?: JSX.Element
}) {
  const { session } = useSessionContext()
  const displayName = () =>
    session()?.user?.name ?? session()?.user?.username ?? session()?.user?.email ?? 'Tài khoản'
  const roleText = () => {
    const roles = session()?.user?.roles?.filter(Boolean) ?? []
    return roles.length > 0 ? roles.join(' · ') : 'Người dùng'
  }
  const [acct, setAcct] = createSignal(false)
  const view = () =>
    props.route.name === 'editor' ? 'editor' : props.route.name === 'import' ? 'import' : 'map'
  return (
    <header class="sx-topbar sx-glass" data-testid="topbar">
      <button
        type="button"
        class="sx-brand"
        title="Về bản đồ mạng lưới"
        onClick={() => props.go({ name: 'map' })}
      >
        <img src="/system-logo.png" width="30" height="30" alt="" />
        <span class="sx-brand-co">SYSTEM</span>
        <h1>
          Mạng lưới <span>cấp nước</span>
        </h1>
      </button>
      {props.search}
      <div class="flex-1" />
      {props.tools}
      <div class="sx-seg sx-hide-sm" role="group" aria-label="Chế độ làm việc">
        <button
          type="button"
          aria-pressed={view() === 'map'}
          title="Bản đồ mạng lưới 3D"
          onClick={() => props.go({ name: 'map' })}
        >
          Bản đồ
        </button>
        <button
          type="button"
          aria-pressed={view() === 'editor'}
          title="Biên tập mạng lưới"
          onClick={() => props.go({ name: 'editor' })}
        >
          Biên tập
        </button>
        <button
          type="button"
          aria-pressed={view() === 'import'}
          title="Import CAD lên GIS"
          onClick={() => props.go({ name: 'import' })}
        >
          Import
        </button>
      </div>
      <button
        type="button"
        class="sx-btn icon"
        onClick={() => props.onCmd()}
        title="Lệnh & tìm kiếm (⌘K)"
        aria-label="Lệnh & tìm kiếm"
      >
        <IcSearch size={17} />
      </button>
      <button
        type="button"
        class="sx-btn icon"
        onClick={() => props.setTheme(props.theme === 'light' ? 'dark' : 'light')}
        title="Đổi giao diện"
        aria-label="Đổi giao diện"
      >
        <Show when={props.theme === 'light'} fallback={<IcSun size={17} />}>
          <IcMoon size={17} />
        </Show>
      </button>
      <div class="relative sx-hide-sm">
        <button
          type="button"
          class="sx-btn"
          style={{ 'padding-inline': '6px 8px' }}
          aria-haspopup="menu"
          aria-expanded={acct()}
          aria-label={'Tài khoản: ' + displayName()}
          title={displayName()}
          onClick={() => setAcct(o => !o)}
        >
          <span class="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-[color:var(--accent-ink)]">
            <IcUser size={14} />
          </span>
          <IcChevD size={14} />
        </button>
        <Show when={acct()}>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div class="fixed inset-0 z-30" onClick={() => setAcct(false)} />
          <div class="sx-pop sx-glass right-0 top-[42px] w-[260px]" role="menu">
            <div class="px-2 pb-2 pt-1">
              <div class="truncate text-[13px] font-semibold">{displayName()}</div>
              <div class="truncate text-[11.5px] text-[color:var(--muted)]">{roleText()}</div>
            </div>
            <button
              type="button"
              role="menuitem"
              class="sx-menu-item"
              onClick={() => window.open(getAccountUrl(), '_blank', 'noopener')}
            >
              <IcUser size={16} /> Cấu hình tài khoản
            </button>
          </div>
        </Show>
      </div>
      <button
        type="button"
        class="sx-btn icon"
        title="Về cổng ứng dụng"
        aria-label="Về cổng ứng dụng"
        onClick={() => navigateToMenuApp()}
      >
        <IcGrid size={17} />
      </button>
    </header>
  )
}

/* ── dock ── */
function Dock(props: { route: Route; go: (r: Route) => void; counts: Record<string, number> }) {
  const [tip, setTip] = createSignal<{ p: PanelDef; x: number; y: number } | null>(null)
  const groups = createMemo(() => {
    const out: PanelDef[][] = []
    for (const p of PANELS) if (!p.hidden) (out[p.group] ??= []).push(p)
    return out.filter(Boolean)
  })
  return (
    <>
      <nav class="sx-dock sx-glass" aria-label="Chức năng" data-testid="dock">
        <For each={groups()}>
          {(items, gi) => (
            <>
              <Show when={gi() > 0}>
                <span class="sx-dk-sep" aria-hidden="true" />
              </Show>
              <For each={items}>
                {p => {
                  const on = () => props.route.name === p.id
                  const cnt = () => (p.badge ? (props.counts[p.badge] ?? 0) : 0)
                  return (
                    <button
                      type="button"
                      class="sx-dk"
                      aria-pressed={on()}
                      aria-label={p.label}
                      data-panel={p.id}
                      onClick={() => {
                        setTip(null)
                        props.go({ name: on() ? 'map' : p.id })
                      }}
                      onMouseEnter={e => {
                        if (window.innerWidth <= 720) return
                        const r = e.currentTarget.getBoundingClientRect()
                        setTip({ p, x: r.left - 10, y: r.top + r.height / 2 })
                      }}
                      onMouseLeave={() => setTip(null)}
                    >
                      <Icon name={p.icon} size={20} />
                      <span class="sx-dk-l">{p.short}</span>
                      <Show when={cnt() > 0}>
                        <span class="sx-badge">{cnt()}</span>
                      </Show>
                    </button>
                  )
                }}
              </For>
            </>
          )}
        </For>
      </nav>
      <Show when={tip()}>
        {t => (
          <div
            class="sx-tip"
            role="tooltip"
            style={{
              right: `${window.innerWidth - t().x}px`,
              top: `${t().y}px`,
              transform: 'translateY(-50%)',
            }}
          >
            <b>{t().p.label}</b>
            {t().p.sub}
          </div>
        )}
      </Show>
    </>
  )
}

/* ── side panel ── */
function SidePanel(props: { panel: PanelDef; onClose: () => void; children?: JSX.Element }) {
  return (
    <aside
      class="sx-side sx-glass"
      data-wide={props.panel.wide ? 'true' : undefined}
      aria-labelledby="sx-side-title"
      data-testid="side-panel"
    >
      <header class="sx-side-head">
        <span class="sx-side-ico" aria-hidden="true">
          <Icon name={props.panel.icon} size={17} />
        </span>
        <h2 id="sx-side-title">
          {props.panel.label}
          <small>{props.panel.sub}</small>
        </h2>
        <button
          type="button"
          class="sx-xbtn"
          onClick={() => props.onClose()}
          aria-label="Đóng bảng"
          title="Đóng (Esc)"
        >
          <IcX size={18} />
        </button>
      </header>
      <div class="sx-side-body">{props.children}</div>
    </aside>
  )
}

/** Navigation remains available when no network provider can be mounted. */
export function TenantGisShell(props: { children: JSX.Element }) {
  const readRoute = (): Route => {
    const name = window.location.hash.slice(1)
    return { name: TITLES[name] ? name : 'map' }
  }
  const [route, setRoute] = createSignal(readRoute())
  const sync = () => setRoute(readRoute())
  window.addEventListener('hashchange', sync)
  onCleanup(() => window.removeEventListener('hashchange', sync))
  const go = (next: Route) => {
    setRoute(next)
    window.location.hash = next.name
  }
  return (
    <GisShell route={route()} go={go} workspace>
      {props.children}
    </GisShell>
  )
}
