/**
 * Plant explorer: areas grouped by process stage (status + the number that matters), equipment grouped by type
 * with search and filters, and the card of one area. Replaces the single 80-row tree.
 */
import { MonitorCog, Search } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { SHORT, STAGE_OF, STAGES, TYPE_OF, TYPES, unitDuty, unitItems, unitMetric, unitState, type TypeId, type UnitState } from './areas'
import { stateOf, UNIT_SCREEN } from './faceplate'
import { SCREENS } from './hmi/scada'
import { CloseBtn, persisted } from './shell'
import { f0, f1, useSim } from './sim-context'
import { Row } from './widgets'
import { EQUIPMENT, rectOf, STRUCTURE_BY_ID, UNITS, type Equipment, type HmiScreenId } from '../data/plant-model'

export const STATE_VI: Record<UnitState | 'na', string> = { run: 'Đang chạy', man: 'Cần chú ý', stop: 'Đang dừng', fault: 'Sự cố', na: 'Đo lường' }

export function AreaList(props: { unit: string | null; onPick: (id: string) => void }) {
  const { sim, v } = useSim()
  return (
    <div class="tw-areas">
      <For each={STAGES}>
        {s => (
          <section>
            <h3 class="tw-sec">
              <span class="sw" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </h3>
            <For each={s.units}>
              {id => {
                const st = () => (v(), unitState(sim, id))
                const m = () => (v(), unitMetric(sim, id))
                return (
                  <button type="button" class="tw-area" classList={{ sel: props.unit === id }} onClick={() => props.onPick(id)}>
                    <span class={`tw-dot ${st()}`} title={STATE_VI[st()]} aria-hidden="true" />
                    <span class="n">
                      <b>{SHORT[id]}</b>
                      <small>
                        <span class="tw-sr">{STATE_VI[st()]}, </span>
                        {(v(), unitDuty(sim, id))}
                      </small>
                    </span>
                    <span class="m" classList={{ warn: !!m().warn }}>
                      <small>{m().k}</small>
                      <b>
                        {m().v}
                        <Show when={m().u}>
                          <i>{m().u}</i>
                        </Show>
                      </b>
                    </span>
                  </button>
                )
              }}
            </For>
          </section>
        )}
      </For>
    </div>
  )
}

function EqRow(props: { e: Equipment; sel: boolean; onPick: (t: string) => void; showArea?: boolean }) {
  const { sim, v } = useSim()
  const st = () => (v(), stateOf(sim.dev[props.e.tag], props.e))
  const r = () => (v(), sim.readings(props.e.tag)[0])
  return (
    <button type="button" class="tw-eq" classList={{ sel: props.sel, warn: !!r()?.warn }} onClick={() => props.onPick(props.e.tag)} title={`${props.e.tag}: ${props.e.name}`}>
      <span class={`tw-dot ${st()}`} aria-hidden="true" />
      <span class="t">
        <b>{props.e.tag}</b>
        <small>
          <span class="tw-sr">{STATE_VI[st()]}, </span>
          {props.e.name}
          {props.showArea ? `, ${SHORT[props.e.unit] ?? props.e.unit}` : ''}
        </small>
      </span>
      <span class="r">{r() ? `${r()!.v}${r()!.u ? ' ' + r()!.u : ''}` : ''}</span>
    </button>
  )
}

export function EquipList(props: { tag: string | null; onPick: (t: string) => void }) {
  const { sim, v } = useSim()
  const [q, setQ] = createSignal('')
  const [type, setType] = persisted<TypeId | 'all'>('equip.type', 'all')
  const [area, setArea] = persisted<string>('equip.area', '')
  const [issues, setIssues] = createSignal(false)
  const needsAttention = (e: Equipment) => {
    const d = sim.dev[e.tag]
    return !!d && (d.fault || (e.control !== undefined && d.mode === 'man') || sim.readings(e.tag).some(r => r.warn) || sim.activeAlarms.some(a => a.tag === e.tag))
  }
  /** search + area + attention filter (the type chips count over this) */
  const base = createMemo(() => {
    const s = q().trim().toLowerCase()
    const a = area()
    if (issues()) v()
    return EQUIPMENT.filter(e => (!s || e.tag.toLowerCase().includes(s) || e.name.toLowerCase().includes(s) || e.code.toLowerCase().includes(s)) && (!a || e.unit === a) && (!issues() || needsAttention(e)))
  })
  const groups = createMemo(() =>
    TYPES.filter(t => type() === 'all' || t.id === type())
      .map(t => ({ t, items: base().filter(e => TYPE_OF(e) === t.id) }))
      .filter(g => g.items.length),
  )
  const count = (t: TypeId | 'all') => (t === 'all' ? base().length : base().filter(e => TYPE_OF(e) === t).length)
  const reset = () => {
    setQ('')
    setType('all')
    setArea('')
    setIssues(false)
  }
  return (
    <>
      <div class="tw-fly-tools col">
        <label class="tw-searchbox">
          <Search size={15} aria-hidden="true" />
          <input type="search" placeholder="Tìm mã hoặc tên: P-NS, clo, van…" aria-label="Tìm thiết bị" value={q()} onInput={e => setQ(e.currentTarget.value)} />
        </label>
        <div class="tw-filter" role="group" aria-label="Lọc theo loại thiết bị">
          <For each={[{ id: 'all' as const, label: 'Tất cả' }, ...TYPES]}>
            {t => (
              <button type="button" aria-pressed={type() === t.id} onClick={() => setType(t.id)}>
                {t.label}
                <span>{count(t.id)}</span>
              </button>
            )}
          </For>
        </div>
        <div class="tw-fly-row">
          <select class="tw-select" aria-label="Lọc theo khu vực" value={area()} onChange={e => setArea(e.currentTarget.value)}>
            <option value="">Mọi khu vực</option>
            <For each={STAGES}>
              {s => (
                <optgroup label={s.label}>
                  <For each={s.units}>{u => <option value={u}>{SHORT[u]}</option>}</For>
                </optgroup>
              )}
            </For>
          </select>
          <label class="tw-check">
            <input type="checkbox" checked={issues()} onChange={e => setIssues(e.currentTarget.checked)} />
            Chỉ thiết bị cần chú ý
          </label>
        </div>
      </div>
      <Show
        when={groups().length}
        fallback={
          <p class="tw-empty">
            {issues() && !q() ? 'Không có thiết bị nào cần chú ý.' : 'Không có thiết bị khớp bộ lọc.'}{' '}
            <button type="button" class="tw-linkbtn" onClick={reset}>
              Xóa bộ lọc
            </button>
          </p>
        }
      >
        <For each={groups()}>
          {g => (
            <section class="tw-eqg">
              <h3 class="tw-sec">
                {g.t.label}
                <span class="cnt">{g.items.length}</span>
              </h3>
              <For each={g.items}>{e => <EqRow e={e} sel={props.tag === e.tag} onPick={props.onPick} showArea={!area()} />}</For>
            </section>
          )}
        </For>
      </Show>
    </>
  )
}

export function UnitCard(props: { id: string; tag: string | null; onPick: (t: string) => void; onClose: () => void; onOpenScreen: (s: HmiScreenId) => void }) {
  const { sim, v } = useSim()
  const s = () => STRUCTURE_BY_ID[props.id]
  const stage = () => STAGE_OF[props.id]
  const st = () => (v(), unitState(sim, props.id))
  const m = () => (v(), unitMetric(sim, props.id))
  const screen = () => UNIT_SCREEN[props.id]
  const groups = () => TYPES.map(t => ({ t, items: unitItems(props.id).filter(e => TYPE_OF(e) === t.id) })).filter(g => g.items.length)
  return (
    <>
      <div class="tw-fp-head">
        <span class="tw-stage-sw" style={{ background: stage()?.color }} aria-hidden="true" />
        <div style={{ flex: 1, 'min-width': 0 }}>
          <h2>{SHORT[props.id] ?? props.id}</h2>
          <p>{UNITS.find(u => u.id === props.id)?.name}</p>
        </div>
        <CloseBtn onClick={props.onClose} label="Đóng thẻ hạng mục" />
      </div>
      <div class="tw-controls">
        <span class={`tw-chip ${st() === 'run' ? 'run' : st() === 'fault' ? 'fault' : st() === 'man' ? 'man' : ''}`}>{STATE_VI[st()]}</span>
        <span class="tw-chip">{stage()?.label}</span>
        <Show when={s()}>
          <span class="tw-chip">Số {s()!.no} trên tổng mặt bằng</span>
        </Show>
      </div>
      <div class="tw-big">
        <span>{m().k}</span>
        <b classList={{ warn: !!m().warn }}>
          {m().v}
          <Show when={m().u}>
            <small>{m().u}</small>
          </Show>
        </b>
        <span class="sub">{(v(), unitDuty(sim, props.id))}</span>
      </div>
      <Show when={screen()}>
        {sc => (
          <button type="button" class="tw-btn wide" onClick={() => props.onOpenScreen(sc())}>
            <MonitorCog size={16} /> Mở màn hình SCADA: {SCREENS.find(x => x.id === sc())?.label ?? sc()}
          </button>
        )}
      </Show>
      <For each={groups()}>
        {g => (
          <section class="tw-eqg">
            <h3 class="tw-h">
              {g.t.label}
              <span class="cnt">{g.items.length}</span>
            </h3>
            <For each={g.items}>{e => <EqRow e={e} sel={props.tag === e.tag} onPick={props.onPick} />}</For>
          </section>
        )}
      </For>
      <Show when={s()}>
        {st2 => {
          const r = rectOf(st2().poly)
          return (
            <>
              <h3 class="tw-h">Từ bản vẽ CAD</h3>
              <Row k="Kích thước mặt bằng" v={st2().kind === 'pond' ? `${f0(polyArea(st2().poly))} m²` : `${f1(r.w)} × ${f1(r.h)} m`} />
              <Row k="Diện tích" v={`${f0(polyArea(st2().poly))} m²`} />
              <Row k="Đường bao" v={st2().fromDrawing ? 'Theo bản vẽ' : 'Ước tính'} />
              <Row k="Chiều cao (giả định)" v={`${f1(st2().height)} m`} />
            </>
          )
        }}
      </Show>
    </>
  )
}

function polyArea(p: Array<[number, number]>) {
  let a = 0
  for (let i = 0; i < p.length; i++) a += p[i]![0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * p[i]![1]
  return Math.abs(a) / 2
}
