/* GIS — Tổng quan hạ tầng số mạng lưới (SolidJS port of dashboard.jsx). */
import { For, Show, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { cAccent, chex, fmtDec, fmtInt, tone } from '../lib/theme'
import { Btn, Card, ScreenHead, StackBar, Tile } from '../ui/kit'
import type { Route } from '../shell/nav'

interface Kpi {
  label: string
  value: string | number
  unit?: string
  icon: string
  col: string
  sub?: string
  to?: string
}

function GKpi(props: { k: Kpi; go: (r: Route) => void }) {
  const col = () => tone(props.k.col)
  return (
    <button
      onClick={props.k.to ? () => props.go({ name: props.k.to! }) : undefined}
      class={
        'flex items-center gap-3 rounded-[10px] border border-line bg-[var(--surface)] px-3.5 py-3 text-left transition-colors ' +
        (props.k.to ? 'hover:border-[color:var(--text2)]' : '')
      }
      style={{ cursor: props.k.to ? 'pointer' : 'default' }}
    >
      <Tile icon={props.k.icon} col={props.k.col} size={38} />
      <div class="min-w-0 flex-1">
        <div class="truncate text-[11.5px] text-[color:var(--muted)]">{props.k.label}</div>
        <div class="mt-0.5 flex items-baseline gap-1.5">
          <span class="whitespace-nowrap font-mono text-[22px] font-semibold leading-none text-[color:var(--text)]">{props.k.value}</span>
          <Show when={props.k.unit}>
            <span class="shrink-0 text-[11px] text-[color:var(--muted2)]">{props.k.unit}</span>
          </Show>
        </div>
        <Show when={props.k.sub}>
          <div class="mt-1 truncate text-[10.5px]" style={{ color: col() }}>
            {props.k.sub}
          </div>
        </Show>
      </div>
    </button>
  )
}

export function DashboardScreen(props: { go: (r: Route) => void; toast: (m: string, k?: string) => void }): JSX.Element {
  const G = useGis()
  const D = G.DASH
  const kpis: Kpi[] = [
    { label: 'Tổng chiều dài ống', value: fmtDec(D.pipeKm, 1), unit: 'km', icon: 'IcPipe', col: '#0E7C86', sub: D.pipeCount + ' tuyến · ' + G.MATERIALS.length + ' loại vật liệu', to: 'assets' },
    { label: 'Tài sản điểm', value: fmtInt(D.valveCount + D.hydrantCount), unit: 'đối tượng', icon: 'IcValve', col: '#0969DA', sub: D.valveCount + ' van · ' + D.hydrantCount + ' trụ PCC', to: 'assets' },
    { label: 'Đấu nối khách hàng', value: fmtInt(D.connCount), icon: 'IcPlug', col: '#9A6700', sub: D.geocodedPct + '% đã geocode · ' + D.rtkPct + '% GPS RTK', to: 'connections' },
    { label: 'Lỗi topology mở', value: D.topoOpen, icon: 'IcGitBranch', col: '#D1242F', sub: 'Cần xử lý trước khi đồng bộ Hydraulic', to: 'topology' },
  ]
  const queue = [
    { icon: 'IcCheckBadge', col: '#8250DF', label: 'Change set chờ duyệt', n: D.csPending, to: 'versions' },
    { icon: 'IcUpload', col: '#0E7C86', label: 'Job import đang xử lý', n: D.importPending, to: 'import' },
    { icon: 'IcMobile', col: '#D86C1F', label: 'Bản ghi hiện trường chờ đồng bộ', n: D.fieldPending, to: 'field' },
  ]
  const matCols = ['#0E7C86', '#0969DA', '#8250DF', '#D86C1F', '#1A7F37']
  return (
    <div class="flex flex-col gap-3" data-screen-label="Tổng quan GIS">
      <ScreenHead
        title="Tổng quan hạ tầng số mạng lưới"
        sub={'Bản đồ GIS · tài sản không gian · topology — cập nhật ' + G.TODAY}
        right={
          <>
            <Btn variant="default" size="sm" icon="IcGitBranch" onClick={() => props.go({ name: 'topology' })}>
              Topology
            </Btn>
            <Btn variant="primary" size="sm" icon="IcLayers" onClick={() => props.go({ name: 'layers' })}>
              Lớp bản đồ
            </Btn>
          </>
        }
      />

      <div class="grid grid-cols-1 gap-2">
        <For each={kpis}>{(k) => <GKpi k={k} go={props.go} />}</For>
      </div>

      <div class="grid grid-cols-1 gap-3">
        {/* queue + roles */}
        <div class="flex flex-col gap-4">
          <Card>
            <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Hàng đợi xử lý</div>
            <div class="flex flex-col gap-1">
              <For each={queue}>
                {(q) => (
                  <button onClick={() => props.go({ name: q.to })} class="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]">
                    <Tile icon={q.icon} col={q.col} size={34} />
                    <span class="min-w-0 flex-1 text-[12px] text-[color:var(--text2)]">{q.label}</span>
                    <span class="rounded-full px-2 py-0.5 font-mono text-[12px] font-semibold" style={{ background: chex(tone(q.col), 0.14), color: tone(q.col) }}>
                      {q.n}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Card>
          <Card>
            <div class="mb-2.5 text-[13px] font-semibold text-[color:var(--text)]">Vai trò người dùng</div>
            <div class="flex flex-col gap-1.5">
              <For each={G.ROLES}>
                {(r) => (
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[11px] font-medium" style={{ color: cAccent() }}>
                      {r.id}
                    </span>
                    <span class="ml-auto font-mono text-[11px] text-[color:var(--muted)]">{r.n}</span>
                  </div>
                )}
              </For>
            </div>
          </Card>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3">
        <Card>
          <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Tình trạng tuyến ống</div>
          <StackBar rows={D.condMix.map((c) => ({ label: c.label, n: c.n, col: c.col }))} />
        </Card>
        <Card>
          <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Vật liệu ống</div>
          <StackBar rows={D.matMix.map((m, i) => ({ label: m.label, n: m.n, col: matCols[i] }))} />
        </Card>
        <Card>
          <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Luồng dữ liệu service</div>
          <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Đầu vào</div>
          <div class="flex flex-col gap-1.5">
            <For each={G.DATAFLOW.inputs}>
              {(f) => (
                <div class="flex items-center gap-2 text-[11.5px]">
                  <span class="font-mono font-medium text-[color:var(--text2)]">{f.src}</span>
                  <span class="text-[color:var(--muted2)]">→</span>
                  <span class="text-[color:var(--muted)]">{f.label}</span>
                </div>
              )}
            </For>
          </div>
          <div class="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Sự kiện phát ra</div>
          <div class="flex flex-wrap gap-1">
            <For each={G.DATAFLOW.outputs}>
              {(o) => (
                <span class="rounded-md bg-[var(--surface2)] px-1.5 py-0.5 font-mono text-[10px]" style={{ color: tone('#0E7C86') }}>
                  {o}
                </span>
              )}
            </For>
          </div>
        </Card>
      </div>
    </div>
  )
}
