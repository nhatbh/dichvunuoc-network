/**
 * The plant's process train as one strip of pipe: raw water (brown) → settled (green-grey) → clean (blue), each
 * step with its live value and status. Clicking a step flies the 3D view there; the last step goes back to the
 * network map. The pipe segments move while water flows through them.
 */
import { For, Show } from 'solid-js'
import { SHORT, STAGES, unitState, type UnitState } from './areas'
import { f0, f1, f2, useSim } from './sim-context'

const C = Object.fromEntries(STAGES.map(s => [s.id, s.color])) as Record<string, string>
const STATE_VI: Record<UnitState, string> = { run: 'đang chạy', man: 'cần chú ý', stop: 'đang dừng', fault: 'sự cố' }

export function ProcessStrip(props: { unit: string | null; onPick: (id: string) => void; onNetwork: () => void }) {
  const { sim, v } = useSim()
  const filters = () => ['F-501', 'F-502', 'F-503', 'F-504'].map(t => sim.dev[t]!)
  const nodes: Array<{ id: string; label: string; val: () => [string, string]; sub: () => string; out?: string; flow?: () => number; warn?: () => boolean }> = [
    { id: 'TB1', label: 'Thu nước sông', val: () => [f0(sim.qRaw), 'm³/h'], sub: () => `Sông +${f1(sim.riverLevel)} m`, out: C.raw, flow: () => sim.qRaw },
    { id: 'S02', label: 'Hồ sơ lắng', val: () => [f1(sim.pondLevel), 'm'], sub: () => `Đục ${f0(sim.rawTurb)} NTU`, out: C.raw, flow: () => sim.qTransfer, warn: () => sim.rawTurb > 180 },
    { id: 'S03', label: 'Bơm chuyển tiếp', val: () => [f0(sim.qTransfer), 'm³/h'], sub: () => `${['P-CT-01', 'P-CT-02', 'P-CT-03'].filter(t => sim.dev[t]!.run).length}/3 bơm chạy`, out: C.raw, flow: () => sim.qTransfer },
    { id: 'S04', label: 'Trộn, lắng', val: () => [f1(sim.settledTurb), 'NTU'], sub: () => `PAC ${f1(sim.pacDose)} mg/L`, out: C.treat, flow: () => sim.qTransfer, warn: () => sim.settledTurb > 5 },
    {
      id: 'S05',
      label: 'Lọc nhanh',
      val: () => [f2(sim.filteredTurb), 'NTU'],
      sub: () => {
        const w = filters().filter(d => d.phase !== 'filter' && d.phase !== 'standby').length
        return w ? `${4 - w}/4 lọc, ${w} đang rửa` : '4/4 bể đang lọc'
      },
      out: C.clean,
      flow: () => sim.qFiltered,
      warn: () => sim.filteredTurb > 1,
    },
    { id: 'S06', label: 'Bể chứa', val: () => [f0(sim.reservoirPct), '%'], sub: () => `Clo ${f2(sim.clRes)} mg/L`, out: C.clean, flow: () => sim.qOut, warn: () => sim.reservoirPct < 20 || sim.clRes < 0.3 },
    { id: 'S07', label: 'Bơm nước sạch', val: () => [f2(sim.pOut), 'bar'], sub: () => `${f0(sim.qOut)} m³/h`, out: C.clean, flow: () => sim.qOut, warn: () => sim.pOut < 2.5 },
    { id: 'NET', label: 'Mạng lưới', val: () => [f0(sim.zone.head), 'm'], sub: () => `${f0(sim.zone.q)} m³/h` },
  ]
  const stateOf = (id: string): UnitState => (id === 'NET' ? (sim.zone.head < 15 ? 'fault' : sim.zone.head < 20 ? 'man' : 'run') : unitState(sim, id))
  return (
    <nav class="tw-process tw-glass" aria-label="Sơ đồ công nghệ">
      <For each={nodes}>
        {(n, i) => {
          const st = () => (v(), stateOf(n.id))
          const warn = () => (v(), n.warn?.() ?? false)
          return (
            <>
              <button
                type="button"
                class="tw-pn"
                classList={{ sel: props.unit === n.id, warn: warn() }}
                data-state={st()}
                onClick={() => (n.id === 'NET' ? props.onNetwork() : props.onPick(n.id))}
                title={n.id === 'NET' ? 'Về bản đồ mạng lưới' : SHORT[n.id]}
              >
                <span class="top">
                  <span class={`tw-dot ${st()}`} aria-hidden="true" />
                  <span class="name">{n.label}</span>
                  <span class="tw-sr">, {STATE_VI[st()]}</span>
                </span>
                <span class="val">
                  <b>{(v(), n.val()[0])}</b>
                  <small>{n.val()[1]}</small>
                </span>
                <span class="sub">{(v(), n.sub())}</span>
              </button>
              <Show when={i() < nodes.length - 1}>
                <span class="tw-pipe" classList={{ still: (v(), (n.flow?.() ?? 0) < 5) }} style={{ '--c': n.out ?? C.clean }} aria-hidden="true" />
              </Show>
            </>
          )
        }}
      </For>
    </nav>
  )
}
