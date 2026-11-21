/**
 * SCADA faceplate built from Siemens iX components: state pills, key/value readings, AUTO/MAN toggle, commands
 * with a confirmation step (as on a real SCADA), setpoint slider, catalog identity, fault simulation.
 */
import { iconClose, iconPlay, iconRefresh, iconStop, iconWarning } from '@siemens/ix-icons/icons'
import { getCatalogItem } from '@wn/component-models'
import { createSignal, For, Show } from 'solid-js'
import { EQUIPMENT_BY_TAG, UNITS } from '../../data/plant-model'
import { fmtClock, PHASE_LABEL } from '../../sim/plant-sim'
import { CatalogIcon } from '../catalog-info'
import { stateOf } from '../faceplate'
import { f1, f2, useSim } from '../sim-context'

type Cmd = 'start' | 'stop' | 'open' | 'close' | 'wash' | 'auto' | 'man' | 'sp' | 'reset' | 'fault'
const CMD_VI: Partial<Record<Cmd, string>> = { start: 'CHẠY', stop: 'DỪNG', open: 'MỞ VAN', close: 'ĐÓNG VAN', wash: 'RỬA LỌC', sp: 'ĐẶT GIÁ TRỊ' }

export function IxFaceplate(props: { tag: string; onClose: () => void }) {
  const { sim, v } = useSim()
  const e = () => EQUIPMENT_BY_TAG[props.tag]!
  const d = () => (v(), sim.dev[props.tag]!)
  const st = () => stateOf(d(), e())
  const auto = () => d().mode === 'auto'
  const [pending, setPending] = createSignal<{ cmd: Cmd; value?: number } | null>(null)
  const run = (cmd: Cmd, value?: number) => sim.command(props.tag, cmd, value)
  const ask = (cmd: Cmd, value?: number) => setPending({ cmd, value })
  const ctrl = () => e().control
  const pill = () =>
    ({ run: ['success', 'ĐANG CHẠY'], man: ['warning', 'CHẠY · TAY'], stop: ['neutral', 'DỪNG'], fault: ['alarm', 'SỰ CỐ'], na: ['info', 'ĐO LƯỜNG'] })[st()] as [string, string]
  const slider = () => {
    const c = ctrl()
    if (c === 'pump' && e().kind === 'pump') return { label: 'Tần số biến tần (Hz)', min: 30, max: 50, step: 0.5 }
    if (c === 'mixer') return { label: 'Tốc độ (%)', min: 20, max: 100, step: 5 }
    if (c === 'dosing') return props.tag.includes('POL') ? { label: 'Liều lượng (mg/L)', min: 0, max: 1, step: 0.05 } : { label: 'Liều lượng (mg/L)', min: 0, max: 60, step: 0.5 }
    if (c === 'chlorinator') return { label: 'Lượng clo (kg/h)', min: 0, max: 5, step: 0.05 }
    return null
  }
  const [draft, setDraft] = createSignal<number | null>(null)
  return (
    <div class="hx-face">
      <div class="hx-face-head">
        <CatalogIcon code={e().code} size={34} />
        <div style={{ flex: 1, 'min-width': 0 }}>
          <ix-typography format="h4">{props.tag}</ix-typography>
          <ix-typography format="body-sm" text-color="soft">
            {e().name}
          </ix-typography>
        </div>
        <ix-icon-button icon={iconClose} variant="subtle-tertiary" size="24" onClick={() => props.onClose()} aria-label="Đóng" />
      </div>
      <div class="hx-row">
        <ix-pill variant={pill()[0]} outline>
          {e().kind === 'filter' ? PHASE_LABEL[d().phase] : e().kind === 'valve' ? (d().open > 0.98 ? 'MỞ' : d().open < 0.02 ? 'ĐÓNG' : 'ĐANG CHẠY VAN') : pill()[1]}
        </ix-pill>
        <Show when={ctrl()}>
          <ix-pill variant={auto() ? 'info' : 'warning'}>{auto() ? 'TỰ ĐỘNG' : 'TAY'}</ix-pill>
        </Show>
        <ix-pill variant="neutral" outline>
          {UNITS.find(u => u.id === e().unit)?.name ?? e().unit}
        </ix-pill>
      </div>
      <ix-typography format="body-xs" text-color="soft" class="hx-spec">
        {e().spec}
      </ix-typography>

      <ix-key-value-list striped>
        <For each={(v(), sim.readings(props.tag))}>{r => <ix-key-value label={r.k} value={`${r.v}${r.u ? ' ' + r.u : ''}`} class={r.warn ? 'hx-warn' : undefined} />}</For>
      </ix-key-value-list>

      <Show when={ctrl()}>
        <div class="hx-section">Điều khiển</div>
        <ix-toggle prop:checked={auto()} text-on="TỰ ĐỘNG" text-off="TAY" on:checkedChange={(ev: CustomEvent<boolean>) => run(ev.detail ? 'auto' : 'man')} />
        <div class="hx-row">
          <Show when={ctrl() === 'valve'}>
            <ix-button variant="primary" prop:disabled={auto() || d().target > 0.5} onClick={() => ask('open')}>
              Mở van
            </ix-button>
            <ix-button variant="danger-primary" prop:disabled={auto() || d().target < 0.5} onClick={() => ask('close')}>
              Đóng van
            </ix-button>
          </Show>
          <Show when={ctrl() === 'filter'}>
            <ix-button variant="primary" icon={iconRefresh} prop:disabled={d().phase !== 'filter'} onClick={() => ask('wash')}>
              Rửa lọc ngay
            </ix-button>
          </Show>
          <Show when={ctrl() !== 'valve' && ctrl() !== 'filter'}>
            <ix-button variant="primary" icon={iconPlay} prop:disabled={auto() || d().run || d().fault} onClick={() => ask('start')}>
              Chạy
            </ix-button>
            <ix-button variant="danger-primary" icon={iconStop} prop:disabled={auto() || !d().run} onClick={() => ask('stop')}>
              Dừng
            </ix-button>
          </Show>
        </div>
        <Show when={slider()}>
          {sl => (
            <div class="hx-slider">
              <div class="hx-row" style={{ 'justify-content': 'space-between' }}>
                <ix-typography format="label">{sl().label}</ix-typography>
                <ix-typography format="label" bold>
                  {(sl().step < 0.1 ? f2 : f1)(draft() ?? d().sp)}
                </ix-typography>
              </div>
              <ix-slider
                prop:min={sl().min}
                prop:max={sl().max}
                prop:step={sl().step}
                prop:value={draft() ?? d().sp}
                prop:disabled={auto()}
                on:valueChange={(ev: CustomEvent<number>) => setDraft(ev.detail)}
              />
              <Show when={draft() !== null && Math.abs((draft() ?? 0) - d().sp) > 1e-6}>
                <ix-button variant="secondary" onClick={() => ask('sp', draft()!)}>
                  Gửi giá trị đặt
                </ix-button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={auto()}>
          <ix-typography format="body-xs" text-color="soft">
            Chuyển sang TAY để điều khiển.
          </ix-typography>
        </Show>
      </Show>

      <Show when={pending()}>
        {p => (
          <div class="hx-confirm">
            <ix-typography format="label" bold>
              Xác nhận lệnh {CMD_VI[p().cmd] ?? p().cmd}
              {p().value !== undefined ? ` = ${p().value}` : ''} cho {props.tag}?
            </ix-typography>
            <div class="hx-row">
              <ix-button
                variant="primary"
                onClick={() => {
                  run(p().cmd, p().value)
                  setPending(null)
                  setDraft(null)
                }}
              >
                Thực hiện
              </ix-button>
              <ix-button variant="subtle-primary" onClick={() => setPending(null)}>
                Hủy
              </ix-button>
            </div>
          </div>
        )}
      </Show>

      <div class="hx-section">Danh mục thành phần</div>
      <ix-key-value-list>
        <ix-key-value label="Mã" value={e().code} />
        <ix-key-value label="Tên" value={getCatalogItem(e().code)?.vi ?? ''} />
        <Show when={e().dn}>
          <ix-key-value label="Kích thước" value={`DN${e().dn}`} />
        </Show>
      </ix-key-value-list>

      <div class="hx-section">Bảo trì & sự cố</div>
      <div class="hx-row">
        <Show
          when={d().fault}
          fallback={
            <ix-button variant="subtle-secondary" icon={iconWarning} onClick={() => run('fault')}>
              Mô phỏng sự cố
            </ix-button>
          }
        >
          <ix-button variant="primary" onClick={() => run('reset')}>
            Đặt lại sự cố
          </ix-button>
        </Show>
      </div>
      <For each={(v(), sim.alarms.filter(a => a.tag === props.tag).slice(0, 3))}>
        {a => (
          <ix-typography format="body-xs" text-color={a.active ? 'alarm' : 'soft'}>
            {fmtClock(a.t)} · {a.msg}
          </ix-typography>
        )}
      </For>
    </div>
  )
}
