/* GIS — placeholder for screens not yet ported (built in follow-up tasks). */
import { Icon } from '../lib/icons'
import { cAccent, chex, tone } from '../lib/theme'
import { TITLES } from '../shell/nav'
import { Btn, ScreenHead } from '../ui/kit'
import type { Route } from '../shell/nav'

export function PlaceholderScreen(props: { name: string; icon?: string; go: (r: Route) => void }) {
  return (
    <div class="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-6 sm:px-6" data-screen-label={TITLES[props.name]}>
      <ScreenHead title={TITLES[props.name] || props.name} sub="Màn hình đang được phát triển — sẽ bổ sung ở đợt sau." />
      <div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-[var(--surface)] py-20 text-center" style={{ 'box-shadow': 'var(--card-shadow)' }}>
        <span class="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: chex(cAccent(), 0.12), color: tone(cAccent()) }}>
          <Icon name={props.icon ?? 'IcGridSq'} size={26} />
        </span>
        <div class="text-[15px] font-semibold text-[color:var(--text)]">{TITLES[props.name] || props.name}</div>
        <div class="max-w-md text-[12.5px] text-[color:var(--muted)]">
          Tính năng này đang phát triển. Bạn có thể xem Tổng quan GIS hoặc mở Bản đồ mạng lưới.
        </div>
        <div class="mt-1 flex items-center gap-2">
          <Btn size="sm" icon="IcGridSq" onClick={() => props.go({ name: 'dashboard' })}>
            Tổng quan
          </Btn>
          <Btn variant="primary" size="sm" icon="IcMap" onClick={() => props.go({ name: 'map' })}>
            Bản đồ
          </Btn>
        </div>
      </div>
    </div>
  )
}
