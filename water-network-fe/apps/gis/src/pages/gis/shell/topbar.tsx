/* GIS shell — top bar (SolidJS port of app.jsx TopBar). */
import { Show } from 'solid-js'
import { SECOF, TITLES } from './nav'
import { IcChevRight, IcLayers, IcMoon, IcSearch, IcSun } from '../lib/icons'
import { cTheme, rad } from '../lib/theme'
import { Btn } from '../ui/kit'
import type { Route } from './nav'

export function TopBar(props: {
  route: Route
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
  go: (r: Route) => void
  onMenu: () => void
  onCmd: () => void
}) {
  return (
    <header
      class="sticky top-0 z-20 flex items-center gap-2 border-b border-line px-4 py-3 backdrop-blur sm:px-5"
      style={{ background: cTheme() === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(13,17,23,0.85)' }}
    >
      <button aria-label="Mở menu điều hướng" onClick={props.onMenu} class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-[color:var(--muted)] transition-colors hover:text-[color:var(--text)] md:hidden" style={{ 'border-radius': `${rad()}px` }}>
        <IcLayers size={15} />
      </button>
      <nav class="flex min-w-0 items-center gap-1.5 text-[12.5px]">
        <span class="hidden text-[color:var(--muted)] sm:inline">{SECOF[props.route.name]}</span>
        <IcChevRight size={13} class="hidden shrink-0 text-[color:var(--faint)] sm:inline" />
        <span class="truncate font-semibold text-[color:var(--text)]">{TITLES[props.route.name]}</span>
      </nav>
      <div class="ml-auto flex items-center gap-2">
        <button
          onClick={props.onCmd}
          title="Tìm kiếm (⌘K)"
          class="flex h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-[color:var(--muted)] transition-colors hover:border-[color:var(--text2)] hover:text-[color:var(--text)]"
          style={{ 'border-radius': `${rad()}px` }}
        >
          <IcSearch size={15} />
          <span class="hidden font-mono text-[11px] text-[color:var(--muted2)] lg:inline">⌘K</span>
        </button>
        <Btn variant="default" size="sm" icon="IcRoute" onClick={() => props.go({ name: 'trace' })} title="Cô lập van">
          <span class="hidden sm:inline">Cô lập van</span>
        </Btn>
        <Btn variant="primary" size="sm" icon="IcMap" onClick={() => props.go({ name: 'map' })} title="Bản đồ">
          <span class="hidden sm:inline">Bản đồ</span>
        </Btn>
        <button
          onClick={() => props.setTheme(props.theme === 'light' ? 'dark' : 'light')}
          title="Đổi giao diện"
          class="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[color:var(--muted)] transition-colors hover:text-[color:var(--text)]"
          style={{ 'border-radius': `${rad()}px` }}
        >
          <Show when={props.theme === 'light'} fallback={<IcSun size={15} />}>
            <IcMoon size={15} />
          </Show>
        </button>
      </div>
    </header>
  )
}
