/** Faceplate of one plant item: live readings, mode, commands, catalog identity, link to its HMI / SCADA screen. */
import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { CatalogBlock } from './catalog-info'
import { f0, f1, f2, useSim } from './sim-context'
import { Row } from './widgets'
import { EQUIPMENT_BY_TAG, UNITS, type Equipment, type HmiScreenId } from '../data/plant-model'
import { fmtClock, PHASE_LABEL, type DeviceState } from '../sim/plant-sim'

/** the HMI screen showing a unit */
export const UNIT_SCREEN: Record<string, HmiScreenId> = {
  TB1: 'tb1',
  S02: 'clarifier',
  S03: 'clarifier',
  S04: 'clarifier',
  S05: 'filters',
  S06: 'pumps',
  S07: 'pumps',
  S07B: 'filters',
  S08: 'chemicals',
  S09: 'chemicals',
  S10: 'filters',
  S11: 'power',
  S12: 'overview',
}

export const INSTRUMENT = new Set<Equipment['kind']>(['level', 'analyzer', 'flowmeter', 'pressure', 'leak', 'scada', 'tank', 'cylinders', 'lamella', 'scrubber', 'transformer', 'mcc', 'plc', 'hmi', 'dp', 'camera'])

export function stateOf(d: DeviceState | undefined, e: Equipment): 'run' | 'man' | 'stop' | 'fault' | 'na' {
  if (!d) return 'na'
  if (d.fault) return 'fault'
  if (e.kind === 'filter') return d.phase === 'filter' ? 'run' : 'man'
  if (e.kind === 'valve') return d.open > 0.5 ? 'run' : 'stop'
  if (INSTRUMENT.has(e.kind)) return 'na'
  return d.run ? (d.mode === 'man' ? 'man' : 'run') : 'stop'
}

export function Faceplate(props: { tag: string; onClose: () => void; onOpenScreen?: (screen: HmiScreenId, local: boolean, tag: string) => void }) {
  const { sim, v } = useSim()
  const e = () => EQUIPMENT_BY_TAG[props.tag]!
  const d = () => (v(), sim.dev[props.tag]!)
  const st = () => stateOf(d(), e())
  const locked = () => d().mode === 'auto'
  const cmd = (a: Parameters<typeof sim.command>[1], val?: number) => sim.command(props.tag, a, val)
  const ctrl = () => e().control
  const unitName = () => UNITS.find(u => u.id === e().unit)?.name ?? e().unit
  const STATE_TEXT = { run: 'ĐANG CHẠY', man: 'CHẠY · TAY', stop: 'DỪNG', fault: 'SỰ CỐ', na: 'ĐO LƯỜNG' }
  return (
    <>
      <div class="tw-fp-head">
        <div style={{ flex: 1 }}>
          <h2>{props.tag}</h2>
          <p>{e().name}</p>
        </div>
        <button type="button" class="tw-btn icon sm" onClick={() => props.onClose()} aria-label="Đóng">
          ✕
        </button>
      </div>
      <div class="tw-spec">
        {unitName()} · {e().spec}
      </div>
      <div class="tw-controls" style={{ 'margin-top': '8px' }}>
        <span class={`tw-chip ${st() === 'fault' ? 'fault' : st() === 'run' ? 'run' : st() === 'man' ? 'man' : ''}`}>
          {e().kind === 'filter' ? PHASE_LABEL[d().phase] : e().kind === 'valve' ? (d().open > 0.98 ? 'MỞ' : d().open < 0.02 ? 'ĐÓNG' : 'ĐANG CHẠY VAN') : STATE_TEXT[st()]}
        </span>
        <Show when={ctrl()}>
          <span class={`tw-chip ${d().mode === 'auto' ? 'info' : 'man'}`}>{d().mode === 'auto' ? 'TỰ ĐỘNG' : 'TAY'}</span>
        </Show>
      </div>

      <div class="tw-controls">
        <Show when={props.onOpenScreen && e().screen}>
          {scr => (
            <button type="button" class="tw-btn sm primary" onClick={() => props.onOpenScreen?.(scr(), e().kind !== 'scada', props.tag)}>
              {e().kind === 'scada' ? 'Mở SCADA trung tâm' : `Mở màn hình ${e().kind === 'plc' ? 'HMI của tủ' : 'HMI'}`}
            </button>
          )}
        </Show>
        <Show when={props.onOpenScreen && !e().screen && UNIT_SCREEN[e().unit]}>
          <button type="button" class="tw-btn sm" onClick={() => props.onOpenScreen?.(UNIT_SCREEN[e().unit]!, false, props.tag)}>
            Xem trên SCADA
          </button>
        </Show>
        <Show when={e().link && EQUIPMENT_BY_TAG[e().link!]}>
          <span class="tw-chip">Liên kết: {e().link}</span>
        </Show>
      </div>

      <div class="tw-h">Thông số trực tuyến</div>
      <For each={(v(), sim.readings(props.tag))}>{r => <Row k={r.k} v={`${r.v}${r.u ? ' ' + r.u : ''}`} warn={r.warn} />}</For>

      <Show when={e().kind === 'filter'}>
        <div class="tw-progress" title="Tổn thất áp / ngưỡng rửa 2,2 m">
          <span style={{ width: `${Math.min(100, (d().headloss / 2.2) * 100)}%`, background: d().headloss > 2 ? 'var(--warning)' : 'var(--accent)' }} />
        </div>
      </Show>

      <Show when={ctrl()}>
        <div class="tw-h">Điều khiển</div>
        <div class="tw-seg" role="group" aria-label="Chế độ">
          <button type="button" aria-pressed={d().mode === 'auto'} onClick={() => cmd('auto')}>
            Tự động
          </button>
          <button type="button" aria-pressed={d().mode === 'man'} onClick={() => cmd('man')}>
            Tay
          </button>
        </div>
        <Switch>
          <Match when={ctrl() === 'valve'}>
            <div class="tw-controls">
              <button type="button" class="tw-btn ok" disabled={locked() || d().target > 0.5} onClick={() => cmd('open')}>
                Mở van
              </button>
              <button type="button" class="tw-btn danger" disabled={locked() || d().target < 0.5} onClick={() => cmd('close')}>
                Đóng van
              </button>
            </div>
          </Match>
          <Match when={ctrl() === 'filter'}>
            <div class="tw-controls">
              <button type="button" class="tw-btn primary" disabled={d().phase !== 'filter'} onClick={() => cmd('wash')}>
                Rửa lọc ngay
              </button>
            </div>
            <div class="tw-hint">Chu trình: hạ mực nước → sục khí (máy gió) → gió + nước → rửa nước (bơm rửa lọc) → làm đầy. Tự động rửa khi tổn thất &gt; 2,2 m hoặc lọc &gt; 48 h.</div>
          </Match>
          <Match when={true}>
            <div class="tw-controls">
              <button type="button" class="tw-btn ok" disabled={locked() || d().run || d().fault} onClick={() => cmd('start')}>
                Chạy
              </button>
              <button type="button" class="tw-btn danger" disabled={locked() || !d().run} onClick={() => cmd('stop')}>
                Dừng
              </button>
            </div>
            <Show when={ctrl() === 'pump' && e().kind === 'pump'}>
              <Slider label="Tần số biến tần" min={30} max={50} step={0.5} value={d().sp} unit="Hz" disabled={locked()} onChange={x => cmd('sp', x)} />
            </Show>
            <Show when={ctrl() === 'mixer'}>
              <Slider label="Tốc độ" min={20} max={100} step={5} value={d().sp} unit="%" disabled={locked()} onChange={x => cmd('sp', x)} />
            </Show>
            <Show when={ctrl() === 'dosing'}>
              <Slider label="Liều lượng" min={0} max={props.tag.includes('POL') ? 1 : 60} step={props.tag.includes('POL') ? 0.05 : 0.5} value={d().sp} unit="mg/L" disabled={locked()} onChange={x => cmd('sp', x)} />
            </Show>
            <Show when={ctrl() === 'chlorinator'}>
              <Slider label="Lượng clo" min={0} max={5} step={0.05} value={d().sp} unit="kg/h" disabled={locked()} onChange={x => cmd('sp', x)} />
            </Show>
          </Match>
        </Switch>
        <Show when={locked()}>
          <div class="tw-hint">Đang ở TỰ ĐỘNG: lệnh bị khóa, chuyển sang TAY để điều khiển.</div>
        </Show>
      </Show>

      <CatalogBlock code={e().code} dn={e().dn} />
      <Show when={(e().count ?? 1) > 1}>
        <div class="tw-hint">Gồm {e().count} thiết bị cùng mã danh mục.</div>
      </Show>

      <div class="tw-h">Bảo trì & sự cố</div>
      <div class="tw-controls">
        <Show
          when={d().fault}
          fallback={
            <button type="button" class="tw-btn sm" onClick={() => cmd('fault')}>
              Mô phỏng sự cố
            </button>
          }
        >
          <button type="button" class="tw-btn sm primary" onClick={() => cmd('reset')}>
            Đặt lại sự cố
          </button>
        </Show>
        <span class="tw-hint" style={{ 'margin-top': 0 }}>
          Giờ chạy {f0(d().hours)} h
        </span>
      </div>
      <Show when={sim.alarms.some(a => a.tag === props.tag)}>
        <div class="tw-h">Báo động gần đây</div>
        <For each={sim.alarms.filter(a => a.tag === props.tag).slice(0, 4)}>
          {a => <Row k={`${fmtClock(a.t)} ${a.active ? '●' : '○'}`} v={a.msg} warn={a.active} />}
        </For>
      </Show>
    </>
  )
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; unit: string; disabled: boolean; onChange: (v: number) => void }) {
  const [drag, setDrag] = createSignal<number | null>(null)
  return (
    <label class="tw-slider">
      <span style={{ 'grid-column': '1 / -1', 'font-size': '12px', color: 'var(--ink-2)' }}>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={drag() ?? props.value}
        disabled={props.disabled}
        onInput={e => setDrag(Number(e.currentTarget.value))}
        onChange={e => {
          props.onChange(Number(e.currentTarget.value))
          setDrag(null)
        }}
      />
      <output>
        {props.step < 0.1 ? f2(drag() ?? props.value) : f1(drag() ?? props.value)} {props.unit}
      </output>
    </label>
  )
}
