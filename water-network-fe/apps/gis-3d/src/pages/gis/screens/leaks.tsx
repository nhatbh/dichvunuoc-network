/* Rò rỉ & bảo trì — where water is being lost and what is being done about it: the marker queue with
   each marker's evidence and lifecycle, and the DMAs ranked by night flow above their baseline. */
import { For, Show, createEffect, createMemo, createSignal, untrack, type JSX } from 'solid-js'
import { MARKER_KIND_LABEL, MARKER_MOVES, MARKER_STATE_LABEL, isOpen } from '@/shared/api/ops-markers'
import type { MarkerState, OpsDmaBalance, OpsMarker } from '@/shared/api/ops-types'
import { MARKER_COLOR, focusOn, markerPins } from './ops'
import { useGis } from '../lib/gis-data'
import { slotTime, useOps } from '../ops/ops-context'
import { Sparkline, TimeChart } from '../ops/time-chart'
import { MapOverlay } from '../shell/map-stage'
import { Btn, SegToggle } from '../ui/kit'
import type { Route } from '../shell/nav'
import type { FocusBox } from '../ui/network-map'

const SEVERITY_LABEL = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' } as const
const SEVERITY_RANK = { high: 2, medium: 1, low: 0 } as const
const STATE_ORDER: MarkerState[] = ['suspected', 'under_review', 'work_ordered', 'repaired', 'closed', 'rejected']

export function LeaksScreen(props: { markerId?: string; go: (r: Route) => void; toast: (m: string, k?: string) => void }): JSX.Element {
  const ops = useOps()
  const [tab, setTab] = createSignal<'markers' | 'dma'>('markers')
  const [selected, setSelected] = createSignal<string | null>(untrack(() => props.markerId) ?? null)
  createEffect(() => {
    if (props.markerId) {
      setSelected(props.markerId)
      setTab('markers')
    }
  })
  const [focus, setFocus] = createSignal<FocusBox | null>(null)
  const [dmaSel, setDmaSel] = createSignal<string | null>(null)
  const G = useGis()
  const pick = (m: OpsMarker) => {
    setSelected(m.id)
    setTab('markers')
    setFocus(focusOn(m.x, m.y))
  }
  createEffect(() => {
    const id = selected()
    const m = id ? ops.markers().find(x => x.id === id) : undefined
    if (m) setFocus(focusOn(m.x, m.y))
  })
  const pins = createMemo(() => markerPins(ops.markers(), selected(), pick))
  const emphasis = createMemo(() => {
    const d = dmaSel()
    return d && tab() === 'dma' ? { dim: true, pipes: G.pipes.filter(p => p.dma === d).map(p => p.id) } : null
  })

  return (
    <div class="flex flex-col gap-2 text-[13px]" data-screen-label="Rò rỉ & bảo trì" data-testid="leaks-panel">
      <MapOverlay pins={pins()} focus={focus()} emphasis={emphasis()} />
      <SegToggle
        options={[
          { id: 'markers', label: 'Điểm đánh dấu' },
          { id: 'dma', label: 'Cân bằng nước DMA' },
        ]}
        value={tab()}
        onChange={v => setTab(v as 'markers' | 'dma')}
      />
      <Show when={tab() === 'markers'} fallback={<DmaBalance selected={dmaSel()} onSelect={setDmaSel} />}>
        <MarkerQueue selected={selected()} onSelect={pick} />
        <Show when={ops.markers().find(m => m.id === selected())}>
          {m => <MarkerDetail marker={m()} go={props.go} toast={props.toast} />}
        </Show>
      </Show>
    </div>
  )
}

function MarkerQueue(props: { selected: string | null; onSelect: (m: OpsMarker) => void }): JSX.Element {
  const ops = useOps()
  const [kind, setKind] = createSignal<'all' | OpsMarker['kind']>('all')
  const [showClosed, setShowClosed] = createSignal(false)
  const [dma, setDma] = createSignal('all')
  const dmas = createMemo(() => [...new Set(ops.markers().map(m => m.dma).filter(Boolean) as string[])].sort())
  const rows = createMemo(() =>
    ops
      .markers()
      .filter(m => (kind() === 'all' || m.kind === kind()) && (dma() === 'all' || m.dma === dma()) && (showClosed() || isOpen(m)))
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          (b.lossM3d ?? 0) - (a.lossM3d ?? 0) ||
          STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
      )
  )
  return (
    <>
      <div class="flex flex-wrap items-center gap-2 text-[12px]">
        <select class="rounded-md border border-line bg-transparent px-1.5 py-1" value={kind()} onChange={e => setKind(e.currentTarget.value as never)} aria-label="Loại">
          <option value="all">Mọi loại</option>
          <For each={Object.entries(MARKER_KIND_LABEL)}>{([k, l]) => <option value={k}>{l}</option>}</For>
        </select>
        <select class="rounded-md border border-line bg-transparent px-1.5 py-1" value={dma()} onChange={e => setDma(e.currentTarget.value)} aria-label="DMA">
          <option value="all">Mọi DMA</option>
          <For each={dmas()}>{d => <option value={d}>{d}</option>}</For>
        </select>
        <label class="flex items-center gap-1">
          <input type="checkbox" checked={showClosed()} onChange={e => setShowClosed(e.currentTarget.checked)} />
          Cả đã đóng
        </label>
        <span class="ml-auto text-[color:var(--muted)]">{rows().length} điểm</span>
      </div>
      <div class="max-h-[260px] overflow-auto rounded-lg border border-line">
        <table class="ops-table" data-testid="marker-queue">
          <thead>
            <tr>
              <th>Điểm đánh dấu</th>
              <th>Trạng thái</th>
              <th>Mức</th>
              <th>Thất thoát (m³/ngày)</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {m => (
                <tr
                  class="cursor-pointer"
                  style={{ background: m.id === props.selected ? 'var(--hover)' : undefined }}
                  onClick={() => props.onSelect(m)}
                  data-marker={m.id}
                >
                  <td>
                    <span class="mr-1.5 inline-block h-2 w-2 rotate-45" style={{ background: MARKER_COLOR[m.kind] }} />
                    <span class="font-medium">{m.title}</span>
                    <div class="text-[10.5px] text-[color:var(--muted)]">
                      {MARKER_KIND_LABEL[m.kind]} · {m.dma ?? '—'} · {m.origin === 'auto' ? 'tự động' : 'thủ công'}
                    </div>
                  </td>
                  <td>{MARKER_STATE_LABEL[m.state]}</td>
                  <td>{SEVERITY_LABEL[m.severity]}</td>
                  <td>{m.lossM3d ?? '—'}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </>
  )
}

function MarkerDetail(props: { marker: OpsMarker; go: (r: Route) => void; toast: (m: string, k?: string) => void }): JSX.Element {
  const ops = useOps()
  const m = () => props.marker
  const sensor = () => (m().evidence ? ops.sensorById().get(m().evidence!.sensorId) : undefined)
  const series = () => (m().evidence ? ops.series()[m().evidence!.sensorId] : undefined)
  const [busy, setBusy] = createSignal(false)
  const doMove = async (action: (typeof MARKER_MOVES)[MarkerState][number]) => {
    setBusy(true)
    try {
      await ops.moveMarker(m().id, action.action)
      props.toast(`${m().title}: ${MARKER_STATE_LABEL[action.to]}`, 'success')
    } catch {
      props.toast('Không chuyển được trạng thái', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="rounded-lg border border-line p-2.5" data-testid="marker-detail">
      <div class="flex items-start gap-2">
        <span class="mt-1 inline-block h-3 w-3 rotate-45" style={{ background: MARKER_COLOR[m().kind] }} />
        <div class="min-w-0 flex-1">
          <div class="font-semibold">{m().title}</div>
          <div class="text-[11.5px] text-[color:var(--muted)]">
            {MARKER_KIND_LABEL[m().kind]} · {MARKER_STATE_LABEL[m().state]} · {m().dma ?? '—'}
            {m().gisRef ? ` · tại ${m().gisRef}` : ''}
          </div>
        </div>
        <Show when={m().lossM3d}>
          <div class="text-right">
            <div class="font-mono text-[16px] font-semibold">{m().lossM3d}</div>
            <div class="text-[10.5px] text-[color:var(--muted)]">m³/ngày ước tính</div>
          </div>
        </Show>
      </div>

      <Show when={series() && sensor()}>
        <div class="mt-2">
          <div class="mb-1 flex items-center justify-between text-[11.5px] text-[color:var(--muted)]">
            <span>Bằng chứng: {sensor()!.name}</span>
            <button type="button" class="underline" onClick={() => props.go({ name: 'sensor', sensor: sensor()!.id })}>
              Mở biểu đồ
            </button>
          </div>
          <TimeChart
            n={96}
            perHour={4}
            lines={[
              ...(series()!.yesterday ? [{ label: 'Hôm qua', values: series()!.yesterday!, color: 'var(--muted)', width: 1.2, faint: true }] : []),
              { label: 'Hôm nay', values: series()!.values, color: '#1D6CAE', width: 2 },
            ]}
            {...(series()!.p10 && series()!.p90
              ? { band: { label: 'Đường nền', lo: series()!.p10!, hi: series()!.p90!, mid: series()!.p50!, color: '#2FB36B' } }
              : {})}
            windows={[{ from: m().evidence!.fromSlot, to: m().evidence!.toSlot, color: MARKER_COLOR[m().kind], label: 'Cửa sổ bằng chứng' }]}
            cursor={ops.slot()}
            onCursor={i => ops.setSlot(i)}
            unit={series()!.unit}
            height={160}
            ariaLabel={`Bằng chứng cho ${m().title}`}
          />
        </div>
      </Show>

      <div class="mt-2 flex flex-wrap gap-2" data-testid="marker-actions">
        <For each={MARKER_MOVES[m().state]}>
          {a => (
            <Btn size="sm" variant={a.action === 'reject' || a.action === 'rework' ? 'default' : 'primary'} disabled={busy()} onClick={() => void doMove(a)}>
              {a.label}
            </Btn>
          )}
        </For>
        <Show when={!MARKER_MOVES[m().state].length}>
          <span class="text-[12px] text-[color:var(--muted)]">Đã kết thúc.</span>
        </Show>
      </div>

      <div class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <span class="text-[color:var(--muted)]">Người phụ trách</span>
        <span>{m().assignee ?? '—'}</span>
        <span class="text-[color:var(--muted)]">Lệnh công việc</span>
        <span class="font-mono">{m().workOrderRef ?? '—'}</span>
      </div>
      <div class="ops-sec">Lịch sử</div>
      <ol class="flex flex-col gap-0.5 text-[12px]">
        <For each={m().history}>
          {h => (
            <li class="flex gap-2">
              <span class="font-mono text-[color:var(--muted)]">{timeOf(h.at)}</span>
              <span class="font-medium">{MARKER_STATE_LABEL[h.state]}</span>
              <span class="text-[color:var(--muted)]">
                {h.by}
                {h.note ? ` · ${h.note}` : ''}
              </span>
            </li>
          )}
        </For>
      </ol>
    </div>
  )
}

const timeOf = (iso: string) => {
  const m = /T(\d{2}:\d{2})/.exec(iso)
  return m ? m[1] : iso
}

function DmaBalance(props: { selected: string | null; onSelect: (id: string | null) => void }): JSX.Element {
  const ops = useOps()
  // ranked by night flow above its baseline (the classic leak signal), then by inflow
  const rows = createMemo(() =>
    [...ops.dmaBalance()].sort(
      (a, b) => b.mnfLps - b.mnfBaselineLps - (a.mnfLps - a.mnfBaselineLps) || b.inflowM3d - a.inflowM3d
    )
  )
  const sel = createMemo(() => rows().find(r => r.id === props.selected))
  return (
    <>
      <div class="text-[12px] text-[color:var(--muted)]">
        Lượng vào = sử dụng + thay đổi bể chứa. Xếp theo lưu lượng đêm vượt đường nền.
      </div>
      <div class="overflow-auto rounded-lg border border-line">
        <table class="ops-table" data-testid="dma-balance">
          <thead>
            <tr>
              <th>DMA</th>
              <th>Vào (m³/ngày)</th>
              <th>Sử dụng</th>
              <th>Bể chứa</th>
              <th>Đêm (L/s)</th>
              <th>Vượt nền</th>
              <th>Lưu lượng vào 24h</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {d => {
                const excess = () => d.mnfLps - d.mnfBaselineLps
                return (
                  <tr
                    class="cursor-pointer"
                    style={{ background: d.id === props.selected ? 'var(--hover)' : undefined }}
                    onClick={() => props.onSelect(d.id === props.selected ? null : d.id)}
                    data-dma={d.id}
                  >
                    <td class="font-medium">{d.id}</td>
                    <td>{d.inflowM3d.toLocaleString('vi-VN')}</td>
                    <td>{d.useM3d.toLocaleString('vi-VN')}</td>
                    <td>{d.storageM3d > 0 ? '+' : ''}{d.storageM3d.toLocaleString('vi-VN')}</td>
                    <td>{d.mnfLps.toFixed(1)}</td>
                    <td style={{ color: excess() > 0.5 ? '#E0453A' : undefined, 'font-weight': excess() > 0.5 ? 600 : undefined }}>
                      {excess() > 0.05 ? `+${excess().toFixed(1)}` : '0'}
                    </td>
                    <td>
                      <Sparkline values={d.inflowLps} color={excess() > 0.5 ? '#E0453A' : '#1D6CAE'} />
                    </td>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={sel()}>{d => <DmaDetail d={d()} />}</Show>
    </>
  )
}

function DmaDetail(props: { d: OpsDmaBalance }): JSX.Element {
  const ops = useOps()
  const open = createMemo(() => ops.markers().filter(m => m.dma === props.d.id && isOpen(m)))
  return (
    <div class="rounded-lg border border-line p-2.5">
      <div class="mb-1 font-semibold">{props.d.id}: lưu lượng theo giờ</div>
      <TimeChart
        n={24}
        perHour={1}
        lines={[
          { label: 'Vào DMA', values: props.d.inflowLps, color: '#1D6CAE', width: 2 },
          { label: 'Sử dụng + rò rỉ', values: props.d.useLps, color: '#D86C1F', width: 1.6, dash: '4 3' },
          { label: 'Vào bể chứa', values: props.d.storageLps, color: '#8250DF', width: 1.4 },
        ]}
        refs={[{ label: `Đêm nền ${props.d.mnfBaselineLps.toFixed(1)} L/s`, value: props.d.mnfBaselineLps, color: '#2FA06B' }]}
        cursor={ops.slot() / 4}
        unit="L/s"
        height={170}
        ariaLabel={`Cân bằng nước ${props.d.id}`}
      />
      <div class="mt-1 text-[12px] text-[color:var(--muted)]">
        Áp lực thấp nhất lúc 08:00: {props.d.minPressureM.toFixed(1)} m · {open().length} điểm đánh dấu đang mở
        {open().length ? `: ${open().map(m => m.title).join(', ')}` : ''}
      </div>
      <div class="mt-0.5 text-[11px] text-[color:var(--muted)]">Giờ đang chọn: {slotTime(ops.slot())}</div>
    </div>
  )
}
