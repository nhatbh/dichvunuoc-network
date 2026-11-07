/* The shared time cursor over the map, and the bridge that puts the operations layer on the map. */
import { For, Show, createMemo, type JSX } from 'solid-js'
import { getOpsSource } from '@/shared/config/runtime-config'
import './ops.css'
import { SLOTS, STATUS_COLOR, pressureColor, slotTime, useOps } from './ops-context'
import { MapOverlay, type OpsMapState } from '../shell/map-stage'

export function TimeBar(): JSX.Element {
  const ops = useOps()
  const ticks = createMemo(() => {
    // one tick per alarm start and marker evidence, coloured by severity
    const out: Array<{ at: number; color: string; title: string }> = []
    for (const a of ops.alarms()) out.push({ at: a.startSlot, color: STATUS_COLOR[a.severity], title: a.message })
    return out
  })
  return (
    <div class="sx-timebar sx-glass" role="group" aria-label="Thời gian" data-testid="time-bar">
      <button
        type="button"
        class="tb-btn"
        aria-label={ops.playing() ? 'Tạm dừng' : 'Phát lại ngày'}
        title={ops.playing() ? 'Tạm dừng' : 'Phát lại ngày'}
        onClick={() => {
          if (!ops.playing() && ops.slot() >= SLOTS - 1) ops.setSlot(0)
          ops.setPlaying(!ops.playing())
        }}
      >
        {ops.playing() ? '❚❚' : '▶'}
      </button>
      <span class="tb-time" data-testid="time-label">
        {slotTime(ops.slot())}
      </span>
      <Show when={getOpsSource() === 'mock'}>
        <span class="tb-sim tb-hide-sm" title="Số liệu mô phỏng trên mạng lưới mẫu — chưa nối dữ liệu đo thật" data-testid="ops-simulated">
          Mô phỏng
        </span>
      </Show>
      <div class="tb-track">
        <For each={ticks()}>
          {t => <span class="tb-tick" style={{ left: `calc(7px + (100% - 14px) * ${t.at / (SLOTS - 1)})`, background: t.color }} title={t.title} />}
        </For>
        <input
          type="range"
          min="0"
          max={SLOTS - 1}
          step="1"
          value={ops.slot()}
          aria-label="Thời điểm trong ngày"
          aria-valuetext={slotTime(ops.slot())}
          onInput={e => {
            ops.setPlaying(false)
            ops.setSlot(Number(e.currentTarget.value))
          }}
        />
        <div class="tb-hours" aria-hidden="true">
          <For each={[0, 3, 6, 9, 12, 15, 18, 21, 24]}>{h => <span>{h}</span>}</For>
        </div>
      </div>
      <select
        class="tb-hide-sm"
        aria-label="Tốc độ phát"
        value={String(ops.speed())}
        onChange={e => ops.setSpeed(Number(e.currentTarget.value))}
      >
        <option value="2">½ giờ/s</option>
        <option value="4">1 giờ/s</option>
        <option value="8">2 giờ/s</option>
      </select>
      <button
        type="button"
        class="tb-btn tb-hide-sm"
        onClick={() => {
          ops.setPlaying(false)
          ops.setSlot(ops.nowSlot())
        }}
      >
        Bây giờ
      </button>
    </div>
  )
}

/** Pushes the operations layer (status at the cursor, flows, optional pressure paint) onto the stage map. */
export function OpsMapBridge(): JSX.Element {
  const ops = useOps()
  const state = createMemo<OpsMapState | null>(() => {
    if (!ops.sensors().length) return null
    const paint = ops.paintPressure()
    return {
      status: ops.status(),
      flows: ops.flowsAt(),
      pressure: paint ? ops.pressureAt() : null,
      pipeKey: `${ops.network() ? ops.hour() : 'x'}|${paint ? 'p' : ''}`,
      pressureColor,
    }
  })
  return (
    <Show when={state()}>
      <MapOverlay ops={state()} />
    </Show>
  )
}
