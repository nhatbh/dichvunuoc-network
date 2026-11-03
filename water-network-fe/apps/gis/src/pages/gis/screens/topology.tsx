/* GIS — Kiểm tra & sửa lỗi topology (SolidJS port of topology.jsx). */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { useGis, type TopoIssue } from '../lib/gis-data'
import { IcAlert, IcInfo, IcWarnTri } from '../lib/icons'
import { chex, fmtInt, rad, tone } from '../lib/theme'
import { Badge, Btn, Card, DmaChip, Empty, KV, ScreenHead, Select, Tile } from '../ui/kit'
import { NetworkMapOL } from '../ui/network-map-ol'

export function TopologyScreen(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const G = useGis()
  const [issues, setIssues] = createSignal<TopoIssue[]>(G.topoIssues.map((t) => ({ ...t })))
  const [sel, setSel] = createSignal<string | null>(null)
  const [kind, setKind] = createSignal('all')
  const [status, setStatus] = createSignal('open')
  const [running, setRunning] = createSignal(false)

  const rows = createMemo(() =>
    issues().filter((t) => (kind() === 'all' || t.kind === kind()) && (status() === 'all' || t.status === status())),
  )

  const open = createMemo(() => issues().filter((t) => t.status === 'open'))
  const errs = createMemo(() => open().filter((t) => G.TOPO_KINDS[t.kind]?.sev === 'error').length)
  const warns = createMemo(() => open().filter((t) => G.TOPO_KINDS[t.kind]?.sev === 'warn').length)
  const infos = createMemo(() => open().filter((t) => G.TOPO_KINDS[t.kind]?.sev === 'info').length)
  const fixed = createMemo(() => issues().filter((t) => t.status === 'fixed').length)

  const pins = createMemo(() =>
    rows().map((t) => ({
      id: t.id,
      x: t.x,
      y: t.y,
      col: tone(G.TOPO_KINDS[t.kind]?.col ?? '#7E8997'),
      shape: 'diamond' as const,
      pulse: sel() === t.id,
      sel: sel() === t.id,
      onClick: () => setSel(t.id),
    })),
  )

  const selIssue = createMemo(() => issues().find((t) => t.id === sel()) ?? null)
  const focus = createMemo(() => {
    const si = selIssue()
    return si ? { x: si.x - 90, y: si.y - 90, w: 180, h: 180, _k: Math.random() } : null
  })

  const runValidation = () => {
    setRunning(true)
    props.toast('Đang chạy topology validation trên graph engine…')
    setTimeout(() => {
      setRunning(false)
      props.toast('Hoàn tất: ' + open().length + ' vấn đề · ' + errs() + ' lỗi nghiêm trọng', 'info')
    }, 1600)
  }

  const setIssueStatus = (id: string, st: 'fixed' | 'ignored', msg: string) => {
    setIssues((a) => a.map((t) => (t.id === id ? { ...t, status: st } : t)))
    props.toast(msg)
  }

  const kindOpts = [{ value: 'all', label: 'Mọi loại lỗi' }].concat(
    Object.entries(G.TOPO_KINDS).map(([k, v]) => ({ value: k, label: v.label })),
  )

  return (
    <div class="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Topology">
      <ScreenHead
        title="Kiểm tra & sửa lỗi topology"
        sub="Chỉ dữ liệu sạch topology mới được đồng bộ sang Hydraulic & DMA"
        right={
          <Btn
            size="sm"
            variant="primary"
            icon={running() ? 'IcRefresh' : 'IcGitBranch'}
            onClick={runValidation}
            disabled={running()}
          >
            {running() ? 'Đang kiểm tra…' : 'Chạy validation'}
          </Btn>
        }
      />

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <For
          each={[
            ['Lỗi nghiêm trọng', errs(), '#D1242F', 'IcAlert'],
            ['Cảnh báo', warns(), '#D86C1F', 'IcWarnTri'],
            ['Gợi ý', infos(), '#0969DA', 'IcInfo'],
            ['Đã xử lý', fixed(), '#1A7F37', 'IcCheckCircle'],
          ] as [string, number, string, string][]}
        >
          {(s) => (
            <div
              class="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5"
              style={{ 'box-shadow': 'var(--card-shadow)', 'border-radius': `${rad() + 2}px` }}
            >
              <Tile icon={s[3]} col={s[2]} size={38} />
              <div>
                <div class="font-mono text-[20px] font-semibold leading-none text-[color:var(--text)]">{fmtInt(s[1])}</div>
                <div class="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        {/* list */}
        <Card pad={false} class="overflow-hidden">
          <div class="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <div class="flex-1">
              <Select value={kind()} onChange={setKind} options={kindOpts} />
            </div>
            <div class="w-[120px]">
              <Select
                value={status()}
                onChange={setStatus}
                options={[
                  { value: 'open', label: 'Đang mở' },
                  { value: 'all', label: 'Tất cả' },
                  { value: 'fixed', label: 'Đã sửa' },
                  { value: 'ignored', label: 'Bỏ qua' },
                ]}
              />
            </div>
          </div>
          <div class="max-h-[calc(100vh-330px)] overflow-y-auto">
            <For each={rows()}>
              {(t) => {
                const K = () => G.TOPO_KINDS[t.kind]
                const on = () => sel() === t.id
                const col = () => tone(K()?.col ?? '#7E8997')
                return (
                  <button
                    onClick={() => setSel(t.id)}
                    class="flex w-full items-start gap-2.5 border-t border-line px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]"
                    style={{ background: on() ? chex(col(), 0.08) : 'transparent' }}
                  >
                    <span
                      class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ background: chex(col(), 0.14), color: col() }}
                    >
                      <Show when={K()?.sev === 'error'} fallback={<Show when={K()?.sev === 'warn'} fallback={<IcInfo size={15} />}><IcWarnTri size={15} /></Show>}>
                        <IcAlert size={15} />
                      </Show>
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="truncate text-[12.5px] font-medium text-[color:var(--text)]">{K()?.label}</span>
                        <Show when={t.auto}>
                          <Badge color={tone('#0E7C86')} soft>
                            auto-fix
                          </Badge>
                        </Show>
                      </div>
                      <div class="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[color:var(--muted)]">
                        <span class="font-mono">{t.id}</span>·<DmaChip dma={t.dma} sm />
                        <Show when={t.status !== 'open'}>
                          <span style={{ color: t.status === 'fixed' ? tone('#1A7F37') : 'var(--muted2)' }}>
                            · {t.status === 'fixed' ? 'đã sửa' : 'bỏ qua'}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </button>
                )
              }}
            </For>
            <Show when={rows().length === 0}>
              <Empty icon="IcCheckCircle" title="Sạch topology" hint="Không còn vấn đề theo bộ lọc hiện tại." />
            </Show>
          </div>
        </Card>

        {/* map + detail */}
        <div class="flex flex-col gap-4">
          <Card pad={false} class="overflow-hidden">
            <div class="h-[360px]">
              <NetworkMapOL
                layers={{ basemap: true, dma: true, pipe: true, valve: true, node: true, source: true }}
                pins={pins()}
                focus={focus()}
                emphasis={{ dim: !!sel(), pipes: selIssue() ? [selIssue()!.ref] : [] }}
                onBg={() => setSel(null)}
                controls
                legend={false}
              />
            </div>
          </Card>
          <Show
            when={selIssue()}
            fallback={
              <Card>
                <Empty icon="IcGitBranch" title="Chọn một vấn đề topology" hint="Bấm vào danh sách để khoanh vùng trên bản đồ và xem hướng xử lý." />
              </Card>
            }
          >
            {(si) => {
              const K = () => G.TOPO_KINDS[si().kind]
              const col = () => tone(K()?.col ?? '#7E8997')
              return (
                <Card>
                  <div class="flex items-start gap-3">
                    <span
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: chex(col(), 0.14), color: col() }}
                    >
                      <Show when={K()?.sev === 'error'} fallback={<Show when={K()?.sev === 'warn'} fallback={<IcInfo size={18} />}><IcWarnTri size={18} /></Show>}>
                        <IcAlert size={18} />
                      </Show>
                    </span>
                    <div class="min-w-0 flex-1">
                      <h3 class="text-[14px] font-semibold text-[color:var(--text)]">{K()?.label}</h3>
                      <p class="mt-0.5 text-[12px] text-[color:var(--muted)]">{K()?.hint}</p>
                    </div>
                    <Badge color={col()} soft>
                      {K()?.sev === 'error' ? 'Lỗi' : K()?.sev === 'warn' ? 'Cảnh báo' : 'Gợi ý'}
                    </Badge>
                  </div>
                  <div class="mt-2 flex flex-col">
                    <KV label="Đối tượng" mono>{si().ref}</KV>
                    <KV label="Vị trí" mono>X {si().x} · Y {si().y}</KV>
                    <KV label="DMA">
                      <DmaChip dma={si().dma} />
                    </KV>
                    <KV label="Phát hiện">{si().auto ? 'Tự động khi import' : 'Validation thủ công'}</KV>
                  </div>
                  <Show
                    when={si().status === 'open'}
                    fallback={
                      <div class="mt-3 text-[11.5px]" style={{ color: si().status === 'fixed' ? tone('#1A7F37') : 'var(--muted)' }}>
                        {si().status === 'fixed' ? '✓ Đã xử lý' : 'Đã bỏ qua'}
                      </div>
                    }
                  >
                    <div class="mt-3 flex items-center gap-2">
                      <Show
                        when={si().auto}
                        fallback={
                          <Btn
                            size="sm"
                            variant="primary"
                            icon="IcPencil"
                            onClick={() => setIssueStatus(si().id, 'fixed', 'Mở công cụ sửa geometry')}
                          >
                            Sửa thủ công
                          </Btn>
                        }
                      >
                        <Btn
                          size="sm"
                          variant="primary"
                          icon="IcCheck"
                          onClick={() => setIssueStatus(si().id, 'fixed', 'Đã sửa tự động — tạo change set nháp')}
                        >
                          Sửa tự động
                        </Btn>
                      </Show>
                      <Btn
                        size="sm"
                        variant="ghost"
                        icon="IcEyeOff"
                        onClick={() => setIssueStatus(si().id, 'ignored', 'Đã bỏ qua vấn đề này')}
                      >
                        Bỏ qua
                      </Btn>
                    </div>
                  </Show>
                </Card>
              )
            }}
          </Show>
        </div>
      </div>
    </div>
  )
}
