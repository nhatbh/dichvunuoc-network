/* GIS shell — sidebar (SolidJS port of app.jsx SidebarInner). */
import { For, Show } from 'solid-js'
import { NAV } from './nav'
import { useOptionalGis } from '../lib/gis-data'
import { Icon, IcGrid, IcMap, IcUser } from '../lib/icons'
import { cAccent, chex, cTheme, fmtDec, rad, tone } from '../lib/theme'
import { Badge } from '../ui/kit'
import { useSessionContext } from '@/entities/session'
import { getAccountUrl } from '@/shared/config/runtime-config'
import { navigateToMenuApp } from '@/shared/lib/cross-app-sso'
import type { Route } from './nav'

export function SidebarInner(props: { route: Route; go: (r: Route) => void; counts: Record<string, number> }) {
  const G = useOptionalGis()
  const { session } = useSessionContext()

  const displayName = () =>
    session()?.user?.name ?? session()?.user?.username ?? session()?.user?.email ?? 'Tài khoản'
  const roleText = () => {
    const roles = session()?.user?.roles?.filter(Boolean) ?? []
    return roles.length > 0 ? roles.join(' · ') : 'Người dùng'
  }

  // Account configuration opens in a new tab; portal navigation replaces the view.
  const openAccount = () => window.open(getAccountUrl(), '_blank', 'noopener')
  const backToMenu = () => navigateToMenuApp()

  return (
    <>
      {/* Brand — pinned at top */}
      <div class="flex shrink-0 items-center gap-2.5 px-4 py-4">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: cAccent(), color: cTheme() === 'light' ? '#fff' : '#06231f' }}>
          <IcMap size={19} />
        </span>
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold tracking-tight text-[color:var(--text)]">Bản đồ mạng lưới</div>
          <div class="truncate text-[10px] text-[color:var(--muted2)]">GIS · Water Platform</div>
        </div>
      </div>

      {/* Nav — scrolls when items overflow so the pinned footer below stays put */}
      <nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2">
        <For each={NAV}>
          {(g) => (
            <div>
              <div class="px-1 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{g.sec}</div>
              <For each={g.items}>
                {(n) => {
                  const on = () => props.route.name === n.id
                  const cnt = () => (n.badge ? (props.counts[n.badge] ?? 0) : 0)
                  return (
                    <button onClick={() => props.go({ name: n.id })} class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors" style={{ background: on() ? 'var(--surface-active)' : 'transparent' }}>
                      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: on() ? chex(cAccent(), cTheme() === 'light' ? 0.14 : 0.22) : 'var(--surface2)', color: on() ? tone(cAccent()) : 'var(--muted)' }}>
                        <Icon name={n.icon} size={16} />
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[12.5px] font-medium" style={{ color: on() ? 'var(--text)' : 'var(--text2)' }}>
                          {n.label}
                        </div>
                        <div class="truncate text-[10px] text-[color:var(--muted2)]">{n.sub}</div>
                      </div>
                      <Show when={cnt() > 0}>
                        <span class="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold text-white" style={{ background: n.badge === 'topo' ? tone('#D1242F') : tone('#9A6700') }}>
                          {cnt()}
                        </span>
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          )}
        </For>
      </nav>

      {/* Network summary — pinned above the user chip */}
      <Show when={G} fallback={<div class="mx-3 my-3 rounded-xl border border-line bg-[var(--surface2)] p-3 text-xs text-[color:var(--muted)]">Thông tin mạng lưới sẽ hiển thị khi dữ liệu GIS sẵn sàng.</div>}>
        {network => <>
      <div class="mx-3 my-3 shrink-0 rounded-xl border border-line bg-[var(--surface2)] p-3" style={{ 'border-radius': `${rad() + 2}px` }}>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Mạng lưới</span>
          <Badge color={tone('#0E7C86')} soft dot>
            {network().SRID.split(' ')[0]!}
          </Badge>
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-[11.5px] text-[color:var(--muted)]">Chiều dài ống</span>
            <span class="font-mono text-[12px] font-medium text-[color:var(--text2)]">{fmtDec(network().DASH.pipeKm, 1)} km</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11.5px] text-[color:var(--muted)]">Lỗi topology</span>
            <span class="font-mono text-[12px] font-medium" style={{ color: tone('#D1242F') }}>
              {network().DASH.topoOpen}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11.5px] text-[color:var(--muted)]">Chờ phê duyệt</span>
            <span class="font-mono text-[12px] font-medium" style={{ color: tone('#9A6700') }}>
              {network().DASH.csPending}
            </span>
          </div>
        </div>
      </div>

        </>}
      </Show>

      {/* User chip — pinned at bottom. Profile → account config; grid → menu app. */}
      <div class="mt-auto flex shrink-0 items-center gap-1 border-t border-line p-2">
        <button
          type="button"
          title="Cấu hình tài khoản"
          onClick={openAccount}
          class="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-[var(--surface2)]"
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: chex(cAccent(), cTheme() === 'light' ? 0.14 : 0.22), color: tone(cAccent()) }}>
            <IcUser size={15} />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[11.5px] font-medium text-[color:var(--text)]">{displayName()}</span>
            <span class="block truncate text-[10px] text-[color:var(--muted2)]">{roleText()}</span>
          </span>
        </button>
        <button
          type="button"
          title="Về cổng ứng dụng"
          aria-label="Về cổng ứng dụng"
          onClick={backToMenu}
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[color:var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[color:var(--text)]"
        >
          <IcGrid size={15} />
        </button>
      </div>
    </>
  )
}
