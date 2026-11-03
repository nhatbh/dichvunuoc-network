/* GIS — Truy vết mạng & cô lập van (SolidJS port of trace.jsx). */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { cAccent, chex, fmtInt, tone } from '../lib/theme'
import { Badge, Btn, Card, DmaChip, Empty, ScreenHead, SegToggle } from '../ui/kit'
import { NetworkMapOL } from '../ui/network-map-ol'

type TraceMode = 'isolation' | 'upstream' | 'downstream'

export function TraceScreen(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const G = useGis()
  const ISO = G.isolation
  const [mode, setMode] = createSignal<TraceMode>('isolation')
  const [ran, setRan] = createSignal(true)
  const [running, setRunning] = createSignal(false)

  const targetPipe = G.pipeBy[ISO.target]!

  const empPipes = createMemo(() => {
    if (mode() === 'isolation') return ISO.affectedPipes
    return G.pipes.filter((p) => p.dma === targetPipe.dma).slice(0, mode() === 'upstream' ? 7 : 10).map((p) => p.id)
  })

  const closeValves = new Set(ISO.valves)
  const valveObjs = createMemo(() =>
    ISO.valves.map((id) => G.valves.find((v) => v.id === id)).filter(Boolean) as typeof G.valves,
  )

  const emphasis = createMemo(() =>
    ran()
      ? { dim: true, pipes: empPipes(), valvesClosed: closeValves, valvesOpen: new Set<string>() }
      : {},
  )

  const pins = [
    {
      id: 'target',
      x: ISO.targetMid[0],
      y: ISO.targetMid[1],
      col: tone('#D1242F'),
      pulse: true,
    },
  ]

  const focus = createMemo(() => ({
    x: targetPipe.pts[0][0] - 260,
    y: targetPipe.pts[0][1] - 200,
    w: 520,
    h: 420,
    _k: mode() === 'isolation' ? 0 : mode() === 'upstream' ? 1 : 2,
  }))

  const run = () => {
    setRunning(true)
    setRan(false)
    props.toast('Chạy ' + (mode() === 'isolation' ? 'phân tích cô lập' : 'truy vết') + ' bằng graph engine…')
    setTimeout(() => {
      setRunning(false)
      setRan(true)
    }, 1300)
  }

  return (
    <div class="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Truy vết & cô lập">
      <ScreenHead
        title="Truy vết mạng & cô lập van"
        sub="Xác định tập van cần đóng và vùng bị ảnh hưởng khi sửa chữa — dùng chung bởi CMMS & Hydraulic"
      />

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {/* control + results */}
        <div class="flex flex-col gap-4">
          <Card>
            <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Loại phân tích</div>
            <SegToggle
              value={mode()}
              onChange={(m) => {
                setMode(m as TraceMode)
                setRan(false)
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
                <span class="font-mono text-[color:var(--text2)]">{targetPipe.code}</span>
              </div>
              <div class="mt-1 flex items-center justify-between text-[11.5px]">
                <span class="text-[color:var(--muted)]">DMA</span>
                <DmaChip dma={targetPipe.dma} sm />
              </div>
            </div>
            <div class="mt-3">
              <Btn full variant="primary" icon={running() ? 'IcRefresh' : 'IcRoute'} onClick={run} disabled={running()}>
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
                  title={running() ? 'Đang tính toán…' : 'Chưa có kết quả'}
                  hint={'Bấm "Chạy phân tích" để graph engine tính tập van cô lập và vùng ảnh hưởng.'}
                />
              </Card>
            }
          >
            <Card>
              <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">
                {mode() === 'isolation' ? 'Kết quả cô lập' : 'Kết quả truy vết'}
              </div>
              <div class="grid grid-cols-2 gap-2.5">
                <For
                  each={[
                    ['Van cần đóng', valveObjs().length, '#D1242F'],
                    ['Đoạn ảnh hưởng', empPipes().length, '#0E7C86'],
                    ['Đấu nối mất nước', ISO.affectedConns, '#9A6700'],
                    ['Dân số ~', Math.round(ISO.estPop), '#8250DF'],
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
                    {empPipes().length} đoạn nằm trên đường truy vết.
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
                            {v.code} · DN{v.dn}
                          </span>
                          <Badge color={tone('#0969DA')} soft>
                            {v.kind === 'boundary' ? 'Van biên' : 'Van chặn'}
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
          <div class="h-[520px]">
            <NetworkMapOL
              layers={{ basemap: true, dma: true, pipe: true, valve: true, conn: true, source: true }}
              emphasis={ran() ? emphasis() : {}}
              pins={pins}
              focus={focus()}
              controls
              legend={false}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
