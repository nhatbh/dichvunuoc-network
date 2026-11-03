/* GIS — Mô hình liên thông mạng (SolidJS port of netmodel.jsx). */
import { For, Show, createMemo, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { IcAlert, IcCheckCircle } from '../lib/icons'
import { chex, cTheme, fmtInt, rad, tone } from '../lib/theme'
import { Btn, Card, ScreenHead, StackBar } from '../ui/kit'
import { NetworkMapOL } from '../ui/network-map-ol'
import type { Pin } from '../ui/network-map-ol'
import type { Route } from '../shell/nav'

function hwRough(mat: string): number {
  const m: Record<string, number> = { 'Gang dẻo': 130, HDPE: 150, uPVC: 150, Thép: 120, 'Gang xám': 100 }
  return m[mat] ?? 120
}

function nmBuild(G: ReturnType<typeof useGis>) {
  const live = G.pipes.filter((p) => p.status !== 'abandoned')
  const deg: Record<string, number> = {}
  const adj: Record<string, string[]> = {}
  G.nodes.forEach((n) => { deg[n.id] = 0; adj[n.id] = [] })
  live.forEach((p) => {
    if (deg[p.from] != null) { deg[p.from]!++; adj[p.from]!.push(p.to) }
    if (deg[p.to] != null) { deg[p.to]!++; adj[p.to]!.push(p.from) }
  })
  const deadEnds = G.nodes.filter((n) => deg[n.id] === 1)
  const isolated = G.nodes.filter((n) => deg[n.id] === 0)
  const seen: Record<string, number> = {}
  let comps = 0, biggest = 0
  G.nodes.forEach((n) => {
    if (seen[n.id] || deg[n.id] === 0) return
    comps++; let cnt = 0; const st = [n.id]; seen[n.id] = 1
    while (st.length) { const c = st.pop()!; cnt++; adj[c]!.forEach((k) => { if (!seen[k]) { seen[k] = 1; st.push(k) } }) }
    biggest = Math.max(biggest, cnt)
  })
  const degDist = [2, 3, 4].map((d) => ({
    label: 'Bậc ' + d,
    n: G.nodes.filter((n) => deg[n.id] === d).length,
    col: d === 2 ? '#9A6700' : d === 3 ? '#0E7C86' : '#1A7F37',
  }))
  return { live, deg, deadEnds, isolated, comps, biggest, degDist, sources: 1 + G.reservoirs.length + G.pumps.length }
}

function nmInp(G: ReturnType<typeof useGis>): string {
  const live = G.pipes.filter((p) => p.status !== 'abandoned')
  let s = '[TITLE]\n Bản đồ mạng lưới GIS — xuất EPANET (' + G.TODAY + ')\n SRID nguồn: ' + G.SRID + '\n\n'
  s += '[JUNCTIONS]\n;ID\tElev\tDemand\n'
  G.nodes.forEach((n) => { s += ` ${n.id}\t${n.z}\t0\n` })
  s += '\n[RESERVOIRS]\n;ID\tHead\n'
  s += ` ${G.plant.id}\t60\n`
  G.reservoirs.forEach((r) => { s += ` ${r.id}\t${(30 + (r.level / 100) * 8).toFixed(1)}\n` })
  s += '\n[PIPES]\n;ID\tNode1\tNode2\tLength\tDiam\tRough\n'
  live.forEach((p) => { s += ` ${p.id}\t${p.from}\t${p.to}\t${p.lenM}\t${p.dn}\t${hwRough(p.material)}\n` })
  s += '\n[COORDINATES]\n;Node\tX\tY\n'
  G.nodes.forEach((n) => { s += ` ${n.id}\t${n.x}\t${G.world.h - n.y}\n` })
  s += ` ${G.plant.id}\t${G.plant.x}\t${G.world.h - G.plant.y}\n`
  G.reservoirs.forEach((r) => { s += ` ${r.id}\t${r.x}\t${G.world.h - r.y}\n` })
  s += '\n[OPTIONS]\n Units\tLPS\n Headloss\tH-W\n\n[END]\n'
  return s
}

function nmDownload(name: string, text: string) {
  const b = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const u = URL.createObjectURL(b)
  const a = document.createElement('a')
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(u), 1500)
}

function NmStat(props: { label: string; value: string; unit?: string; col?: string; alert?: boolean }): JSX.Element {
  return (
    <Card>
      <div class="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{props.label}</div>
      <div class="mt-1.5 flex items-baseline gap-1">
        <span
          class="font-mono text-[26px] font-semibold leading-none"
          style={{ color: props.alert ? tone('#D86C1F') : props.col ? tone(props.col) : 'var(--text)' }}
        >
          {props.value}
        </span>
        <Show when={props.unit}>
          <span class="text-[12px] text-[color:var(--muted)]">{props.unit}</span>
        </Show>
      </div>
    </Card>
  )
}

export function NetModelScreen(props: { toast: (m: string, k?: string) => void; go: (r: Route) => void }): JSX.Element {
  const G = useGis()
  const m = createMemo(() => nmBuild(G))

  const openBy = (kind: string) => G.topoIssues.filter((t) => t.kind === kind && t.status === 'open').length

  const checks = createMemo(() =>
    [
      { k: 'disconnect', label: 'Liên thông tới nguồn cấp', hint: m().comps + ' thành phần · cụm lớn nhất ' + fmtInt(m().biggest) + ' nút' },
      { k: 'dangling', label: 'Không còn ống treo (dangling)', hint: 'Mọi đầu ống đấu vào nút/ống' },
      { k: 'overshoot', label: 'Không còn ống vượt nút', hint: 'Không có đoạn thừa tại giao điểm' },
      { k: 'elev', label: 'Cao độ nút đầy đủ & hợp lệ', hint: 'Phục vụ tính cột áp mô hình' },
      { k: 'flow', label: 'Đủ van cô lập từng đoạn', hint: 'Mỗi đoạn cô lập được khi sửa chữa' },
    ].map((c) => ({ ...c, n: openBy(c.k) }))
  )

  const passN = createMemo(() => checks().filter((c) => c.n === 0).length)

  const pins = createMemo<Pin[]>(() =>
    m().deadEnds.slice(0, 48).map((n) => ({ id: n.id, x: n.x, y: n.y, col: tone('#D86C1F'), shape: 'diamond' as const }))
      .concat(m().isolated.slice(0, 12).map((n) => ({ id: 'iso' + n.id, x: n.x, y: n.y, col: tone('#D1242F'), shape: 'diamond' as const, pulse: true })))
  )

  const doExport = () => {
    nmDownload('water-network.inp', nmInp(G))
    props.toast('Đã xuất water-network.inp · ' + fmtInt(G.nodes.length) + ' nút · ' + fmtInt(m().live.length) + ' ống', 'success')
  }

  return (
    <div class="mx-auto max-w-[1180px] px-4 py-5 sm:px-6" data-screen-label="Mô hình liên thông mạng">
      <ScreenHead
        title="Mô hình liên thông mạng"
        sub="Connectivity model · GIS dựng đồ thị nút–ống & xuất sang Mô phỏng thuỷ lực"
        right={
          <>
            <Btn variant="default" icon="IcExternal" onClick={() => props.toast('Đẩy mô hình sang service Mô phỏng thuỷ lực', 'info')}>
              Đẩy sang thuỷ lực
            </Btn>
            <Btn variant="primary" icon="IcDownload" onClick={doExport}>
              Xuất EPANET (.inp)
            </Btn>
          </>
        }
      />

      <div class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <NmStat label="Nút mạng" value={fmtInt(G.nodes.length)} unit="nút" />
        <NmStat label="Tuyến ống" value={fmtInt(m().live.length)} unit="cạnh" col="#0E7C86" />
        <NmStat label="Nguồn cấp" value={String(m().sources)} unit="điểm" col="#1A7F37" />
        <NmStat label="Nút đầu cuối" value={fmtInt(m().deadEnds.length)} unit="cụt" alert={m().deadEnds.length > 0} />
        <NmStat label="Thành phần liên thông" value={String(m().comps)} alert={m().comps > 1} />
      </div>

      <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.15fr_1fr]">
        <Card pad={false}>
          <div class="flex items-center justify-between border-b border-line px-4 py-3">
            <span class="text-[13px] font-semibold text-[color:var(--text)]">Xem trước mô hình</span>
            <div class="flex items-center gap-3 text-[10.5px] text-[color:var(--muted)]">
              <span class="flex items-center gap-1.5">
                <span class="inline-block h-2.5 w-2.5 rotate-45" style={{ background: tone('#D86C1F') }} />
                Nút cụt
              </span>
              <span class="flex items-center gap-1.5">
                <span class="inline-block h-2.5 w-2.5 rotate-45" style={{ background: tone('#D1242F') }} />
                Cô lập
              </span>
            </div>
          </div>
          <div class="h-[360px] w-full overflow-hidden" style={{ 'border-radius': `0 0 ${rad() + 2}px ${rad() + 2}px` }}>
            <NetworkMapOL
              layers={{ basemap: true, pipe: true, valve: false, source: true, node: false, dma: true }}
              pins={pins()}
              paint={{ mode: 'dma' }}
              legend={false}
              onBg={() => {}}
            />
          </div>
        </Card>

        <div class="flex flex-col gap-3">
          <Card>
            <div class="mb-2.5 flex items-center justify-between">
              <span class="text-[13px] font-semibold text-[color:var(--text)]">Kiểm định mô hình</span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[10.5px] font-medium"
                style={{ background: chex(tone(passN() === checks().length ? '#1A7F37' : '#9A6700'), cTheme() === 'light' ? 0.1 : 0.18), color: tone(passN() === checks().length ? '#1A7F37' : '#9A6700') }}
              >
                <span class="h-1.5 w-1.5 rounded-full" style={{ background: tone(passN() === checks().length ? '#1A7F37' : '#9A6700') }} />
                {passN()}/{checks().length} đạt
              </span>
            </div>
            <div class="flex flex-col gap-1.5">
              <For each={checks()}>
                {(c) => {
                  const ok = () => c.n === 0
                  const col = () => tone(ok() ? '#1A7F37' : '#D86C1F')
                  return (
                    <div class="flex items-start gap-2.5 rounded-lg px-1 py-1">
                      <span class="mt-px shrink-0" style={{ color: col() }}>
                        <Show when={ok()} fallback={<IcAlert size={16} />}>
                          <IcCheckCircle size={16} />
                        </Show>
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="text-[12.5px] font-medium text-[color:var(--text)]">{c.label}</div>
                        <div class="truncate text-[11px] text-[color:var(--muted)]">{c.hint}</div>
                      </div>
                      <Show when={c.n > 0}>
                        <button
                          onClick={() => props.go({ name: 'topology' })}
                          class="shrink-0 font-mono text-[11px] font-semibold"
                          style={{ color: col() }}
                        >
                          {c.n} lỗi ↗
                        </button>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </Card>

          <Card>
            <div class="mb-2.5 text-[13px] font-semibold text-[color:var(--text)]">Phân bố bậc nút</div>
            <StackBar rows={m().degDist} h={12} />
          </Card>

          <Card>
            <div class="mb-1 text-[13px] font-semibold text-[color:var(--text)]">Phục vụ dữ liệu</div>
            <p class="mb-2.5 text-[11.5px] leading-relaxed text-[color:var(--muted)]">
              Mô hình liên thông là đầu ra GIS cung cấp cho các service phân tích. Roughness suy ra theo vật liệu (Hazen-Williams), cao độ lấy từ nút lưới.
            </p>
            <div class="grid grid-cols-1 gap-2">
              <Btn full size="sm" icon="IcDownload" onClick={doExport}>
                Xuất EPANET .inp
              </Btn>
              <div class="grid grid-cols-2 gap-2">
                <Btn
                  size="sm"
                  variant="ghost"
                  icon="IcDownload"
                  onClick={() => {
                    nmDownload('network-topology.geojson', JSON.stringify({ type: 'FeatureCollection', srid: G.SRID, features: m().live.length }, null, 0))
                    props.toast('Xuất topology GeoJSON', 'success')
                  }}
                >
                  GeoJSON
                </Btn>
                <Btn size="sm" variant="ghost" icon="IcLink" onClick={() => props.toast('Webhook gis.topology.changed đã kích hoạt', 'info')}>
                  Event
                </Btn>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
