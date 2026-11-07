/* Vận hành — the control room's panel over the operations map: how many sensors are in each state at
   the time cursor, the alarms, and the open markers. Clicking an alarm or marker flies to it. */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { isOpen, MARKER_KIND_LABEL, MARKER_STATE_LABEL } from '@/shared/api/ops-markers'
import type { OpsAlarm, OpsMarker, OpsStatus } from '@/shared/api/ops-types'
import { useGis } from '../lib/gis-data'
import { STATUS_COLOR, STATUS_LABEL, pressureColor, slotTime, useOps } from '../ops/ops-context'
import { MapOverlay } from '../shell/map-stage'
import { Switch } from '../ui/kit'
import type { Route } from '../shell/nav'
import type { FocusBox, Pin } from '../ui/network-map'

export const MARKER_COLOR: Record<OpsMarker['kind'], string> = {
  suspected_leak: '#E0453A',
  confirmed_leak: '#B3261E',
  maintenance: '#2A78D6',
  sensor_fault: '#7D838A',
}

/** Marker pins for the stage map (open markers; the selected one pulses). */
export function markerPins(markers: OpsMarker[], selected: string | null, onPick: (m: OpsMarker) => void): Pin[] {
  return markers
    .filter(m => isOpen(m) || m.id === selected)
    .map(m => ({
      id: m.id,
      x: m.x,
      y: m.y,
      col: MARKER_COLOR[m.kind],
      shape: 'diamond' as const,
      sel: m.id === selected,
      pulse: m.kind !== 'maintenance' && m.state === 'suspected',
      onClick: () => onPick(m),
    }))
}

let focusSeq = 0
/** A focus box around a point (GIS plane units), new each time so the map flies again. */
export const focusOn = (x: number, y: number, r = 60): FocusBox => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r, _k: ++focusSeq })

export function StatusChip(props: { status: OpsStatus; label?: string }): JSX.Element {
  return (
    <span class="ops-chip" style={{ background: STATUS_COLOR[props.status] + '22', color: 'var(--ink)' }}>
      <span class="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[props.status] }} />
      {props.label ?? STATUS_LABEL[props.status]}
    </span>
  )
}

export function OpsScreen(props: { go: (r: Route) => void }): JSX.Element {
  const ops = useOps()
  const G = useGis()
  const counts = createMemo(() => {
    const c: Record<OpsStatus, number> = { normal: 0, warning: 0, critical: 0, offline: 0 }
    for (const st of Object.values(ops.status())) c[st]++
    return c
  })
  const active = createMemo(() =>
    ops.alarms().filter(a => a.startSlot <= ops.slot() && (a.endSlot === undefined || a.endSlot >= ops.slot()))
  )
  const earlier = createMemo(() => ops.alarms().filter(a => a.startSlot <= ops.slot() && !active().includes(a)))
  const openMarkers = createMemo(() =>
    ops
      .markers()
      .filter(isOpen)
      .sort((a, b) => (b.lossM3d ?? 0) - (a.lossM3d ?? 0))
  )
  const sensorName = (id: string) => ops.sensorById().get(id)?.name ?? id
  const [focus, setFocus] = createSignal<FocusBox | null>(null)
  const flyTo = (x: number, y: number) => setFocus(focusOn(x, y))
  const openAlarm = (a: OpsAlarm) => {
    ops.setPlaying(false)
    ops.setSlot(a.startSlot)
    props.go({ name: 'sensor', sensor: a.sensorId })
  }
  const openMarker = (m: OpsMarker) => {
    flyTo(m.x, m.y)
    props.go({ name: 'leaks', marker: m.id })
  }
  const pins = createMemo(() => markerPins(ops.markers(), null, openMarker))

  return (
    <div class="flex flex-col gap-2 text-[13px]" data-screen-label="Vận hành" data-testid="ops-panel">
      <MapOverlay pins={pins()} layers={{ device: true }} focus={focus()} />
      <div class="flex items-baseline justify-between">
        <div>
          <div class="text-[11px] text-[color:var(--muted)]">Trạng thái lúc</div>
          <div class="font-mono text-[22px] font-semibold leading-tight">{slotTime(ops.slot())}</div>
        </div>
        <div class="text-right text-[11px] text-[color:var(--muted)]">
          {ops.sensors().length} cảm biến · {G.TODAY}
        </div>
      </div>
      <div class="grid grid-cols-4 gap-1.5" data-testid="ops-counts">
        <For each={['normal', 'warning', 'critical', 'offline'] as OpsStatus[]}>
          {st => (
            <div class="rounded-lg border border-line px-2 py-1.5">
              <div class="flex items-center gap-1 text-[10.5px] text-[color:var(--muted)]">
                <span class="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />
                {STATUS_LABEL[st]}
              </div>
              <div class="font-mono text-[18px] font-semibold" data-status={st}>
                {counts()[st]}
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="mt-1 flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2">
        <span id="ops-paint-label">
          Tô màu ống theo áp lực
          <span class="block text-[11px] text-[color:var(--muted)]">Áp lực tại nút, theo giờ đang chọn</span>
        </span>
        <Switch on={ops.paintPressure()} onChange={on => ops.setPaintPressure(on)} />
      </div>
      <Show when={ops.paintPressure()}>
        <div class="flex items-center gap-2 text-[10.5px] text-[color:var(--muted)]">
          <span>8 m</span>
          <span
            class="h-2 flex-1 rounded"
            style={{ background: `linear-gradient(90deg, ${[8, 12, 18, 30, 50].map(pressureColor).join(',')})` }}
          />
          <span>50 m</span>
        </div>
      </Show>

      <div class="ops-sec">Cảnh báo đang mở · {active().length}</div>
      <Show when={active().length} fallback={<div class="text-[12px] text-[color:var(--muted)]">Không có cảnh báo tại thời điểm này.</div>}>
        <div class="flex flex-col" data-testid="ops-alarms">
          <For each={active()}>{a => <AlarmRow a={a} name={sensorName(a.sensorId)} onClick={() => openAlarm(a)} />}</For>
        </div>
      </Show>
      <Show when={earlier().length}>
        <details>
          <summary class="ops-sec cursor-pointer">Đã kết thúc trước {slotTime(ops.slot())} · {earlier().length}</summary>
          <For each={earlier()}>{a => <AlarmRow a={a} name={sensorName(a.sensorId)} onClick={() => openAlarm(a)} />}</For>
        </details>
      </Show>

      <div class="ops-sec">Điểm đánh dấu đang mở · {openMarkers().length}</div>
      <div class="flex flex-col">
        <For each={openMarkers()}>
          {m => (
            <button type="button" class="ops-row" onClick={() => openMarker(m)}>
              <span class="inline-block h-2.5 w-2.5 rotate-45" style={{ background: MARKER_COLOR[m.kind] }} />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{m.title}</span>
                <span class="block text-[11px] text-[color:var(--muted)]">
                  {MARKER_KIND_LABEL[m.kind]} · {MARKER_STATE_LABEL[m.state]}
                  {m.lossM3d ? ` · ~${m.lossM3d} m³/ngày` : ''}
                </span>
              </span>
            </button>
          )}
        </For>
      </div>
      <div class="mt-2 flex gap-2">
        <button type="button" class="ops-row justify-center border border-line" onClick={() => props.go({ name: 'leaks' })}>
          Rò rỉ & bảo trì
        </button>
        <button type="button" class="ops-row justify-center border border-line" onClick={() => props.go({ name: 'sensor' })}>
          Biểu đồ cảm biến
        </button>
      </div>
    </div>
  )
}

function AlarmRow(props: { a: OpsAlarm; name: string; onClick: () => void }): JSX.Element {
  const col = () => STATUS_COLOR[props.a.severity]
  return (
    <button type="button" class="ops-row" onClick={() => props.onClick()} data-sensor={props.a.sensorId}>
      <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col() }} />
      <span class="min-w-0 flex-1">
        <span class="block truncate">{props.a.message}</span>
        <span class="block text-[11px] text-[color:var(--muted)]">
          từ {slotTime(props.a.startSlot)}
          {props.a.endSlot !== undefined ? ` đến ${slotTime(props.a.endSlot + 1)}` : ' · đang diễn ra'}
        </span>
      </span>
    </button>
  )
}
