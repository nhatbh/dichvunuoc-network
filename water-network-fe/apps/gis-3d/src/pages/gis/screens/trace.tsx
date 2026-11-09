/* GIS — Truy vết mạng & cô lập van (SolidJS port of trace.jsx). */
import { findComponent } from '@wn/contracts/catalog'
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { topologyApi } from '../lib/topology-api'
import type { Selection } from '../ui/network-map'
import { useGis } from '../lib/gis-data'
import { cAccent, chex, fmtInt, tone } from '../lib/theme'
import { Badge, Btn, Card, DmaChip, Empty, ScreenHead, SegToggle } from '../ui/kit'
import { MapOverlay } from '../shell/map-stage'

type TraceMode = 'isolation' | 'upstream' | 'downstream'
interface Result {
  kind: 'isolation' | 'trace'
  pipes: string[]
  valves: string[]
  services: number
  nodes: number
  sources: string[]
  /** topology-rs had (or could build) the tenant's graph */
  ready: boolean
}

export function TraceScreen(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const G = useGis()
  const [mode, setMode] = createSignal<TraceMode>('isolation')
  const [running, setRunning] = createSignal(false)
  const [result, setResult] = createSignal<Result | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  // target: a pipe picked on the map; by default the demo's isolation target, else the first pipe
  const [targetId, setTargetId] = createSignal<string>(G.pipeBy[G.isolation?.target]?.id ?? G.pipes[0]?.id ?? '')
  const targetPipe = createMemo(() => G.pipeBy[targetId()] ?? G.pipes[0]!)
  const ran = () => result() !== null

  const run = async () => {
    const pipe = targetPipe()
    if (!pipe) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      if (mode() === 'isolation') {
        const r = await topologyApi.isolate({ pipeId: pipe.id })
        setResult({ kind: 'isolation', pipes: r.isolatedPipes, valves: r.valvesToClose, services: r.affectedServices.length, nodes: r.isolatedNodes.length, sources: [], ready: r.graphReady })
      } else {
        const r = await topologyApi.trace(pipe.from, mode() as 'upstream' | 'downstream')
        setResult({ kind: 'trace', pipes: r.pipeIds, valves: [], services: 0, nodes: r.nodeIds.length, sources: r.sourceNodeIds, ready: r.graphReady })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      props.toast(e instanceof Error ? e.message : 'Không thể chạy phân tích mạng.', 'err')
    } finally {
      setRunning(false)
    }
  }

  const closeValves = createMemo(() => new Set(result()?.valves ?? []))
  const valveObjs = createMemo(() =>
    (result()?.valves ?? []).map(id => {
      const v = G.valves.find(x => x.id === id)
      const d = v ? undefined : G.sourceDevices.find(x => x.id === id)
      return { id, code: v?.code ?? d?.code ?? id, dn: v?.dn, kind: v?.kind ?? d?.deviceType }
    })
  )
  const valveLabel = (kind: string | undefined) =>
    kind === 'boundary' ? 'Van biên' : (findComponent(kind)?.vi ?? 'Van chặn')

  const emphasis = createMemo(() =>
    ran() ? { dim: true, pipes: result()!.pipes, valvesClosed: closeValves(), valvesOpen: new Set<string>() } : {}
  )

  const pins = createMemo(() => {
    const p = targetPipe()
    const mid = p?.pts?.[0] && p.pts[p.pts.length - 1] ? [(p.pts[0][0] + p.pts[p.pts.length - 1]![0]) / 2, (p.pts[0][1] + p.pts[p.pts.length - 1]![1]) / 2] : [0, 0]
    return [{ id: 'target', x: mid[0]!, y: mid[1]!, col: tone('#D1242F'), pulse: true }]
  })

  const focus = createMemo(() => ({
    x: targetPipe().pts[0][0] - 260,
    y: targetPipe().pts[0][1] - 200,
    w: 520,
    h: 420,
    _k: mode() === 'isolation' ? 0 : mode() === 'upstream' ? 1 : 2,
  }))

  const pick = (sel: Selection) => {
    if (sel?.type !== 'pipe' || !G.pipeBy[sel.id]) return
    setTargetId(sel.id)
    setResult(null)
  }

  return (
    <div class="flex flex-col gap-3" data-screen-label="Truy vết & cô lập">
      <ScreenHead
        title="Truy vết mạng & cô lập van"
        sub="Xác định tập van cần đóng và vùng bị ảnh hưởng khi sửa chữa — dùng chung bởi CMMS & Hydraulic"
      />

      <div class="grid grid-cols-1 gap-4">
        {/* control + results */}
        <div class="flex flex-col gap-4">
          <Card>
            <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Loại phân tích</div>
            <SegToggle
              value={mode()}
              onChange={(m) => {
                setMode(m as TraceMode)
                setResult(null)
              }}
              options={[
                { id: 'isolation', label: 'Cô lập van', icon: 'IcValve' },
                { id: 'upstream', label: 'Ngược dòng', icon: 'IcArrowUp' },
                { id: 'downstream', label: 'Xuôi dòng', icon: 'IcArrowDown' },
              ]}
            />
            <div class="mt-3 rounded-lg border border-line bg-[var(--surface2)] p-3">
              <div class="flex items-center gap-2">
                <span style={{ color: tone('#D1242F') }}>
                  {/* crosshair icon inline */}
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" stroke-width={1.7} stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </span>
                <span class="text-[12px] font-medium text-[color:var(--text)]">Điểm phân tích</span>
              </div>
              <div class="mt-1.5 flex items-center justify-between text-[11.5px]">
                <span class="text-[color:var(--muted)]">Tuyến ống vỡ giả định</span>
                <span class="font-mono text-[color:var(--text2)]">{targetPipe().code}</span>
              </div>
              <div class="mt-1 flex items-center justify-between text-[11.5px]">
                <span class="text-[color:var(--muted)]">DMA</span>
                <DmaChip dma={targetPipe().dma} sm />
              </div>
              <div class="mt-1.5 text-[10.5px] text-[color:var(--muted2)]">Bấm vào một tuyến ống trên bản đồ để đổi điểm phân tích.</div>
            </div>
            <div class="mt-3">
              <Btn full variant="primary" icon={running() ? 'IcRefresh' : 'IcRoute'} onClick={() => void run()} disabled={running()}>
                {running() ? 'Đang chạy graph…' : 'Chạy phân tích'}
              </Btn>
            </div>
          </Card>

          <Show
            when={ran()}
            fallback={
              <Card>
                <Empty
                  icon="IcRoute"
                  title={running() ? 'Đang tính toán…' : error() ? 'Chưa chạy được phân tích' : 'Chưa có kết quả'}
                  hint={error() ?? 'Bấm "Chạy phân tích" để graph engine tính tập van cô lập và vùng ảnh hưởng.'}
                />
              </Card>
            }
          >
            <Card>
              <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">
                {mode() === 'isolation' ? 'Kết quả cô lập' : 'Kết quả truy vết'}
              </div>
              <Show when={!result()!.ready}>
                <p class="mb-3 text-[12px] text-[color:var(--muted)]">Dịch vụ topology chưa nạp được mạng lưới của đơn vị; kết quả có thể trống.</p>
              </Show>
              <div class="grid grid-cols-2 gap-2.5">
                <For
                  each={[
                    ['Van cần đóng', valveObjs().length, '#D1242F'],
                    ['Đoạn ảnh hưởng', result()!.pipes.length, '#0E7C86'],
                    ['Đấu nối mất nước', result()!.services, '#9A6700'],
                    ['Nút trong vùng', result()!.nodes, '#8250DF'],
                  ] as [string, number, string][]}
                >
                  {(s) => (
                    <div class="rounded-lg border border-line p-2.5">
                      <div class="font-mono text-[19px] font-semibold leading-none" style={{ color: tone(s[2]) }}>
                        {fmtInt(s[1])}
                      </div>
                      <div class="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div>
                    </div>
                  )}
                </For>
              </div>
              <Show
                when={mode() === 'isolation'}
                fallback={
                  <p class="mt-3 text-[12px] leading-relaxed text-[color:var(--muted)]">
                    Truy vết {mode() === 'upstream' ? 'ngược dòng về nguồn cấp' : 'xuôi dòng tới các điểm tiêu thụ'} từ tuyến ống chọn —{' '}
                    {result()!.pipes.length} đoạn nằm trên đường truy vết.
                    <Show when={mode() === 'upstream'}>
                      {' '}
                      {result()!.sources.length ? `Đến ${result()!.sources.length} nguồn cấp.` : 'Không tìm thấy nguồn cấp (van đóng hoặc mạng chưa nối tới nguồn).'}
                    </Show>
                  </p>
                }
              >
                <>
                  <div class="mb-2 mt-3.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Trình tự đóng van</div>
                  <div class="flex flex-col gap-1.5">
                    <For each={valveObjs()}>
                      {(v, i) => (
                        <div class="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
                          <span
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold"
                            style={{ background: chex(tone('#D1242F'), 0.14), color: tone('#D1242F') }}
                          >
                            {i() + 1}
                          </span>
                          <span class="flex-1 font-mono text-[12px] text-[color:var(--text)]">
                            {v.code}{v.dn ? ` · DN${v.dn}` : ''}
                          </span>
                          <Badge color={tone('#0969DA')} soft>
                            {valveLabel(v.kind)}
                          </Badge>
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="mt-3 flex items-center gap-2">
                    <Btn
                      size="sm"
                      variant="primary"
                      icon="IcSend"
                      onClick={() => props.toast('Đã gửi tập van sang CMMS để lập phiếu công việc')}
                    >
                      Gửi CMMS
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      icon="IcDownload"
                      onClick={() => props.toast('Phát event gis.network-isolation.calculated')}
                    >
                      Xuất
                    </Btn>
                  </div>
                </>
              </Show>
            </Card>
          </Show>
        </div>

        {/* map */}
        <Card pad={false} class="overflow-hidden">
          <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span class="text-[13px] font-semibold text-[color:var(--text)]">Vùng ảnh hưởng</span>
            <div class="flex items-center gap-3 text-[10.5px] text-[color:var(--muted)]">
              <span class="flex items-center gap-1.5">
                <span class="inline-block h-2.5 w-2.5 rotate-45" style={{ background: tone('#D1242F') }} />
                Van đóng
              </span>
              <span class="flex items-center gap-1.5">
                <span class="inline-block h-[3px] w-5 rounded" style={{ background: cAccent() }} />
                Đoạn cô lập
              </span>
            </div>
          </div>
          <MapOverlay
              layers={{ basemap: true, dma: true, pipe: true, valve: true, conn: true, source: true }}
              emphasis={ran() ? emphasis() : {}}
              pins={pins()}
              onSelect={pick}
              selected={{ type: 'pipe', id: targetPipe().id }}
              focus={focus()}
              controls
              legend={false}
            />
        </Card>
      </div>
    </div>
  )
}
