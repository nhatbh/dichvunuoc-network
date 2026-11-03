import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js'
import { CommandPalette } from './command-palette'
import { TITLES, type Route } from './nav'
import { SidebarInner } from './sidebar'
import { TopBar } from './topbar'
import { useTheme } from '../lib/theme'

/** Shared chrome for Home, CAD import and tenant loading/empty/error states. */
export function GisShell(props: {
  route: Route
  go: (route: Route) => void
  counts?: Record<string, number>
  children: JSX.Element
}) {
  const { theme, setTheme, tweaks } = useTheme()
  const [drawer, setDrawer] = createSignal(false)
  const [cmd, setCmd] = createSignal(false)
  const go = (route: Route) => {
    setDrawer(false)
    setCmd(false)
    props.go(route)
  }
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', theme())
    document.documentElement.classList.toggle('crm-dense', tweaks().density === 'compact')
    document.documentElement.classList.toggle('crm-comfy', tweaks().density === 'comfy')
  })
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setDrawer(false)
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
    <div class="min-h-dvh bg-[var(--bg)] text-[color:var(--text)]" data-testid="gis-shell">
      <aside class="fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col border-r border-line bg-[var(--surface)] md:flex">
        <SidebarInner route={props.route} go={go} counts={props.counts ?? {}} />
      </aside>

      <Show when={drawer()}>
        <div class="fixed inset-0 z-[80] md:hidden">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div class="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside
            class="crm-menu-in absolute inset-y-0 left-0 flex w-[256px] flex-col border-r border-line bg-[var(--surface)]"
            style={{ 'box-shadow': '0 16px 50px rgba(0,0,0,0.4)' }}
          >
            <SidebarInner route={props.route} go={go} counts={props.counts ?? {}} />
          </aside>
        </div>
      </Show>

      <div class="md:pl-[244px]">
        <TopBar
          route={props.route}
          theme={theme()}
          setTheme={setTheme}
          go={go}
          onMenu={() => setDrawer(true)}
          onCmd={() => setCmd(true)}
        />
        <main>
          <Show when={props.route.name === 'map' || props.route.name === 'map-drafts'}>
            <nav
              aria-label="Dữ liệu bản đồ"
              class="flex flex-wrap gap-3 border-b border-line bg-[var(--surface)] px-5 py-3 text-sm"
            >
              <a href="#map" aria-current={props.route.name === 'map' ? 'page' : undefined}>
                Mạng đã xuất bản
              </a>
              <a
                href="#map-drafts"
                aria-current={props.route.name === 'map-drafts' ? 'page' : undefined}
              >
                Bản nháp đang chỉnh sửa
              </a>
            </nav>
          </Show>
          {props.children}
        </main>
      </div>
      <CommandPalette open={cmd()} onClose={() => setCmd(false)} go={go} />
    </div>
  )
}

/** Navigation remains available when no network provider can be mounted. */
export function TenantGisShell(props: { children: JSX.Element }) {
  const readRoute = (): Route => {
    const name = window.location.hash.slice(1)
    return { name: TITLES[name] ? name : 'dashboard' }
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
    <GisShell route={route()} go={go}>
      {props.children}
    </GisShell>
  )
}
