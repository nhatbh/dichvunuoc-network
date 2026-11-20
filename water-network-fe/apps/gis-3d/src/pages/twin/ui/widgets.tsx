import { Pause, Play } from 'lucide-solid'
import { For, Show, type JSX } from 'solid-js'
import { useSim, f0 } from './sim-context'

export function Kpi(props: { k: string; v: string; u?: string; level?: 'warn' | 'crit' | null; title?: string }) {
  return (
    <div class={`tw-kpi ${props.level ?? ''}`} title={props.title}>
      <div class="k">{props.k}</div>
      <div class="v">
        {props.v}
        <Show when={props.u}>
          <small>{props.u}</small>
        </Show>
      </div>
    </div>
  )
}

export function Row(props: { k: JSX.Element; v: JSX.Element; warn?: boolean }) {
  return (
    <div class="tw-row">
      <span class="k">{props.k}</span>
      <span class={`v ${props.warn ? 'warn' : ''}`}>{props.v}</span>
    </div>
  )
}

/** 24 h sparkline */
export function Spark(props: { data: number[]; color?: string; min?: number; max?: number; band?: [number, number] }) {
  const path = () => {
    const d = props.data
    if (d.length < 2) return ''
    const lo = props.min ?? Math.min(...d)
    const hi = props.max ?? Math.max(...d)
    const span = hi - lo || 1
    return d.map((v, i) => `${i ? 'L' : 'M'}${((i / (d.length - 1)) * 200).toFixed(1)},${(32 - ((v - lo) / span) * 30).toFixed(1)}`).join('')
  }
  const band = () => {
    if (!props.band) return null
    const lo = props.min ?? Math.min(...props.data)
    const hi = props.max ?? Math.max(...props.data)
    const span = hi - lo || 1
    const y0 = 32 - ((props.band[1] - lo) / span) * 30
    const y1 = 32 - ((props.band[0] - lo) / span) * 30
    return { y: Math.max(0, y0), h: Math.max(0, Math.min(34, y1) - Math.max(0, y0)) }
  }
  return (
    <svg class="tw-spark" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true">
      <Show when={band()}>{b => <rect x="0" y={b().y} width="200" height={b().h} fill="var(--good)" opacity="0.1" />}</Show>
      <path d={path()} fill="none" stroke={props.color ?? 'var(--accent)'} stroke-width="1.6" vector-effect="non-scaling-stroke" />
    </svg>
  )
}

export function SimClock(props: { extra?: JSX.Element }) {
  const { sim, v } = useSim()
  const speeds = [1, 10, 60, 300]
  return (
    <>
      <button
        type="button"
        class="tw-btn icon"
        title={sim.paused ? 'Chạy mô phỏng' : 'Tạm dừng mô phỏng'}
        aria-label={sim.paused ? 'Chạy mô phỏng' : 'Tạm dừng mô phỏng'}
        onClick={() => {
          sim.paused = !sim.paused
          sim.advance(0)
        }}
      >
        {(v(), sim.paused) ? <Play size={16} /> : <Pause size={16} />}
      </button>
      <div class="tw-clock" title="Giờ mô phỏng">
        {(v(), sim.clock)}
      </div>
      <div class="tw-seg" role="group" aria-label="Tốc độ mô phỏng">
        <For each={speeds}>
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
      {props.extra}
    </>
  )
}

export function AlarmBadge() {
  const { sim, v } = useSim()
  return (
    <Show when={(v(), sim.activeAlarms.length)}>
      <span class={`tw-chip ${(v(), sim.activeAlarms.some(a => a.level === 'crit')) ? 'fault' : 'man'}`}>
        {(v(), sim.activeAlarms.length)} báo động{(v(), sim.unacked) ? ` · ${f0(sim.unacked)} chưa xác nhận` : ''}
      </span>
    </Show>
  )
}
