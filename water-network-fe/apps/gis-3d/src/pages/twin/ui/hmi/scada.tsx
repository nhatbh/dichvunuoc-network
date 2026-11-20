/**
 * Mock SCADA (central control room) and local HMI panels of the Sông Hồng plant.
 *
 *  - SCADA trung tâm: full window, navigation over every process screen, alarm banner, trends, network.
 *  - HMI tại chỗ: the same screens on a local operator panel (bezel, one area only: HMI-07 shows the clean-water
 *    pumps, HMI-05 the filter gallery …), as on a panel mounted next to the equipment.
 * Every symbol opens the item's faceplate; commands go to the same simulation the 3D views and the map use.
 */
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js'
import { Bar, Box, MimicButton, Motor, Pipe, Pump, Tank, Trend, Valve, Value, type MimicState } from './mimic'
import { NET_DEVICES } from '../../data/network-devices'
import { solveNetwork } from '../../data/network-model'
import { EQUIPMENT_BY_TAG, type HmiScreenId } from '../../data/plant-model'
import { deviceReadings, deviceStatus } from '../../sim/network-devices-state'
import { fmtClock, PHASE_LABEL } from '../../sim/plant-sim'
import { CatalogIcon } from '../catalog-info'
import { Faceplate, stateOf } from '../faceplate'
import { f0, f1, f2, useSim } from '../sim-context'
import './hmi.css'

export interface HmiTarget {
  /** 'scada' = central control room, 'local' = a panel in the plant */
  mode: 'scada' | 'local'
  screen: HmiScreenId
  /** the panel's tag (HMI-07, PLC-05 …) for a local panel */
  station?: string
}

export const SCREENS: Array<{ id: HmiScreenId; label: string }> = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'tb1', label: 'TB1 nước thô' },
  { id: 'clarifier', label: 'Trộn – lắng' },
  { id: 'filters', label: 'Bể lọc' },
  { id: 'pumps', label: 'Bơm nước sạch' },
  { id: 'chemicals', label: 'Hóa chất & clo' },
  { id: 'power', label: 'Điện' },
  { id: 'network', label: 'Mạng lưới' },
  { id: 'alarms', label: 'Báo động' },
  { id: 'trends', label: 'Xu hướng' },
]
const LOCAL_SCREENS: Partial<Record<HmiScreenId, HmiScreenId[]>> = {
  tb1: ['tb1', 'alarms'],
  transfer: ['clarifier', 'alarms'],
  clarifier: ['clarifier', 'alarms'],
  filters: ['filters', 'alarms', 'trends'],
  pumps: ['pumps', 'alarms', 'trends'],
  chemicals: ['chemicals', 'alarms'],
  power: ['power', 'alarms'],
}

export function ScadaWindow(props: { target: HmiTarget; onClose: () => void }) {
  const { sim, v } = useSim()
  const first = props.target.screen === 'transfer' ? 'clarifier' : props.target.screen
   
  const [screen, setScreen] = createSignal<HmiScreenId>(first)
  const [face, setFace] = createSignal<string | null>(null)
  const local = () => props.target.mode === 'local'
  const tabs = () => (local() ? SCREENS.filter(s => (LOCAL_SCREENS[props.target.screen] ?? [first, 'alarms']).includes(s.id)) : SCREENS)
  const station = () => (props.target.station ? EQUIPMENT_BY_TAG[props.target.station] : undefined)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (face()) setFace(null)
    else props.onClose()
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))
  const open = (tag: string) => EQUIPMENT_BY_TAG[tag] && setFace(tag)
  const crit = () => (v(), sim.activeAlarms.some(a => a.level === 'crit'))
  const last = () => (v(), sim.activeAlarms[0])
  return (
    <div class="hm-backdrop" role="dialog" aria-modal="true" aria-label={local() ? 'Màn hình HMI tại chỗ' : 'SCADA trung tâm'}>
      <div class={local() ? 'hm-bezel' : 'hm-full'}>
        <Show when={local()}>
          <div class="hm-bezel-top">
            <span>{props.target.station ?? 'HMI'} · Panel 15″</span>
            <span class="hm-led" />
          </div>
        </Show>
        <div class="hm-screen">
          <header class="hm-head">
            <div class="hm-brand">
              <b>{local() ? `${props.target.station ?? 'HMI'} · VẬN HÀNH TẠI CHỖ` : 'SCADA TRUNG TÂM'}</b>
              <span>{local() ? station()?.name ?? '' : 'Nhà máy nước sạch Sông Hồng · 29.000 m³/ngđ'}</span>
            </div>
            <div class="hm-comm">
              <For each={local() ? [station()?.tag ?? 'PLC', 'SCADA'] : ['PLC-TB1', 'PLC-03', 'PLC-04', 'PLC-05', 'PLC-07', 'PLC-08', 'RTU-VT3']}>
                {c => (
                  <span class="hm-commchip" title="Truyền thông OK">
                    <i /> {c}
                  </span>
                )}
              </For>
            </div>
            <div class="hm-clock">{(v(), sim.clock)}</div>
            <button type="button" class={`hm-alarmcount ${crit() ? 'crit' : (v(), sim.activeAlarms.length) ? 'warn' : ''}`} onClick={() => setScreen('alarms')}>
              {(v(), sim.activeAlarms.length)} báo động
            </button>
            <button type="button" class="hm-x" onClick={() => props.onClose()} aria-label="Đóng màn hình">
              ✕
            </button>
          </header>
          <nav class="hm-nav" aria-label="Màn hình">
            <For each={tabs()}>
              {s => (
                <button type="button" aria-pressed={screen() === s.id} onClick={() => setScreen(s.id)}>
                  {s.label}
                </button>
              )}
            </For>
            <span class="hm-mode">{local() ? 'Quyền điều khiển: TẠI CHỖ (ưu tiên)' : 'Quyền điều khiển: TRUNG TÂM'}</span>
          </nav>
          <div class="hm-body">
            <Switch>
              <Match when={screen() === 'alarms'}>
                <AlarmScreen onOpen={open} />
              </Match>
              <Match when={screen() === 'network'}>
                <NetworkScreen />
              </Match>
              <Match when={true}>
                <svg class="hm-svg" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid meet">
                  <Switch>
                    <Match when={screen() === 'overview'}>
                      <Overview onOpen={open} />
                    </Match>
                    <Match when={screen() === 'tb1'}>
                      <Tb1Screen onOpen={open} />
                    </Match>
                    <Match when={screen() === 'clarifier'}>
                      <ClarifierScreen onOpen={open} />
                    </Match>
                    <Match when={screen() === 'filters'}>
                      <FilterScreen onOpen={open} />
                    </Match>
                    <Match when={screen() === 'pumps'}>
                      <PumpScreen onOpen={open} />
                    </Match>
                    <Match when={screen() === 'chemicals'}>
                      <ChemScreen onOpen={open} />
                    </Match>
                    <Match when={screen() === 'power'}>
                      <PowerScreen onOpen={open} />
                    </Match>
                    <Match when={screen() === 'trends'}>
                      <TrendScreen />
                    </Match>
                  </Switch>
                </svg>
              </Match>
            </Switch>
            <Show when={face()}>
              {t => (
                <aside class="hm-face">
                  <Faceplate tag={t()} onClose={() => setFace(null)} />
                </aside>
              )}
            </Show>
          </div>
          <footer class={`hm-foot ${last()?.level ?? ''}`}>
            <Show when={last()} fallback={<span>Không có báo động đang hoạt động</span>}>
              {a => (
                <>
                  <span class={`hm-lv ${a().level}`} />
                  <span>{fmtClock(a().t)}</span>
                  <b>{a().tag}</b>
                  <span>{a().msg}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" class="hm-ack" onClick={() => sim.ackAll()}>
                    Xác nhận
                  </button>
                </>
              )}
            </Show>
          </footer>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── helpers ─────────────────────────
function useState() {
  const { sim, v } = useSim()
  const st = (tag: string): MimicState => {
    v()
    const e = EQUIPMENT_BY_TAG[tag]
    return e ? stateOf(sim.dev[tag], e) : 'na'
  }
  const dev = (tag: string) => (v(), sim.dev[tag]!)
  return { sim, v, st, dev }
}
type ScreenProps = { onOpen: (t: string) => void }
const T = (props: { x: number; y: number; children: JSX.Element; cls?: string; anchor?: 'start' | 'middle' | 'end' }) => (
  <text x={props.x} y={props.y} class={props.cls ?? 'hm-title'} text-anchor={props.anchor ?? 'start'}>
    {props.children}
  </text>
)

// ───────────────────────── screens ─────────────────────────
function Overview(props: ScreenProps) {
  const { sim, v, st, dev } = useState()
  const flowing = (q: number) => (v(), q > 1)
  const ft = (tag: string) => f0(dev(tag).q)
  return (
    <>
      <T x={16} y={24}>
        Sơ đồ công nghệ toàn nhà máy
      </T>
      {/* river + TB1 */}
      <rect x="20" y="470" width="150" height="70" fill="#1f4f7a" />
      <path d="M20 478q12-8 25 0t25 0t25 0t25 0t25 0t25 0" stroke="#7fb6e3" fill="none" />
      <T x={30} y={530} cls="hm-sub">
        Sông Hồng
      </T>
      <For each={['P-TB1-01', 'P-TB1-02', 'P-TB1-03']}>
        {(t, i) => (
          <>
            <Pipe d={`M${55 + i() * 45} 470V435`} fluid="raw" w={4} flow={flowing(dev(t).q)} />
            <Pump tag={t} x={55 + i() * 45} y={420} state={st(t)} onOpen={props.onOpen} label={`TB1-${i() + 1}`} />
          </>
        )}
      </For>
      <Pipe d="M55 402V385H245" fluid="raw" flow={flowing(sim.qRaw)} />
      <Value x={60} y={330} label="FT-101 nước thô" value={(v(), f0(sim.qRaw))} unit="m³/h" tag="FT-101" onOpen={props.onOpen} />
      <Value x={60} y={290} label="AIT-201 độ đục thô" value={(v(), f0(sim.rawTurb))} unit="NTU" warn={(v(), sim.rawTurb > 180)} tag="AIT-201" onOpen={props.onOpen} />
      {/* pond + transfer */}
      <Tank x={245} y={350} w={110} h={100} level={(v(), sim.pondLevel / 4.6)} label="Hồ sơ lắng" fluid="raw" tag="LT-201" onOpen={props.onOpen} />
      <Pipe d="M355 435H470" fluid="raw" w={5} />
      <For each={['P-CT-01', 'P-CT-02', 'P-CT-03']}>
        {(t, i) => <Pump tag={t} x={392 + i() * 36} y={435} r={13} state={st(t)} onOpen={props.onOpen} label={`CT-${i() + 1}`} />}
      </For>
      <Pipe d="M392 422V395H480V250H525V232" fluid="raw" flow={flowing(sim.qTransfer)} />
      {/* chemicals */}
      <Tank x={470} y={60} w={34} h={50} level={0.66} label="PAC" fluid="chem" tag="T-PAC-01" onOpen={props.onOpen} />
      <Motor tag="DP-PAC-01" x={530} y={100} state={st('DP-PAC-01')} onOpen={props.onOpen} letter="D" label="DP-PAC" />
      <Pipe d="M530 111V140H522V170" fluid="chem" w={3} flow={(v(), sim.pacDose > 0)} />
      <Motor tag="DP-POL-01" x={600} y={100} state={st('DP-POL-01')} onOpen={props.onOpen} letter="D" label="DP-POL" />
      <Pipe d="M600 111V170" fluid="chem" w={3} flow={(v(), dev('DP-POL-01').run)} />
      <Box x={655} y={70} w={44} h={36} label="CL-901" tag="CL-901" onOpen={props.onOpen} fill="#1c2b1c" />
      <Pipe d="M677 106V140H540V170" fluid="cl" w={3} flow={(v(), dev('CL-901').q > 0)} />
      <Box x={715} y={70} w={44} h={36} label="CL-902" tag="CL-902" onOpen={props.onOpen} fill="#1c2b1c" />
      <Pipe d="M737 106V128H1010V330H990" fluid="cl" w={3} flow={(v(), dev('CL-902').q > 0)} />
      {/* mixing + flocculation + lamella */}
      <Box x={500} y={170} w={48} h={70} label="Trộn" tag="M-401" onOpen={props.onOpen} />
      <Motor tag="M-401" x={524} y={196} state={st('M-401')} onOpen={props.onOpen} label="" />
      <Box x={560} y={170} w={128} h={70} label="Phản ứng 3 bậc" />
      <For each={['FL-401', 'FL-402', 'FL-403']}>{(t, i) => <Motor tag={t} x={581 + i() * 43} y={210} state={st(t)} onOpen={props.onOpen} label={`FL-${i() + 1}`} />}</For>
      <Pipe d="M548 205H560" fluid="raw" w={4} />
      <Pipe d="M688 190H700M688 225H700" fluid="settled" w={4} />
      <Valve tag="MV-401" x={712} y={190} open={(v(), dev('MV-401').open)} onOpen={props.onOpen} label={false} s={7} />
      <Valve tag="MV-402" x={712} y={225} open={(v(), dev('MV-402').open)} onOpen={props.onOpen} label={false} s={7} />
      <Box x={725} y={172} w={56} h={30} tag="LS-401" onOpen={props.onOpen} label="Lắng lamella" />
      <Box x={725} y={208} w={56} h={30} tag="LS-402" onOpen={props.onOpen} />
      <Pipe d="M781 205H800" fluid="settled" w={5} flow={flowing(sim.qTransfer)} />
      <Value x={705} y={250} label="AIT-401 sau lắng" value={(v(), f2(sim.settledTurb))} unit="NTU" warn={(v(), sim.settledTurb > 5)} tag="AIT-401" onOpen={props.onOpen} />
      {/* filters */}
      <For each={[1, 2, 3, 4]}>
        {i => {
          const t = `F-50${i}`
          const f = () => dev(t)
          return (
            <Box x={800 + (i - 1) * 50} y={165} w={44} h={78} tag={t} onOpen={props.onOpen} fill={f().phase === 'filter' ? '#173049' : '#4a3a12'} label={`F${i}`}>
              <rect x={803 + (i - 1) * 50} y={215} width="38" height="25" fill="#c9b07a" opacity="0.85" />
              <text x={822 + (i - 1) * 50} y={200} class="hm-sub" text-anchor="middle">
                {f().phase === 'filter' ? f2(f().headloss) + ' m' : 'RỬA'}
              </text>
            </Box>
          )
        }}
      </For>
      <Value x={835} y={250} label="AIT-501 sau lọc" value={(v(), f2(sim.filteredTurb))} unit="NTU" warn={(v(), sim.filteredTurb > 1)} tag="AIT-501" onOpen={props.onOpen} />
      <Pipe d="M972 243V300H905V330" fluid="clean" flow={flowing(sim.qFiltered)} />
      {/* backwash */}
      <Motor tag="B-701" x={1050} y={200} state={st('B-701')} onOpen={props.onOpen} letter="B" label="B1" />
      <Motor tag="B-702" x={1085} y={200} state={st('B-702')} onOpen={props.onOpen} letter="B" label="B2" />
      <Pipe d="M1050 189V160H1000" fluid="air" w={3} flow={(v(), dev('B-701').run || dev('B-702').run)} />
      <Pump tag="P-RL-01" x={1050} y={265} r={11} state={st('P-RL-01')} onOpen={props.onOpen} label="RL-1" />
      <Pump tag="P-RL-02" x={1085} y={265} r={11} state={st('P-RL-02')} onOpen={props.onOpen} label="RL-2" />
      <Pipe d="M1050 254V235H1000" fluid="wash" w={3} flow={(v(), sim.qBackwash > 1)} />
      {/* reservoir + clean water pumps */}
      <Tank x={820} y={330} w={170} h={120} level={(v(), sim.reservoirLevel / 5.3)} label="Bể chứa 10.000 m³" tag="LT-601" onOpen={props.onOpen} />
      <Value x={820} y={470} label="AIT-601 clo dư" value={(v(), f2(sim.clRes))} unit="mg/L" warn={(v(), sim.clRes < 0.3)} tag="AIT-601" onOpen={props.onOpen} />
      <Value x={943} y={470} w={92} label="AIT-602 pH" value={(v(), f2(7.15 + 0.08 * Math.sin(sim.t / 5000)))} unit="" tag="AIT-602" onOpen={props.onOpen} />
      <Pipe d="M990 427H1020V375M1020 427V479" fluid="clean" flow={flowing(sim.qOut)} />
      <For each={['P-NS-01', 'P-NS-02', 'P-NS-03']}>
        {(t, i) => (
          <>
            <Pipe d={`M1020 ${375 + i() * 52}H1040`} fluid="clean" w={4} />
            <Pump tag={t} x={1055} y={375 + i() * 52} r={14} state={st(t)} onOpen={props.onOpen} label={`NS-${i() + 1}`} />
          </>
        )}
      </For>
      <Pipe d="M1069 375H1095V479M1069 427H1095M1069 479H1095M1095 427H1195" fluid="clean" flow={flowing(sim.qOut)} />
      <Valve tag="MV-701" x={1135} y={427} open={(v(), dev('MV-701').open)} onOpen={props.onOpen} />
      <Value x={1075} y={320} label="FT-701" value={ft('FT-701') === '0' ? (v(), f0(sim.qOut)) : (v(), f0(sim.qOut))} unit="m³/h" tag="FT-701" onOpen={props.onOpen} />
      <Value x={1075} y={500} label="PT-701 áp ra" value={(v(), f2(sim.pOut))} unit="bar" warn={(v(), sim.pOut < 2.5)} tag="PT-701" onOpen={props.onOpen} />
      <T x={1150} y={412} cls="hm-sub">
        → mạng lưới
      </T>
      {/* KPI row */}
      <For
        each={[
          ['Sản lượng hôm nay', () => f0(sim.prodToday), 'm³'],
          ['Công suất điện', () => f0(sim.powerKw), 'kW'],
          ['Suất điện năng', () => f2(sim.specificEnergy), 'kWh/m³'],
          ['Liều PAC', () => f1(sim.pacDose), 'mg/L'],
          ['Nhu cầu mạng', () => f0(sim.qDemand), 'm³/h'],
        ] as const}
      >
        {([k, fn, u], i) => <Value x={250 + i() * 130} y={545} w={122} label={k} value={(v(), fn())} unit={u} />}
      </For>
    </>
  )
}

function Tb1Screen(props: ScreenProps) {
  const { sim, v, st, dev } = useState()
  return (
    <>
      <T x={16} y={24}>
        TB1 · Công trình thu và trạm bơm nước thô (3 × 1450 m³/h, H=45 m)
      </T>
      <rect x="40" y="380" width="330" height="170" fill="#1f4f7a" />
      <rect x="40" y={(v(), 550 - (sim.riverLevel / 17) * 170)} width="330" height="3" fill="#7fb6e3" />
      <T x={52} y={540} cls="hm-sub">
        Sông Hồng · NMN min +1,78 / max +17,00
      </T>
      <Value x={52} y={330} label="LT-101 mực nước sông" value={(v(), '+' + f2(sim.riverLevel))} unit="m" tag="LT-101" onOpen={props.onOpen} />
      <rect x="390" y="300" width="380" height="250" fill="none" stroke="#9aa6b4" stroke-dasharray="6 4" />
      <T x={400} y={318} cls="hm-sub">
        Nhà trạm (+15,10)
      </T>
      <For each={['P-TB1-01', 'P-TB1-02', 'P-TB1-03']}>
        {(t, i) => (
          <>
            <Pipe d={`M${450 + i() * 110} 540V430`} fluid="raw" w={5} flow={(v(), dev(t).q > 1)} />
            <Pump tag={t} x={450 + i() * 110} y={410} r={20} state={st(t)} onOpen={props.onOpen} sub={(v(), dev(t).run ? `${f1(dev(t).sp)} Hz · ${f0(dev(t).q)} m³/h` : 'Dừng')} />
            <Pipe d={`M${450 + i() * 110} 390V250`} fluid="raw" w={5} flow={(v(), dev(t).q > 1)} />
          </>
        )}
      </For>
      <Pipe d="M440 250H1150" fluid="raw" w={8} flow={(v(), sim.qRaw > 1)} />
      <Value x={820} y={200} label="FT-101" value={(v(), f0(sim.qRaw))} unit="m³/h" tag="FT-101" onOpen={props.onOpen} />
      <Value x={960} y={200} label="Độ đục thô AIT-201" value={(v(), f0(sim.rawTurb))} unit="NTU" tag="AIT-201" onOpen={props.onOpen} warn={(v(), sim.rawTurb > 180)} />
      <T x={1040} y={240} cls="hm-sub">
        D600 thép → hồ sơ lắng (~5 km)
      </T>
      <Tank x={960} y={330} w={160} h={150} level={(v(), sim.pondLevel / 4.6)} label="Hồ sơ lắng (LT-201)" fluid="raw" tag="LT-201" onOpen={props.onOpen} />
      <T x={820} y={540} cls="hm-sub">
        TỰ ĐỘNG: chạy 1 bơm khi hồ &lt; 3,0 m, 2 bơm khi &lt; 2,4 m, dừng khi &gt; 4,0 m
      </T>
    </>
  )
}

function ClarifierScreen(props: ScreenProps) {
  const { sim, v, st, dev } = useState()
  return (
    <>
      <T x={16} y={24}>
        Trạm bơm chuyển tiếp · trộn · phản ứng · lắng lamella
      </T>
      <Tank x={30} y={300} w={150} h={150} level={(v(), sim.pondLevel / 4.6)} label="Hồ sơ lắng" fluid="raw" tag="LT-201" onOpen={props.onOpen} />
      <Pipe d="M180 420H360" fluid="raw" w={6} />
      <For each={['P-CT-01', 'P-CT-02', 'P-CT-03']}>
        {(t, i) => <Pump tag={t} x={230 + i() * 55} y={420} r={18} state={st(t)} onOpen={props.onOpen} sub={(v(), dev(t).run ? `${f0(dev(t).q)} m³/h` : 'Dừng')} />}
      </For>
      <Pipe d="M230 402V300H420V200H440" fluid="raw" flow={(v(), sim.qTransfer > 1)} />
      <Box x={440} y={150} w={90} h={130} label="Bể trộn" tag="M-401" onOpen={props.onOpen} />
      <Motor tag="M-401" x={485} y={185} state={st('M-401')} onOpen={props.onOpen} />
      <Box x={545} y={150} w={270} h={130} label="Phản ứng cơ khí 3 bậc (4 ngăn/bậc)" />
      <For each={['FL-401', 'FL-402', 'FL-403']}>
        {(t, i) => (
          <>
            <Motor tag={t} x={590 + i() * 90} y={200} state={st(t)} onOpen={props.onOpen} />
            <text x={590 + i() * 90} y={240} class="hm-sub" text-anchor="middle">
              {(v(), `${f0(dev(t).sp)} %`)}
            </text>
          </>
        )}
      </For>
      <Pipe d="M530 215H545M815 190H850M815 250H850" fluid="settled" w={5} />
      <Valve tag="MV-401" x={865} y={190} open={(v(), dev('MV-401').open)} onOpen={props.onOpen} />
      <Valve tag="MV-402" x={865} y={250} open={(v(), dev('MV-402').open)} onOpen={props.onOpen} />
      <Box x={890} y={160} w={170} h={55} tag="LS-401" onOpen={props.onOpen} label="Lắng lamella 1" />
      <Box x={890} y={235} w={170} h={55} tag="LS-402" onOpen={props.onOpen} />
      <For each={[0, 1]}>
        {i => (
          <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
            {k => <line x1={905 + k * 19} y1={i ? 285 : 210} x2={918 + k * 19} y2={i ? 240 : 165} stroke="#dfe7ef" stroke-width="1.2" />}
          </For>
        )}
      </For>
      <Pipe d="M1060 220H1180" fluid="settled" flow={(v(), sim.qTransfer > 1)} />
      <T x={1100} y={210} cls="hm-sub">
        → bể lọc
      </T>
      <Value x={440} y={330} label="AIT-402 pH sau keo tụ" value={(v(), f2(6.9 + 0.1 * Math.sin(sim.t / 4000)))} unit="" tag="AIT-402" onOpen={props.onOpen} />
      <Value x={580} y={330} label="Liều PAC / yêu cầu" w={150} value={(v(), `${f1(sim.pacDose)} / ${f1(8 + 0.13 * sim.rawTurb)}`)} unit="mg/L" tag="DP-PAC-01" onOpen={props.onOpen} />
      <Value x={890} y={330} label="AIT-401 độ đục sau lắng" w={150} value={(v(), f2(sim.settledTurb))} unit="NTU" warn={(v(), sim.settledTurb > 5)} tag="AIT-401" onOpen={props.onOpen} />
      <Value x={890} y={375} label="Tải bề mặt lắng 1" w={150} value={(v(), f2(dev('LS-401').q / 172))} unit="m/h" tag="LS-401" onOpen={props.onOpen} />
      <T x={440} y={540} cls="hm-sub">
        Hút bùn tự động theo chu kỳ · van bướm điện DN600 cô lập từng bể lắng
      </T>
    </>
  )
}

function FilterScreen(props: ScreenProps) {
  const { sim, v, st, dev } = useState()
  const washing = () => (v(), ['F-501', 'F-502', 'F-503', 'F-504'].some(t => !['filter', 'standby'].includes(dev(t).phase)))
  return (
    <>
      <T x={16} y={24}>
        Cụm bể lọc nhanh · 4 bể · rửa gió + nước
      </T>
      <Pipe d="M40 110H1080" fluid="settled" w={7} flow={(v(), sim.qTransfer > 1)} />
      <For each={[1, 2, 3, 4]}>
        {i => {
          const t = `F-50${i}`
          const x = 60 + (i - 1) * 255
          const f = () => dev(t)
          const lv = () => (f().phase === 'filter' ? 0.9 : f().phase === 'drain' || f().phase === 'air' ? 0.3 : f().phase === 'refill' ? 0.3 + (f().phaseT / 240) * 0.6 : 0.5)
          return (
            <>
              <Pipe d={`M${x + 100} 110V140`} fluid="settled" w={4} />
              <Box x={x} y={140} w={200} h={190} tag={t} onOpen={props.onOpen} label={`Bể lọc ${i}`} fill="#121a22">
                <rect x={x + 3} y={140 + 187 - 180 * lv()} width="194" height={180 * lv() - 75} fill="#3c9be8" opacity="0.6" />
                <rect x={x + 3} y={262} width="194" height="45" fill="#c9b07a" />
                <rect x={x + 3} y={307} width="194" height="20" fill="#7c6a4a" />
                <Show when={f().phase === 'air' || f().phase === 'airwater'}>
                  <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>{k => <circle cx={x + 15 + k * 18} cy={200 + ((k * 37) % 50)} r="3" fill="#fff" opacity="0.8" class="hm-bubble" />}</For>
                </Show>
              </Box>
              <text x={x + 100} y={355} class={f().phase === 'filter' ? 'hm-tag' : 'hm-tag warn'} text-anchor="middle">
                {PHASE_LABEL[f().phase]}
              </text>
              <Bar x={x} y={365} w={200} value={f().headloss} max={2.5} warnAt={2.2} label={`DPT-50${i}: ${f2(f().headloss)} m · lọc ${f1(f().runH)} h · ${f0(f().q)} m³/h`} />
              <MimicButton x={x + 62} y={400} label="Rửa lọc" disabled={f().phase !== 'filter' || washing()} onClick={() => sim.command(t, 'wash')} tone="primary" />
              <Pipe d={`M${x + 190} 330V460`} fluid="clean" w={4} flow={f().phase === 'filter'} />
            </>
          )
        }}
      </For>
      <Pipe d="M250 460H1150" fluid="clean" w={7} flow={(v(), sim.qFiltered > 1)} />
      <T x={1060} y={450} cls="hm-sub">
        → bể chứa
      </T>
      <Value x={1030} y={480} label="AIT-501 sau lọc" value={(v(), f2(sim.filteredTurb))} unit="NTU" warn={(v(), sim.filteredTurb > 1)} tag="AIT-501" onOpen={props.onOpen} />
      <For each={['P-RL-01', 'P-RL-02']}>{(t, i) => <Pump tag={t} x={120 + i() * 70} y={540} r={15} state={st(t)} onOpen={props.onOpen} sub={(v(), dev(t).run ? `${f0(dev(t).q)} m³/h` : '')} />}</For>
      <For each={['B-701', 'B-702']}>{(t, i) => <Motor tag={t} x={330 + i() * 60} y={540} state={st(t)} onOpen={props.onOpen} letter="B" />}</For>
      <T x={460} y={545} cls="hm-sub">
        Bơm rửa lọc Q=1050 m³/h · máy thổi khí 75 m³/ph · nước xả về bể thu hồi
      </T>
    </>
  )
}

function PumpScreen(props: ScreenProps) {
  const { sim, v, st, dev } = useState()
  return (
    <>
      <T x={16} y={24}>
        Trạm bơm nước sạch · 3 × 850 m³/h, H=50 m · biến tần · giữ áp 4,2 bar
      </T>
      <Tank x={30} y={140} w={180} h={260} level={(v(), sim.reservoirLevel / 5.3)} label="Bể chứa 10.000 m³" tag="LT-601" onOpen={props.onOpen} />
      <Value x={30} y={420} label="LT-601 mực nước" value={(v(), f2(sim.reservoirLevel))} unit="m" tag="LT-601" onOpen={props.onOpen} />
      <Pipe d="M210 360H300V160M300 360V480" fluid="clean" w={8} flow={(v(), sim.qOut > 1)} />
      <For each={['P-NS-01', 'P-NS-02', 'P-NS-03']}>
        {(t, i) => {
          const y = 160 + i() * 160
          return (
            <>
              <Pipe d={`M300 ${y}H400`} fluid="clean" w={6} flow={(v(), dev(t).q > 1)} />
              <Pump tag={t} x={430} y={y} r={26} state={st(t)} onOpen={props.onOpen} />
              <Pipe d={`M456 ${y}H600`} fluid="clean" w={6} flow={(v(), dev(t).q > 1)} />
              <path d={`M520 ${y - 9}L536 ${y}L520 ${y + 9}Z`} fill="#dfe7ef" />
              <line x1="539" y1={y - 10} x2="539" y2={y + 10} stroke="#dfe7ef" stroke-width="3" />
              <Box x={350} y={y - 70} w={160} h={36} tag={`VFD-NS-0${i() + 1}`} onOpen={props.onOpen} fill="#1a2430">
                <text x={356} y={y - 58} class="hm-label">
                  VFD-NS-0{i() + 1}
                </text>
                <text x={504} y={y - 40} class="hm-val" text-anchor="end">
                  {(v(), dev(t).run && !dev(t).fault ? `${f1(dev(t).sp)} Hz · ${f0(dev(t).kw)} kW` : dev(t).fault ? 'LỖI' : 'SẴN SÀNG')}
                </text>
              </Box>
              <text x={430} y={y + 58} class="hm-sub" text-anchor="middle">
                {(v(), `${f0(dev(t).q)} m³/h · ${f1(dev(t).h)} m · ${dev(t).mode === 'auto' ? 'TỰ ĐỘNG' : 'TAY'}`)}
              </text>
            </>
          )
        }}
      </For>
      <Pipe d="M600 160V480M600 320H1180" fluid="clean" w={9} flow={(v(), sim.qOut > 1)} />
      <Valve tag="MV-701" x={720} y={320} open={(v(), dev('MV-701').open)} onOpen={props.onOpen} s={14} />
      <Value x={790} y={250} label="FT-701 lưu lượng" value={(v(), f0(sim.qOut))} unit="m³/h" tag="FT-701" onOpen={props.onOpen} />
      <Value x={930} y={250} label="PT-701 áp lực" value={(v(), f2(sim.pOut))} unit="bar" warn={(v(), sim.pOut < 2.5)} tag="PT-701" onOpen={props.onOpen} />
      <T x={1060} y={308} cls="hm-sub">
        D1000 → mạng lưới
      </T>
      <Trend x={790} y={380} w={380} h={120} data={(v(), sim.history.pOut)} color="#3c9be8" label="Áp lực đầu ra 24 h" unit="bar" band={[3.6, 4.8]} />
      <Value x={620} y={520} label="Nhu cầu mạng" value={(v(), f0(sim.qDemand))} unit="m³/h" />
      <Value x={750} y={520} label="Điểm đặt áp" value="4,20" unit="bar" />
      <Value x={880} y={520} label="MCC-07 phụ tải" value={(v(), f0(dev('P-NS-01').kw + dev('P-NS-02').kw + dev('P-NS-03').kw))} unit="kW" tag="MCC-07" onOpen={props.onOpen} />
      <Value x={1010} y={520} label="Suất điện năng" value={(v(), f2(sim.specificEnergy))} unit="kWh/m³" />
    </>
  )
}

function ChemScreen(props: ScreenProps) {
  const { sim, v, st, dev } = useState()
  return (
    <>
      <T x={16} y={24}>
        Nhà hóa chất (PAC 17 %, polymer) · nhà clo (clo hóa sơ bộ + khử trùng)
      </T>
      <For each={['T-PAC-01', 'T-PAC-02']}>{(t, i) => <Tank x={40 + i() * 110} y={110} w={80} h={150} level={(v(), 0.62 + 0.2 * Math.sin(sim.t / 9000 + t.length + i()))} label={t} fluid="chem" tag={t} onOpen={props.onOpen} />}</For>
      <For each={['DP-PAC-01', 'DP-PAC-02']}>
        {(t, i) => (
          <>
            <Pipe d={`M${80 + i() * 110} 260V320`} fluid="chem" w={4} />
            <Pump tag={t} x={80 + i() * 110} y={340} r={16} state={st(t)} onOpen={props.onOpen} sub={(v(), dev(t).run ? `${f1(dev(t).sp)} mg/L` : 'Dừng')} />
          </>
        )}
      </For>
      <Pipe d="M80 356V420H190V356M135 420V480H500" fluid="chem" w={4} flow={(v(), sim.pacDose > 0)} />
      <Tank x={270} y={150} w={70} h={110} level={0.55} label="T-POL-01" fluid="chem" tag="T-POL-01" onOpen={props.onOpen} />
      <Pump tag="DP-POL-01" x={305} y={340} r={14} state={st('DP-POL-01')} onOpen={props.onOpen} sub={(v(), `${f2(dev('DP-POL-01').sp)} mg/L`)} />
      <Pipe d="M305 260V326M305 354V500H500" fluid="chem" w={3} flow={(v(), dev('DP-POL-01').run)} />
      <T x={410} y={470} cls="hm-sub">
        → bể trộn
      </T>
      <Value x={40} y={530} label="Liều PAC yêu cầu (jar test)" w={170} value={(v(), f1(8 + 0.13 * sim.rawTurb))} unit="mg/L" />
      {/* chlorine */}
      <rect x="560" y="90" width="620" height="460" fill="none" stroke="#9aa6b4" stroke-dasharray="6 4" />
      <T x={572} y={110} cls="hm-sub">
        Nhà clo
      </T>
      <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
        {k => (
          <g class="hm-click" onClick={() => props.onOpen('CYL-901')}>
            <rect x={590 + (k % 5) * 62} y={140 + Math.floor(k / 5) * 50} width="54" height="30" rx="12" fill={k < 2 ? '#e0b021' : '#8a7a3a'} stroke="#dfe7ef" />
            <text x={617 + (k % 5) * 62} y={160 + Math.floor(k / 5) * 50} class="hm-sub" text-anchor="middle">
              {k < 2 ? 'đang dùng' : '900 kg'}
            </text>
          </g>
        )}
      </For>
      <For each={['CL-901', 'CL-902']}>
        {(t, i) => (
          <>
            <Box x={600 + i() * 190} y={300} w={150} h={60} tag={t} onOpen={props.onOpen} label={i() ? 'CL-902 khử trùng' : 'CL-901 clo hóa sơ bộ'} fill="#1c2b1c">
              <text x={675 + i() * 190} y={337} class="hm-val" text-anchor="middle">
                {(v(), `${f2(dev(t).q)} kg/h`)}
              </text>
            </Box>
            <Pipe d={`M${675 + i() * 190} 360V${i() ? 470 : 430}H1170`} fluid="cl" w={3} flow={(v(), dev(t).q > 0)} />
          </>
        )}
      </For>
      <T x={1060} y={423} cls="hm-sub">
        → bể trộn
      </T>
      <T x={1060} y={463} cls="hm-sub">
        → bể chứa
      </T>
      <Value x={1000} y={140} label="GD-901 rò rỉ Cl₂" value={(v(), f2(sim.leak))} unit="ppm" warn={(v(), sim.leak > 1)} tag="GD-901" onOpen={props.onOpen} />
      <Box x={1010} y={200} w={100} h={70} tag="SC-901" onOpen={props.onOpen} label="Tháp trung hòa" fill={(v(), dev('SC-901').run) ? '#4a3a12' : '#18212b'}>
        <text x={1060} y={240} class="hm-sub" text-anchor="middle">
          {(v(), dev('SC-901').run ? 'ĐANG TRUNG HÒA' : 'Chờ')}
        </text>
      </Box>
      <Value x={600} y={500} label="Clo dư bể chứa AIT-601" w={170} value={(v(), f2(sim.clRes))} unit="mg/L" warn={(v(), sim.clRes < 0.3)} tag="AIT-601" onOpen={props.onOpen} />
      <MimicButton x={800} y={506} w={150} label="Mô phỏng rò rỉ clo" tone="danger" onClick={() => sim.injectLeak()} />
    </>
  )
}

function PowerScreen(props: ScreenProps) {
  const { sim, v, dev } = useState()
  const groups = () => {
    v()
    const sum = (p: string) => Object.values(sim.dev).filter(d => d.tag.startsWith(p)).reduce((s, d) => s + d.kw, 0)
    return [
      ['TB1 nước thô', sum('P-TB1')],
      ['Bơm chuyển tiếp', sum('P-CT')],
      ['Bơm nước sạch', sum('P-NS')],
      ['Rửa lọc + máy gió', sum('P-RL') + sum('B-7')],
      ['Khuấy, hóa chất, clo', sum('M-4') + sum('FL-') + sum('DP-') + sum('CL-')],
      ['Chiếu sáng, văn phòng', 38],
    ] as Array<[string, number]>
  }
  return (
    <>
      <T x={16} y={24}>
        Cung cấp điện · trạm biến áp 22/0,4 kV 1600 kVA
      </T>
      <Box x={80} y={80} w={160} h={90} tag="TR-1101" onOpen={props.onOpen} label="TR-1101">
        <circle cx="140" cy="125" r="22" fill="none" stroke="#dfe7ef" stroke-width="2" />
        <circle cx="175" cy="125" r="22" fill="none" stroke="#dfe7ef" stroke-width="2" />
      </Box>
      <Pipe d="M160 170V230H1120" fluid="air" w={6} />
      <Box x={60} y={250} w={200} h={60} tag="MSB-1101" onOpen={props.onOpen} label="MSB-1101">
        <text x={160} y={287} class="hm-val" text-anchor="middle">
          {(v(), `${f0(sim.powerKw)} kW`)}
        </text>
      </Box>
      <For each={groups()}>
        {([k, kw], i) => (
          <>
            <Pipe d={`M${330 + i() * 135} 230V280`} fluid="air" w={3} />
            <Value x={270 + i() * 135} y={280} w={125} label={k} value={f0(kw)} unit="kW" />
          </>
        )}
      </For>
      <Value x={80} y={380} label="Điện năng hôm nay" w={160} value={(v(), f0(sim.kwhToday))} unit="kWh" />
      <Value x={260} y={380} label="Suất điện năng" w={160} value={(v(), f2(sim.specificEnergy))} unit="kWh/m³" />
      <Value x={440} y={380} label="Hệ số tải MBA" w={160} value={(v(), f1((sim.powerKw / 1600 / 0.9) * 100))} unit="%" tag="TR-1101" onOpen={props.onOpen} />
      <Value x={620} y={380} label="Điện áp thanh cái" w={160} value={(v(), f0(398 + 4 * Math.sin(sim.t / 3000)))} unit="V" />
      <Value x={800} y={380} label="MCC-07" w={160} value={(v(), f0(dev('P-NS-01').kw + dev('P-NS-02').kw + dev('P-NS-03').kw))} unit="kW" tag="MCC-07" onOpen={props.onOpen} />
    </>
  )
}

function TrendScreen() {
  const { sim, v } = useState()
  return (
    <>
      <T x={16} y={24}>
        Xu hướng 24 giờ
      </T>
      <Trend x={20} y={50} w={570} h={160} data={(v(), sim.history.pOut)} color="#3c9be8" label="PT-701 áp lực đầu ra" unit="bar" band={[3.6, 4.8]} />
      <Trend x={610} y={50} w={570} h={160} data={(v(), sim.history.qOut)} color="#62c0f0" label="FT-701 lưu lượng phát" unit="m³/h" />
      <Trend x={20} y={230} w={570} h={160} data={(v(), sim.history.res)} color="#2fbf5a" label="LT-601 mực nước bể chứa" unit="%" band={[30, 95]} min={0} max={100} />
      <Trend x={610} y={230} w={570} h={160} data={(v(), sim.history.turb)} color="#f0a20a" label="AIT-501 độ đục sau lọc" unit="NTU" band={[0, 1]} min={0} />
      <Trend x={20} y={410} w={570} h={160} data={(v(), sim.history.cl)} color="#8fc93a" label="AIT-601 clo dư" unit="mg/L" band={[0.3, 1]} />
      <Trend x={610} y={410} w={570} h={160} data={(v(), sim.history.raw)} color="#a07c4c" label="AIT-201 độ đục nước thô" unit="NTU" />
    </>
  )
}

function AlarmScreen(props: { onOpen: (t: string) => void }) {
  const { sim, v } = useSim()
  const [showLog, setShowLog] = createSignal(false)
  return (
    <div class="hm-table-wrap">
      <div class="hm-table-tools">
        <button type="button" aria-pressed={!showLog()} onClick={() => setShowLog(false)}>
          Báo động
        </button>
        <button type="button" aria-pressed={showLog()} onClick={() => setShowLog(true)}>
          Nhật ký vận hành
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => sim.ackAll()}>
          Xác nhận tất cả
        </button>
      </div>
      <Show
        when={showLog()}
        fallback={
          <table class="hm-table">
            <thead>
              <tr>
                <th>Giờ</th>
                <th>Mức</th>
                <th>Tag</th>
                <th>Nội dung</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              <For each={(v(), sim.alarms.slice(0, 40))}>
                {a => (
                  <tr class={`${a.active ? 'act' : ''} ${a.acked ? '' : 'unack'} ${a.level}`} onClick={() => props.onOpen(a.tag)}>
                    <td>{fmtClock(a.t)}</td>
                    <td>{a.level === 'crit' ? 'NGUY CẤP' : a.level === 'warn' ? 'CẢNH BÁO' : 'TIN'}</td>
                    <td>{a.tag}</td>
                    <td>{a.msg}</td>
                    <td>
                      {a.active ? 'Đang hoạt động' : 'Đã hết'} · {a.acked ? 'đã xác nhận' : 'chưa xác nhận'}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        }
      >
        <table class="hm-table">
          <tbody>
            <For each={(v(), sim.log.slice(0, 60))}>
              {l => (
                <tr>
                  <td>{fmtClock(l.t)}</td>
                  <td>{l.who === 'op' ? 'Vận hành' : l.who === 'auto' ? 'Tự động' : 'Hệ thống'}</td>
                  <td>{l.tag}</td>
                  <td>{l.msg}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  )
}

function NetworkScreen() {
  const { sim, v } = useSim()
  const sol = createMemo(() => {
    v()
    const z = sim.zone
    return solveNetwork({ entryHead: z.head, qZone: z.q, qOut: sim.qOut, qRaw: sim.qRaw, demandFactor: sim.demandFactor, closedValves: sim.closedNetValves })
  })
  const telemetry = NET_DEVICES.filter(d => ['MotorisedValve', 'BulkMeter', 'PressureSensor', 'ChlorineAnalyser', 'RTU', 'AcousticLogger'].includes(d.code))
  return (
    <div class="hm-table-wrap">
      <div class="hm-net-kpis">
        <div>
          <span>Áp lực điểm đấu nối Vĩnh Thịnh</span>
          <b>{(v(), f1(sim.zone.head))} m</b>
        </div>
        <div>
          <span>Lưu lượng vào vùng (DMA)</span>
          <b>
            {(v(), f0(sim.zone.q))} / {(v(), f0(sim.zone.qDemand))} m³/h
          </b>
        </div>
        <div>
          <span>Áp lực thấp nhất mạng</span>
          <b>{f1(sol().minP)} m</b>
        </div>
        <div>
          <span>Đoạn ống mất nước</span>
          <b>{sol().unsupplied}</b>
        </div>
      </div>
      <table class="hm-table">
        <thead>
          <tr>
            <th />
            <th>Tag</th>
            <th>Thiết bị (danh mục)</th>
            <th>Trạng thái</th>
            <th>Số đo</th>
          </tr>
        </thead>
        <tbody>
          <For each={telemetry}>
            {d => {
              const s = () => (v(), deviceStatus(d, sol(), sim))
              return (
                <tr class={s() === 'critical' ? 'crit act' : s() === 'warning' ? 'warn act' : ''}>
                  <td>
                    <CatalogIcon code={d.code} status={s()} size={20} />
                  </td>
                  <td>{d.tag}</td>
                  <td>{d.code}</td>
                  <td>{{ normal: 'Bình thường', warning: 'Cảnh báo', critical: 'Nguy cấp', offline: 'Mất kết nối / mất nước' }[s()]}</td>
                  <td>
                    {(v(),
                    deviceReadings(d.id, sol(), sim)
                      .slice(0, 2)
                      .map(r => `${r.k}: ${r.v}${r.u ? ' ' + r.u : ''}`)
                      .join(' · '))}
                  </td>
                </tr>
              )
            }}
          </For>
        </tbody>
      </table>
    </div>
  )
}
