/* Chi tiết cảm biến — one sensor's day against what it should have read: today's readings over the
   baseline band, its limits, yesterday, leak events and markers, and the shared time cursor. */
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { MARKER_KIND_LABEL } from '@/shared/api/ops-markers'
import type { OpsSensor, OpsSeries } from '@/shared/api/ops-types'
import { MARKER_COLOR, StatusChip, focusOn } from './ops'
import { useGis } from '../lib/gis-data'
import { STATUS_COLOR, slotTime, useOps } from '../ops/ops-context'
import { TimeChart, type ChartFlag, type ChartLine, type ChartWindow } from '../ops/time-chart'
import { MapOverlay } from '../shell/map-stage'
import type { Route } from '../shell/nav'
import type { FocusBox } from '../ui/network-map'

const KIND_LABEL = { pressure: 'Áp lực', flow: 'Lưu lượng', level: 'Mực nước' } as const
const COMPARE_COLORS = ['#1D6CAE', '#D86C1F', '#8250DF', '#1A7F37', '#C0392B', '#0E7C86']
const [compare, setCompare] = createSignal<string[]>([])

export function SensorScreen(props: { sensorId?: string; go: (r: Route) => void; toast: (m: string, k?: string) => void }): JSX.Element {
  const ops = useOps()
  const sensor = createMemo(() => (props.sensorId ? ops.sensorById().get(props.sensorId) : undefined))
  return (
    <div class="flex flex-col gap-2 text-[13px]" data-screen-label="Chi tiết cảm biến" data-testid="sensor-panel">
      <Show when={sensor()} fallback={<SensorPicker go={props.go} />}>
        {s => <SensorDetail sensor={s()} go={props.go} toast={props.toast} />}
      </Show>
    </div>
  )
}

function SensorPicker(props: { go: (r: Route) => void }): JSX.Element {
  const ops = useOps()
  const byDma = createMemo(() => {
    const m = new Map<string, OpsSensor[]>()
    for (const s of ops.sensors()) {
      if (s.kind === 'flow' && !s.main && !s.plant) continue // the many secondary inlet meters live in Rò rỉ → DMA
      const k = s.plant ? 'Nhà máy' : (s.dma ?? '—')
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(s)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })
  return (
    <>
      <div class="text-[12px] text-[color:var(--muted)]">Chọn một cảm biến trên bản đồ hoặc trong danh sách.</div>
      <For each={byDma()}>
        {([dma, list]) => (
          <>
            <div class="ops-sec">{dma}</div>
            <For each={list}>
              {s => (
                <button type="button" class="ops-row" onClick={() => props.go({ name: 'sensor', sensor: s.id })}>
                  <span class="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[ops.status()[s.id] ?? 'offline'] }} />
                  <span class="min-w-0 flex-1 truncate">{s.name}</span>
                  <span class="text-[11px] text-[color:var(--muted)]">{KIND_LABEL[s.kind]}</span>
                </button>
              )}
            </For>
          </>
        )}
      </For>
    </>
  )
}

function SensorDetail(props: { sensor: OpsSensor; go: (r: Route) => void; toast: (m: string, k?: string) => void }): JSX.Element {
  const ops = useOps()
  const G = useGis()
  const s = () => props.sensor
  const series = createMemo<OpsSeries | undefined>(() => ops.series()[s().id])
  const elevation = createMemo(() => {
    const id = s().hostNodeId
    const n = id ? G.nodes.find(x => x.id === id) : undefined
    return n?.z
  })
  const [head, setHead] = createSignal(false)
  // pressure in bar, or hydraulic head (m) = pressure × 10.2 + elevation
  const conv = (v: number) => (head() && s().kind === 'pressure' ? v * 10.2 + (elevation() ?? 0) : v)
  const unit = () => (head() && s().kind === 'pressure' ? 'm' : (series()?.unit ?? s().unit))
  const at = (arr: readonly number[] | undefined) => arr?.map(conv)

  const [focus, setFocus] = createSignal<FocusBox | null>(null)
  createEffect(() => setFocus(focusOn(s().x, s().y, 50)))

  const events = createMemo(() => ops.events().filter(e => e.seenBy.some(x => x.sensorId === s().id)))
  const markers = createMemo(() => ops.markers().filter(m => m.sensorId === s().id || m.evidence?.sensorId === s().id))
  const windows = createMemo<ChartWindow[]>(() => [
    ...events().map(e => ({ from: e.fromSlot, to: 95, color: '#E0453A', label: e.kind === 'burst' ? 'Nghi vỡ ống' : 'Rò rỉ ngầm' })),
    ...markers()
      .filter(m => m.evidence)
      .map(m => ({ from: m.evidence!.fromSlot, to: m.evidence!.toSlot, color: MARKER_COLOR[m.kind], label: m.title })),
  ])
  const flags = createMemo<ChartFlag[]>(() =>
    markers().map(m => ({
      at: m.evidence?.fromSlot ?? 0,
      color: MARKER_COLOR[m.kind],
      label: `${MARKER_KIND_LABEL[m.kind]}: ${m.title}`,
      onClick: () => props.go({ name: 'leaks', marker: m.id }),
    }))
  )
  const lines = createMemo<ChartLine[]>(() => {
    const ser = series()
    if (!ser) return []
    const out: ChartLine[] = []
    if (ser.yesterday) out.push({ label: 'Hôm qua', values: at(ser.yesterday)!, color: 'var(--muted)', width: 1.4, faint: true })
    out.push({ label: 'Hôm nay', values: at(ser.values)!, color: '#1D6CAE', width: 2.2 })
    return out
  })
  const refs = createMemo(() => {
    const ser = series()
    const out: Array<{ label: string; value: number; color: string }> = []
    if (ser?.low !== undefined) out.push({ label: `Tối thiểu ${fmt(conv(ser.low))}`, value: conv(ser.low), color: '#C0392B' })
    if (ser?.high !== undefined) out.push({ label: `Tối đa ${fmt(conv(ser.high))}`, value: conv(ser.high), color: '#C0392B' })
    return out
  })
  const status = () => ops.status()[s().id] ?? 'offline'
  const valueNow = () => {
    const ser = series()
    const v = ser?.values[ops.slot()]
    return v === undefined ? '—' : `${fmt(conv(v))} ${unit()}`
  }
  const summary = createMemo(() => summarize(s(), series()))
  const inCompare = () => compare().includes(s().id)

  const markHere = async () => {
    const slot = ops.slot()
    const m = await ops.addMarker({
      kind: 'suspected_leak',
      title: `Đánh dấu tại ${s().name} lúc ${slotTime(slot)}`,
      ...(s().dma ? { dma: s().dma } : {}),
      x: s().x,
      y: s().y,
      sensorId: s().id,
      evidence: { sensorId: s().id, fromSlot: Math.max(0, slot - 4), toSlot: Math.min(95, slot + 4) },
    })
    props.toast(`Đã tạo điểm đánh dấu ${m.id}`, 'success')
  }

  return (
    <>
      <MapOverlay focus={focus()} layers={{ device: true }} />
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate text-[15px] font-semibold">{s().name}</div>
          <div class="text-[11.5px] text-[color:var(--muted)]">
            {KIND_LABEL[s().kind]} · {s().dma ?? 'Nhà máy'} · {s().id}
            {s().critical ? ' · điểm bất lợi' : ''}
          </div>
        </div>
        <button type="button" class="ops-row border border-line text-[12px]" style={{ width: "auto", "flex-shrink": 0 }} onClick={() => props.go({ name: "sensor" })}>
          Đổi cảm biến
        </button>
      </div>
      <div class="flex items-center gap-2">
        <StatusChip status={status()} />
        <span class="font-mono text-[18px] font-semibold">{valueNow()}</span>
        <span class="text-[11px] text-[color:var(--muted)]">lúc {slotTime(ops.slot())}</span>
      </div>

      <Show when={series()} fallback={<div class="text-[12px] text-[color:var(--muted)]">Chưa có số đọc.</div>}>
        {ser => (
          <div class="rounded-lg border border-line p-2" data-testid="sensor-chart">
            <TimeChart
              n={96}
              perHour={4}
              lines={lines()}
              {...(ser().p10 && ser().p90
                ? { band: { label: 'Đường nền p10–p90', lo: at(ser().p10)!, hi: at(ser().p90)!, mid: at(ser().p50)!, color: '#2FB36B' } }
                : {})}
              refs={refs()}
              windows={windows()}
              flags={flags()}
              cursor={ops.slot()}
              onCursor={i => {
                ops.setPlaying(false)
                ops.setSlot(i)
              }}
              unit={unit()}
              height={230}
              format={v => fmt(v)}
              ariaLabel={`Số đọc 24 giờ của ${s().name}`}
            />
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--muted)]">
              <span><span class="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: '#1D6CAE' }} />Hôm nay</span>
              <Show when={ser().p10}>
                <span><span class="mr-1 inline-block h-2 w-3 align-middle opacity-40" style={{ background: '#2FB36B' }} />Đường nền</span>
              </Show>
              <Show when={ser().yesterday}>
                <span><span class="mr-1 inline-block h-0.5 w-3 align-middle opacity-50" style={{ background: 'var(--muted)' }} />Hôm qua</span>
              </Show>
              <Show when={ser().values.length < 96}>
                <span style={{ color: STATUS_COLOR.offline }}>Mất dữ liệu từ {slotTime(ser().values.length)}</span>
              </Show>
              <Show when={s().kind === 'pressure'}>
                <button type="button" class="ml-auto underline" onClick={() => setHead(h => !h)}>
                  {head() ? 'Hiện áp lực (bar)' : 'Hiện cột áp (m)'}
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>

      <div class="ops-sec">Tổng hợp trong ngày</div>
      <div class="grid grid-cols-3 gap-1.5" data-testid="sensor-summary">
        <For each={summary()}>
          {row => (
            <div class="rounded-lg border border-line px-2 py-1.5">
              <div class="text-[10.5px] text-[color:var(--muted)]">{row.label}</div>
              <div class="font-mono text-[14px] font-semibold">{row.value}</div>
            </div>
          )}
        </For>
      </div>

      <div class="mt-1 flex flex-wrap gap-2">
        <button type="button" class="ops-row w-auto border border-line" onClick={() => void markHere()}>
          Đánh dấu tại đây ({slotTime(ops.slot())})
        </button>
        <button
          type="button"
          class="ops-row w-auto border border-line"
          onClick={() => setCompare(c => (inCompare() ? c.filter(x => x !== s().id) : [...c, s().id].slice(-6)))}
        >
          {inCompare() ? 'Bỏ khỏi so sánh' : 'Thêm vào so sánh'}
        </button>
      </div>

      <Show when={compare().length > 1}>
        <CompareChart ids={compare()} />
      </Show>

      <Show when={markers().length}>
        <div class="ops-sec">Điểm đánh dấu liên quan</div>
        <For each={markers()}>
          {m => (
            <button type="button" class="ops-row" onClick={() => props.go({ name: 'leaks', marker: m.id })}>
              <span class="inline-block h-2.5 w-2.5 rotate-45" style={{ background: MARKER_COLOR[m.kind] }} />
              <span class="min-w-0 flex-1 truncate">{m.title}</span>
            </button>
          )}
        </For>
      </Show>

      <div class="ops-sec">Thông tin cảm biến</div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt class="text-[color:var(--muted)]">Gắn trên</dt>
        <dd class="font-mono">{s().hostPipeId ?? s().hostNodeId ?? '—'}</dd>
        <dt class="text-[color:var(--muted)]">Đơn vị · chu kỳ</dt>
        <dd>
          {series()?.unit ?? s().unit} · {series()?.intervalMin ?? 15} phút
        </dd>
        <Show when={s().low !== undefined || s().high !== undefined}>
          <dt class="text-[color:var(--muted)]">Ngưỡng</dt>
          <dd>
            {s().low ?? '—'} – {s().high ?? '—'} {s().unit}
          </dd>
        </Show>
        <Show when={elevation() !== undefined}>
          <dt class="text-[color:var(--muted)]">Cao độ</dt>
          <dd>{elevation()!.toFixed(1)} m</dd>
        </Show>
      </dl>
    </>
  )
}

function CompareChart(props: { ids: string[] }): JSX.Element {
  const ops = useOps()
  const unitGroups = createMemo(() => {
    const first = ops.sensorById().get(props.ids[0]!)
    return props.ids.filter(id => ops.sensorById().get(id)?.unit === first?.unit)
  })
  const lines = createMemo<ChartLine[]>(() =>
    unitGroups().map((id, i) => ({
      label: ops.sensorById().get(id)?.name ?? id,
      values: ops.series()[id]?.values ?? [],
      color: COMPARE_COLORS[i % COMPARE_COLORS.length]!,
      width: 1.8,
    }))
  )
  return (
    <>
      <div class="ops-sec">So sánh ({unitGroups().length})</div>
      <div class="rounded-lg border border-line p-2">
        <TimeChart
          n={96}
          perHour={4}
          lines={lines()}
          cursor={ops.slot()}
          onCursor={i => ops.setSlot(i)}
          unit={ops.sensorById().get(props.ids[0]!)?.unit ?? ''}
          height={180}
          ariaLabel="So sánh cảm biến"
        />
        <div class="mt-1 flex flex-wrap gap-x-3 text-[11px]">
          <For each={lines()}>
            {l => (
              <span>
                <span class="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: l.color }} />
                {l.label}
              </span>
            )}
          </For>
          <button type="button" class="ml-auto underline" onClick={() => setCompare([])}>
            Xoá so sánh
          </button>
        </div>
      </div>
    </>
  )
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2))

/** Daily summary: pressure min/max/mean, time below minimum, night pressure; flow volume, peak, night flow; level range and drift. */
export function summarize(s: OpsSensor, ser: OpsSeries | undefined): Array<{ label: string; value: string }> {
  if (!ser || !ser.values.length) return []
  const v = ser.values
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const night = v.slice(8, 16)
  const nightMean = night.length ? night.reduce((a, b) => a + b, 0) / night.length : NaN
  if (s.kind === 'pressure') {
    const below = ser.low !== undefined ? v.filter(x => x < ser.low!).length * 15 : 0
    return [
      { label: 'Thấp nhất', value: `${fmt(Math.min(...v))} bar` },
      { label: 'Cao nhất', value: `${fmt(Math.max(...v))} bar` },
      { label: 'Trung bình', value: `${fmt(mean)} bar` },
      { label: 'Dưới tối thiểu', value: `${below} phút` },
      { label: 'Áp lực đêm 02–04h', value: Number.isFinite(nightMean) ? `${fmt(nightMean)} bar` : '—' },
      { label: 'Số đọc', value: `${v.length}/96` },
    ]
  }
  if (s.kind === 'flow') {
    return [
      { label: 'Tổng lượng nước', value: `${Math.round(mean * 24).toLocaleString('vi-VN')} m³` },
      { label: 'Cao điểm', value: `${fmt(Math.max(...v))} m³/h` },
      { label: 'Đêm nhỏ nhất 02–04h', value: `${fmt(Math.min(...night))} m³/h` },
      { label: 'Trung bình', value: `${fmt(mean)} m³/h` },
      { label: 'Thấp nhất', value: `${fmt(Math.min(...v))} m³/h` },
      { label: 'Số đọc', value: `${v.length}/96` },
    ]
  }
  return [
    { label: 'Thấp nhất', value: `${fmt(Math.min(...v))} m` },
    { label: 'Cao nhất', value: `${fmt(Math.max(...v))} m` },
    { label: 'Cuối ngày − đầu ngày', value: `${fmt(v[v.length - 1]! - v[0]!)} m` },
  ]
}
