/* Kế hoạch sản xuất — how much to produce tomorrow, hour by hour, and at what outlet pressure.
   Advice only: the planner edits and accepts the schedule; nothing is sent to SCADA. */
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { opsApi } from '@/shared/api/ops-client'
import type { OpsPlanHour, OpsProduction } from '@/shared/api/ops-types'
import { useOps } from '../ops/ops-context'
import { TimeChart } from '../ops/time-chart'
import { Btn } from '../ui/kit'

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0)
const fmt0 = (v: number) => Math.round(v).toLocaleString('vi-VN')
const dmy = (iso: string) => iso.split('-').reverse().join('/')

export function ProductionScreen(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const ops = useOps()
  return (
    <div class="flex flex-col gap-2 text-[13px]" data-screen-label="Kế hoạch sản xuất" data-testid="production-panel">
      <Show when={ops.production()} fallback={<div class="text-[12px] text-[color:var(--muted)]">Đang tải…</div>}>
        {p => <Production p={p()} toast={props.toast} />}
      </Show>
    </div>
  )
}

function Production(props: { p: OpsProduction; toast: (m: string, k?: string) => void }): JSX.Element {
  const ops = useOps()
  const p = () => props.p
  const [plan, setPlan] = createSignal<OpsPlanHour[]>(p().plan.map(h => ({ ...h })))
  createEffect(() => setPlan(p().plan.map(h => ({ ...h }))))
  const changed = createMemo(() => plan().filter((h, i) => h.flowM3h !== p().plan[i]!.flowM3h || h.setpointBar !== p().plan[i]!.setpointBar).length)
  const total = createMemo(() => sum(plan().map(h => h.flowM3h)))
  const forecastTotal = createMemo(() => sum(p().forecastM3h))
  const peak = createMemo(() => {
    const f = p().forecastM3h
    const i = f.indexOf(Math.max(...f))
    return { hour: i, m3h: f[i]! }
  })
  const edit = (i: number, key: 'flowM3h' | 'setpointBar', value: number) => {
    if (!Number.isFinite(value)) return
    setPlan(rows =>
      rows.map((h, k) => {
        if (k !== i) return h
        const next = { ...h, [key]: value }
        if (key === 'flowM3h') next.pumpsOn = Math.max(1, Math.ceil(value / p().pumpRatedM3h))
        // lowering the setpoint lowers the critical points by the same amount
        if (key === 'setpointBar') next.criticalMinBar = Math.round((h.criticalMinBar + (value - h.setpointBar)) * 100) / 100
        return next
      })
    )
  }
  const accept = async () => {
    await opsApi.savePlan({ date: p().planDate, plan: plan() })
    props.toast(`Đã lưu kế hoạch ngày ${dmy(p().planDate)}`, 'success')
  }
  const belowMin = (bar: number) => bar < p().serviceMinBar + 1e-9
  const tightMargin = (bar: number) => bar < p().serviceMinBar + p().marginBar - 1e-9

  return (
    <>
      {/* 1. tomorrow's demand */}
      <div class="flex items-end justify-between">
        <div>
          <div class="text-[11px] text-[color:var(--muted)]">Dự báo nhu cầu ngày {dmy(p().planDate)}</div>
          <div class="font-mono text-[22px] font-semibold leading-tight" data-testid="forecast-total">
            {fmt0(forecastTotal())} <span class="text-[12px] font-normal text-[color:var(--muted)]">m³/ngày</span>
          </div>
        </div>
        <div class="text-right text-[11.5px] text-[color:var(--muted)]">
          Cao điểm {String(peak().hour).padStart(2, '0')}h · {fmt0(peak().m3h)} m³/h
          <br />
          Sai số dự báo gần đây (MAPE) {p().mapePct.toFixed(1)} %
        </div>
      </div>
      <div class="rounded-lg border border-line p-2">
        <TimeChart
          n={24}
          perHour={1}
          lines={[
            ...p().history.map(h => ({ label: h.label, values: h.m3h, color: 'var(--muted)', width: 1, faint: true })),
            { label: 'Hôm nay (đo)', values: p().demandM3h, color: '#D86C1F', width: 1.6, dash: '4 3' },
            { label: 'Dự báo', values: p().forecastM3h, color: '#1D6CAE', width: 2.2 },
          ]}
          band={{ label: 'Khoảng dự báo ±6 %', lo: p().forecastLoM3h, hi: p().forecastHiM3h, color: '#1D6CAE' }}
          unit="m³/h"
          height={190}
          format={v => fmt0(v)}
          ariaLabel="Dự báo nhu cầu theo giờ"
        />
        <div class="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[color:var(--muted)]">
          <span><span class="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: '#1D6CAE' }} />Dự báo</span>
          <span><span class="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: '#D86C1F' }} />Hôm nay (đo)</span>
          <span><span class="mr-1 inline-block h-0.5 w-3 align-middle opacity-50" style={{ background: 'var(--muted)' }} />Cùng thứ, 4 tuần trước</span>
        </div>
      </div>

      {/* 2. recommended schedule */}
      <div class="ops-sec flex items-center justify-between">
        <span>Lịch đề xuất · {changed()} giờ đã sửa</span>
        <span class="font-mono normal-case tracking-normal text-[color:var(--ink)]" data-testid="plan-total">
          {fmt0(total())} m³/ngày
        </span>
      </div>
      <div class="max-h-[300px] overflow-auto rounded-lg border border-line">
        <table class="ops-table" data-testid="plan-table">
          <thead>
            <tr>
              <th>Giờ</th>
              <th>Sản xuất (m³/h)</th>
              <th>Áp lực đầu ra (bar)</th>
              <th>Bơm chạy</th>
              <th>Bể chứa</th>
              <th>Điểm bất lợi (bar)</th>
            </tr>
          </thead>
          <tbody>
            <For each={plan()}>
              {(h, i) => (
                <tr data-changed={h.flowM3h !== p().plan[i()]!.flowM3h || h.setpointBar !== p().plan[i()]!.setpointBar ? 'true' : undefined}>
                  <td class="font-mono">{String(h.hour).padStart(2, '0')}:00</td>
                  <td>
                    <input
                      type="number"
                      step="10"
                      value={h.flowM3h}
                      aria-label={`Sản xuất ${h.hour}h`}
                      onChange={e => edit(i(), 'flowM3h', Number(e.currentTarget.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.05"
                      value={h.setpointBar}
                      aria-label={`Áp lực đầu ra ${h.hour}h`}
                      onChange={e => edit(i(), 'setpointBar', Number(e.currentTarget.value))}
                    />
                  </td>
                  <td>{h.pumpsOn}</td>
                  <td>{h.reservoir === 'fill' ? 'Nạp' : h.reservoir === 'supply' ? 'Cấp' : 'Giữ'}</td>
                  <td style={{ color: belowMin(h.criticalMinBar) ? '#E0453A' : tightMargin(h.criticalMinBar) ? '#B07A00' : undefined }}>
                    {h.criticalMinBar.toFixed(2)}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <div class="flex items-center gap-2 text-[11.5px] text-[color:var(--muted)]">
        <span class="flex-1">
          Áp lực đầu ra được hạ đến mức điểm bất lợi còn {p().serviceMinBar.toFixed(1)} bar + {p().marginBar.toFixed(1)} bar dự phòng. Chỉ là đề xuất: không gửi xuống SCADA.
        </span>
        <Btn size="sm" variant="default" disabled={!changed()} onClick={() => setPlan(p().plan.map(h => ({ ...h })))}>
          Khôi phục
        </Btn>
        <Btn size="sm" variant="primary" onClick={() => void accept()}>
          Chấp nhận kế hoạch
        </Btn>
      </div>

      {/* 3. today: plan vs actual */}
      <div class="ops-sec">Hôm nay: kế hoạch và thực tế</div>
      <div class="rounded-lg border border-line p-2">
        <TimeChart
          n={24}
          perHour={1}
          lines={[
            { label: 'Kế hoạch', values: p().today.plannedFlowM3h, color: 'var(--muted)', width: 1.6, dash: '4 3' },
            { label: 'Thực tế', values: p().today.actualFlowM3h, color: '#1D6CAE', width: 2.2 },
          ]}
          cursor={ops.slot() / 4}
          unit="m³/h"
          height={150}
          format={v => fmt0(v)}
          ariaLabel="Sản xuất kế hoạch và thực tế"
        />
        <TimeChart
          n={24}
          perHour={1}
          lines={[
            { label: 'Áp lực đầu ra', values: p().today.outletBar, color: '#1D6CAE', width: 2 },
            { label: 'Điểm bất lợi thấp nhất', values: p().today.criticalMinBar, color: '#D86C1F', width: 2 },
          ]}
          refs={[{ label: `Tối thiểu ${p().serviceMinBar.toFixed(1)} bar`, value: p().serviceMinBar, color: '#C0392B' }]}
          windows={p()
            .today.criticalMinBar.map((v, h) => ({ v, h }))
            .filter(x => belowMin(x.v))
            .map(x => ({ from: x.h, to: x.h + 1, color: '#E0453A', label: 'Dưới áp lực tối thiểu' }))}
          cursor={ops.slot() / 4}
          unit="bar"
          height={150}
          yMin={0}
          ariaLabel="Áp lực đầu ra và điểm bất lợi"
        />
        <div class="mt-1 text-[11.5px] text-[color:var(--muted)]" data-testid="red-hours">
          {(() => {
            const n = p().today.criticalMinBar.filter(belowMin).length
            return n ? `${n} giờ điểm bất lợi dưới tối thiểu` : 'Không giờ nào điểm bất lợi xuống dưới tối thiểu.'
          })()}
        </div>
      </div>

      <div class="ops-sec">Chỉ số ngày {dmy(p().date)}</div>
      <div class="grid grid-cols-4 gap-1.5 text-[11px]">
        <Kpi label="Sản xuất" value={`${fmt0(p().kpis.productionM3d)} m³`} />
        <Kpi label="Tiêu thụ" value={`${fmt0(p().kpis.consumptionM3d)} m³`} />
        <Kpi label="Thất thoát (NRW)" value={`${p().kpis.nrwPct.toFixed(1)} %`} />
        <Kpi label="Áp lực trung vị" value={`${p().kpis.avgPressureBar.toFixed(2)} bar`} />
      </div>
    </>
  )
}

function Kpi(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="rounded-lg border border-line px-2 py-1.5">
      <div class="text-[color:var(--muted)]">{props.label}</div>
      <div class="font-mono text-[13px] font-semibold">{props.value}</div>
    </div>
  )
}
