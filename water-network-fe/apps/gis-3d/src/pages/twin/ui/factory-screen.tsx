import { ArrowLeft } from 'lucide-solid'
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import { Faceplate, stateOf } from './faceplate'
import { f0, f1, f2, useSim } from './sim-context'
import { AlarmBadge, Kpi, Row, SimClock, Spark } from './widgets'
import { EQUIPMENT, EQUIPMENT_BY_TAG, PLANT, rectOf, STRUCTURE_BY_ID, UNITS } from '../data/plant-model'
import { FactoryView } from '../factory/factory-view'
import { fmtClock } from '../sim/plant-sim'
import type { HmiTarget } from './hmi/scada'

export function FactoryScreen(props: { site: 'plant' | 'tb1'; onBack: () => void; onOpenHmi: (t: HmiTarget) => void }) {
  const { sim, v } = useSim()
  let el!: HTMLDivElement
  let view: FactoryView | null = null
  const [tag, setTag] = createSignal<string | null>(null)
  const [unit, setUnit] = createSignal<string | null>(null)
  const [roofs, setRoofs] = createSignal(false)
  const [labels, setLabels] = createSignal(true)
  const [flow, setFlow] = createSignal(true)
  const [query, setQuery] = createSignal('')
  const [open, setOpen] = createSignal<Record<string, boolean>>({ S07: true, S05: true })
  const [showLog, setShowLog] = createSignal(false)
  // eslint-disable-next-line solid/reactivity
  const [site, setSite] = createSignal<'plant' | 'tb1'>(props.site)

  onMount(() => {
    view = new FactoryView(el, sim)
    view.onPick = (t, u) => {
      setTag(t)
      setUnit(u)
      if (u) {
        setOpen(o => ({ ...o, [u]: true }))
        setSite(u === 'TB1' ? 'tb1' : 'plant')
      }
    }
    if (props.site === 'tb1') {
      view.focusSite('tb1')
      setUnit('TB1')
      setOpen(o => ({ ...o, TB1: true }))
    } else view.intro()
  })
  onCleanup(() => view?.dispose())

  const pickTag = (t: string) => {
    setTag(t)
    setUnit(EQUIPMENT_BY_TAG[t]?.unit ?? null)
    setSite(EQUIPMENT_BY_TAG[t]?.unit === 'TB1' ? 'tb1' : 'plant')
    view?.select(t)
    view?.focusTag(t)
  }
  const pickUnit = (u: string) => {
    setOpen(o => ({ ...o, [u]: !o[u] || unit() !== u }))
    setUnit(u)
    setTag(null)
    setSite(u === 'TB1' ? 'tb1' : 'plant')
    view?.select(null)
    view?.focusUnit(u)
  }

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    return UNITS.map(u => ({
      ...u,
      items: EQUIPMENT.filter(e => e.unit === u.id && (!q || e.tag.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))),
    })).filter(u => !q || u.items.length)
  })

  return (
    <div class="tw-stage">
      <div ref={el} class="tw-stage" />

      {/* top bar */}
      <header class="tw-top tw-glass">
        <button type="button" class="tw-btn" onClick={() => props.onBack()} title="Về bản đồ mạng lưới">
          <ArrowLeft size={16} /> Bản đồ
        </button>
        <div class="tw-brand">
          <div>
            <h1>{PLANT.name}</h1>
            <small>
              {PLANT.capacity} · mô hình 3D dựng từ bản vẽ CAD tổng mặt bằng · {(v(), sim.clock)}
            </small>
          </div>
        </div>
        <div class="tw-spacer" />
        <AlarmBadge />
        <button type="button" class="tw-btn primary" onClick={() => props.onOpenHmi({ mode: 'scada', screen: 'overview' })} title="Màn hình SCADA trung tâm">
          SCADA
        </button>
        <div class="tw-seg" role="group" aria-label="Khu vực">
          <button
            type="button"
            aria-pressed={site() !== 'tb1'}
            onClick={() => {
              setSite('plant')
              view?.focusSite('plant')
            }}
          >
            Nhà máy
          </button>
          <button
            type="button"
            aria-pressed={site() === 'tb1'}
            onClick={() => {
              setSite('tb1')
              view?.focusSite('tb1')
              setUnit('TB1')
            }}
          >
            TB1 nước thô
          </button>
        </div>
      </header>

      {/* KPI strip */}
      <div class="tw-strip tw-glass">
        <Kpi k="Nước thô vào" v={(v(), f0(sim.qRaw))} u="m³/h" />
        <Kpi k="Qua xử lý" v={(v(), f0(sim.qTransfer))} u="m³/h" />
        <Kpi k="Phát ra mạng" v={(v(), f0(sim.qOut))} u="m³/h" />
        <Kpi k="Áp lực ra" v={(v(), f2(sim.pOut))} u="bar" level={(v(), sim.pOut < 2.5 ? 'crit' : null)} />
        <Kpi k="Bể chứa" v={(v(), f0(sim.reservoirPct))} u="%" level={(v(), sim.reservoirPct < 20 ? 'warn' : null)} />
        <Kpi k="Đục thô → lọc" v={(v(), `${f0(sim.rawTurb)} → ${f2(sim.filteredTurb)}`)} u="NTU" level={(v(), sim.filteredTurb > 1 ? 'warn' : null)} />
        <Kpi k="Clo dư" v={(v(), f2(sim.clRes))} u="mg/L" />
        <Kpi k="Công suất điện" v={(v(), f0(sim.powerKw))} u="kW" />
      </div>

      {/* tree */}
      <aside class="tw-panel tw-left tw-glass tw-tree" aria-label="Hạng mục và thiết bị">
        <input class="tw-search" placeholder="Tìm thiết bị (P-NS, van, clo…)" value={query()} onInput={e => setQuery(e.currentTarget.value)} />
        <For each={filtered()}>
          {u => {
            const s = STRUCTURE_BY_ID[u.id]
            const bad = () => (v(), u.items.some(e => sim.dev[e.tag]?.fault))
            return (
              <div>
                <button type="button" class="unit" classList={{ sel: unit() === u.id && !tag() }} onClick={() => pickUnit(u.id)}>
                  <span style={{ width: '12px' }}>{open()[u.id] || query() ? '▾' : '▸'}</span>
                  <span style={{ flex: 1 }}>
                    {s ? `${s.no}. ` : ''}
                    {u.name}
                  </span>
                  <Show when={bad()}>
                    <span class="tw-dot fault" />
                  </Show>
                </button>
                <Show when={open()[u.id] || query()}>
                  <For each={u.items}>
                    {e => {
                      const st = () => (v(), stateOf(sim.dev[e.tag], e))
                      const r = () => (v(), sim.readings(e.tag)[0])
                      return (
                        <button type="button" class="item" classList={{ sel: tag() === e.tag }} onClick={() => pickTag(e.tag)} title={e.name}>
                          <span class={`tw-dot ${st()}`} />
                          <span class="t">
                            <b>{e.tag}</b>
                            {e.name}
                          </span>
                          <span class="r">{r() ? `${r()!.v}${r()!.u ? ' ' + r()!.u : ''}` : ''}</span>
                        </button>
                      )
                    }}
                  </For>
                </Show>
              </div>
            )
          }}
        </For>
      </aside>

      {/* faceplate / unit / trends */}
      <aside class="tw-panel tw-right tw-glass" aria-label="Bảng điều khiển thiết bị">
        <Switch fallback={<Trends />}>
          <Match when={tag()}>{t => <Faceplate tag={t()} onClose={() => (setTag(null), view?.select(null))} onOpenScreen={(screen, local, tg) => props.onOpenHmi({ mode: local ? 'local' : 'scada', screen, station: local ? tg : undefined })} />}</Match>
          <Match when={unit()}>{u => <UnitCard id={u()} onPick={pickTag} />}</Match>
        </Switch>
      </aside>

      {/* alarms / log */}
      <Show when={(v(), sim.activeAlarms.length > 0 || showLog())}>
        <div class="tw-alarms tw-glass" role="log" aria-label="Báo động">
          <div class="tw-row" style={{ padding: '0 2px 4px' }}>
            <b>{showLog() ? 'Nhật ký vận hành' : 'Báo động đang hoạt động'}</b>
            <span style={{ display: 'flex', gap: '6px' }}>
              <button type="button" class="tw-btn sm" onClick={() => setShowLog(x => !x)}>
                {showLog() ? 'Báo động' : 'Nhật ký'}
              </button>
              <button type="button" class="tw-btn sm" onClick={() => sim.ackAll()}>
                Xác nhận tất cả
              </button>
            </span>
          </div>
          <Show
            when={showLog()}
            fallback={
              <For each={(v(), sim.activeAlarms.slice(0, 12))}>
                {a => (
                  <div class="tw-alarm" classList={{ unacked: !a.acked }}>
                    <span>{fmtClock(a.t)}</span>
                    <span class={`lv ${a.level}`} />
                    <button type="button" class="tw-btn sm" style={{ height: '20px' }} onClick={() => EQUIPMENT_BY_TAG[a.tag] && pickTag(a.tag)}>
                      {a.tag}
                    </button>
                    <span class="msg">{a.msg}</span>
                    <span>{a.acked ? '✓' : ''}</span>
                  </div>
                )}
              </For>
            }
          >
            <For each={(v(), sim.log.slice(0, 30))}>
              {l => (
                <div class="tw-alarm">
                  <span>{fmtClock(l.t)}</span>
                  <span class="lv" style={{ background: l.who === 'op' ? 'var(--accent)' : l.who === 'auto' ? 'var(--good)' : 'var(--muted)' }} />
                  <span class="tg">{l.tag}</span>
                  <span>{l.msg}</span>
                  <span>{l.who === 'op' ? 'VH' : l.who === 'auto' ? 'TĐ' : 'HT'}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <div class="tw-bottom tw-glass" style={{ left: 'calc(50% - 60px)' }}>
        <SimClock
          extra={
            <>
              <button type="button" class="tw-btn sm" onClick={() => sim.injectLeak()}>
                Rò rỉ clo
              </button>
              <button type="button" class="tw-btn sm" onClick={() => sim.injectFlood()}>
                Lũ – đục cao
              </button>
              <Show when={!sim.activeAlarms.length}>
                <button type="button" class="tw-btn sm" onClick={() => setShowLog(x => !x)}>
                  Nhật ký
                </button>
              </Show>
            </>
          }
        />
      </div>
      <div class="tw-tools tw-glass" style={{ bottom: '64px' }}>
        <button type="button" class="tw-btn sm" aria-pressed={roofs()} onClick={() => (setRoofs(x => !x), view?.setRoofs(roofs()))}>
          {roofs() ? 'Ẩn mái' : 'Hiện mái'}
        </button>
        <button type="button" class="tw-btn sm" onClick={() => (setLabels(x => !x), view?.setLabels(labels()))}>
          {labels() ? 'Ẩn nhãn' : 'Hiện nhãn'}
        </button>
        <button
          type="button"
          class="tw-btn sm"
          onClick={() => {
            setFlow(x => !x)
            if (view) view.showFlow = flow()
          }}
        >
          {flow() ? 'Ẩn dòng chảy' : 'Hiện dòng chảy'}
        </button>
        <button type="button" class="tw-btn sm" onClick={() => view?.overview()}>
          Toàn cảnh
        </button>
      </div>
    </div>
  )
}

function Trends() {
  const { sim, v } = useSim()
  return (
    <>
      <div class="tw-h">Xu hướng 24 giờ</div>
      <For
        each={[
          ['Áp lực đầu ra', 'pOut', 'bar', 'var(--accent)', [3.6, 4.8]],
          ['Lưu lượng phát', 'qOut', 'm³/h', '#2f86d6', null],
          ['Mực nước bể chứa', 'res', '%', '#2fb36a', [30, 95]],
          ['Độ đục sau lọc', 'turb', 'NTU', '#e07a2a', [0, 1]],
          ['Clo dư', 'cl', 'mg/L', '#8fc93a', [0.3, 1.0]],
          ['Độ đục nước thô', 'raw', 'NTU', '#9c7a4a', null],
        ] as const}
      >
        {([k, key, u, c, band]) => {
          const d = () => (v(), sim.history[key])
          return (
            <div class="tw-trend">
              <span class="k">{k}</span>
              <span class="v">
                {(() => {
                  const a = d()
                  const x = a[a.length - 1] ?? 0
                  return `${key === 'qOut' || key === 'res' || key === 'raw' ? f0(x) : f2(x)} ${u}`
                })()}
              </span>
              <Spark data={d()} color={c} band={band ? [band[0], band[1]] : undefined} min={key === 'turb' ? 0 : undefined} />
            </div>
          )
        }}
      </For>
      <div class="tw-hint">Nhấp một hạng mục hoặc thiết bị trong cảnh 3D (hay trong danh sách bên trái) để xem trạng thái và điều khiển.</div>
    </>
  )
}

function UnitCard(props: { id: string; onPick: (t: string) => void }) {
  const { sim, v } = useSim()
  const s = () => STRUCTURE_BY_ID[props.id]
  const name = () => UNITS.find(u => u.id === props.id)?.name ?? s()?.name ?? props.id
  const items = () => EQUIPMENT.filter(e => e.unit === props.id)
  return (
    <>
      <div class="tw-fp-head">
        <div>
          <h2>{name()}</h2>
          <p>{s() ? `Hạng mục số ${s()!.no} trên tổng mặt bằng` : 'Trạm bơm nước thô bên sông'}</p>
        </div>
      </div>
      <Show when={s()}>
        {st => {
          const r = rectOf(st().poly)
          return (
            <>
              <div class="tw-h">Từ bản vẽ CAD</div>
              <Row k="Kích thước mặt bằng" v={st().kind === 'pond' ? `${f0(polyArea(st().poly))} m²` : `${f1(r.w)} × ${f1(r.h)} m`} />
              <Row k="Diện tích" v={`${f0(polyArea(st().poly))} m²`} />
              <Row k="Đường bao" v={st().fromDrawing ? 'Khớp polyline trong bản vẽ' : 'Ước theo nhãn phòng (gần đúng)'} />
              <Row k="Chiều cao (giả định)" v={`${f1(st().height)} m`} />
            </>
          )
        }}
      </Show>
      <div class="tw-h">Thiết bị ({items().length})</div>
      <For each={items()}>
        {e => {
          const r = () => (v(), sim.readings(e.tag).slice(0, 2))
          const st = () => (v(), stateOf(sim.dev[e.tag], e))
          return (
            <button type="button" class="tw-btn" style={{ width: '100%', 'justify-content': 'flex-start', 'margin-bottom': '4px', height: 'auto', padding: '6px 8px' }} onClick={() => props.onPick(e.tag)}>
              <span class={`tw-dot ${st()}`} />
              <span style={{ flex: 1, 'text-align': 'left' }}>
                <b>{e.tag}</b> <span style={{ 'font-weight': 450 }}>{e.name}</span>
              </span>
              <span style={{ 'font-size': '11.5px', color: 'var(--muted)' }}>{r().map(x => `${x.v}${x.u ? ' ' + x.u : ''}`).join(' · ')}</span>
            </button>
          )
        }}
      </For>
    </>
  )
}

function polyArea(p: Array<[number, number]>) {
  let a = 0
  for (let i = 0; i < p.length; i++) a += p[i]![0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * p[i]![1]
  return Math.abs(a) / 2
}
