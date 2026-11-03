/* GIS — Chất lượng & độ phủ dữ liệu không gian (SolidJS port of quality.jsx). */
import { For, Show, createMemo, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { cAccent, chex, cTheme, fmtInt, tone } from '../lib/theme'
import { Badge, Btn, Card, DmaChip, ProgressBar, ScreenHead } from '../ui/kit'
import type { Route } from '../shell/nav'

const QL_ATTRS = ['Đường kính', 'Vật liệu', 'Năm lắp', 'Cao độ đỉnh ống', 'Độ sâu chôn']

function qlHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function pipeGaps(pid: string): string[] {
  const h = qlHash(pid)
  const g: string[] = []
  if (h % 11 === 0) g.push('Năm lắp')
  if (h % 4 === 0) g.push('Độ sâu chôn')
  if (h % 23 === 0) g.push('Vật liệu')
  if (h % 7 === 0) g.push('Cao độ đỉnh ống')
  return g
}

function Ring(props: { pct: number; size?: number; col?: string }): JSX.Element {
  const size = () => props.size ?? 96
  const r = () => (size() - 12) / 2
  const c = () => 2 * Math.PI * r()
  const off = () => c() * (1 - props.pct / 100)
  const cc = () => props.col || tone('#0E7C86')
  return (
    <svg width={size()} height={size()} viewBox={`0 0 ${size()} ${size()}`}>
      <circle cx={size() / 2} cy={size() / 2} r={r()} fill="none" stroke="var(--surface2)" stroke-width="9" />
      <circle
        cx={size() / 2} cy={size() / 2} r={r()} fill="none"
        stroke={cc()} stroke-width="9" stroke-linecap="round"
        stroke-dasharray={String(c())} stroke-dashoffset={String(off())}
        transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
      />
      <text x="50%" y="50%" dy="0.1em" text-anchor="middle" class="font-mono" font-size={String(size() * 0.26)} font-weight="700" fill="var(--text)">
        {props.pct}
      </text>
      <text x="50%" y="50%" dy="1.5em" text-anchor="middle" font-size={String(size() * 0.12)} fill="var(--muted)">%</text>
    </svg>
  )
}

function QlMetric(props: { label: string; pct: number; sub?: string; col?: string }): JSX.Element {
  const c = () => tone(props.col || (props.pct >= 90 ? '#1A7F37' : props.pct >= 75 ? '#9A6700' : '#D86C1F'))
  return (
    <Card>
      <div class="flex items-center justify-between">
        <span class="text-[12px] font-medium text-[color:var(--text2)]">{props.label}</span>
        <span class="font-mono text-[15px] font-semibold" style={{ color: c() }}>{props.pct}%</span>
      </div>
      <div class="mt-2"><ProgressBar pct={props.pct} tone={c()} h={7} /></div>
      <Show when={props.sub}>
        <div class="mt-1.5 text-[10.5px] text-[color:var(--muted)]">{props.sub}</div>
      </Show>
    </Card>
  )
}

export function QualityScreen(props: { toast: (m: string, k?: string) => void; go: (r: Route) => void }): JSX.Element {
  const G = useGis()

  const data = createMemo(() => {
    const pipes = G.pipes
    const N = pipes.length
    const miss = Object.fromEntries(QL_ATTRS.map((a) => [a, 0])) as Record<string, number>
    pipes.forEach((p) => pipeGaps(p.id).forEach((a) => { if (miss[a] != null) miss[a]!++ }))
    const compl = QL_ATTRS.map((a) => ({ label: a, pct: Math.round((1 - miss[a]! / N) * 100), miss: miss[a]! }))
    const complAvg = Math.round(compl.reduce((s, c) => s + c.pct, 0) / compl.length)
    const byDma = G.dmas.map((d) => {
      const ps = pipes.filter((p) => p.dma === d.id)
      const ok = ps.filter((p) => pipeGaps(p.id).length === 0).length
      return { id: d.id, name: d.name, n: ps.length, pct: ps.length ? Math.round((ok / ps.length) * 100) : 100 }
    })
    const gaps = pipes.map((p) => ({ p, g: pipeGaps(p.id) })).filter((x) => x.g.length)
    const score = Math.round(complAvg * 0.6 + G.DASH.rtkPct * 0.2 + G.DASH.geocodedPct * 0.2)
    return { compl, complAvg, byDma, gaps, score, totalGaps: gaps.length }
  })

  const scoreCol = () => (data().score >= 90 ? '#1A7F37' : data().score >= 75 ? '#9A6700' : '#D86C1F')

  return (
    <div class="mx-auto max-w-[1180px] px-4 py-5 sm:px-6" data-screen-label="Chất lượng dữ liệu">
      <ScreenHead
        title="Chất lượng dữ liệu không gian"
        sub="Độ tin cậy GIS cung cấp cho các service — hoàn thiện thuộc tính · RTK · geocoding"
        right={
          <Btn variant="default" icon="IcDownload" onClick={() => props.toast('Xuất báo cáo QA dữ liệu (PDF)', 'success')}>
            Xuất báo cáo QA
          </Btn>
        }
      />

      <div class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
        <Card>
          <div class="flex items-center gap-4">
            <Ring pct={data().score} col={tone(scoreCol())} />
            <div class="min-w-0">
              <div class="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Điểm chất lượng</div>
              <div class="mt-1 text-[13px] font-medium text-[color:var(--text)]">
                {data().score >= 90 ? 'Rất tốt' : data().score >= 75 ? 'Khá' : 'Cần cải thiện'}
              </div>
              <div class="mt-1 text-[11px] leading-relaxed text-[color:var(--muted)]">
                {fmtInt(data().totalGaps)} đối tượng còn thiếu thuộc tính
              </div>
            </div>
          </div>
        </Card>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <QlMetric label="Hoàn thiện thuộc tính" pct={data().complAvg} sub="Bình quân 5 trường lõi" />
          <QlMetric label="Độ phủ GPS RTK" pct={G.DASH.rtkPct} sub="Đấu nối đo bằng RTK · sai số ≤ 5 cm" col="#0969DA" />
          <QlMetric label="Đã geocode" pct={G.DASH.geocodedPct} sub="Đấu nối gắn toạ độ & DMA" col="#8250DF" />
        </div>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Hoàn thiện theo thuộc tính (tuyến ống)</div>
          <div class="flex flex-col gap-2.5">
            <For each={data().compl}>
              {(c) => {
                const col = tone(c.pct >= 95 ? '#1A7F37' : c.pct >= 80 ? '#9A6700' : '#D86C1F')
                return (
                  <div>
                    <div class="mb-1 flex items-center justify-between text-[11.5px]">
                      <span class="text-[color:var(--text2)]">{c.label}</span>
                      <span class="font-mono text-[color:var(--muted)]">
                        {c.pct}%{' '}
                        <Show when={c.miss > 0}>
                          <span style={{ color: col }}>· thiếu {fmtInt(c.miss)}</span>
                        </Show>
                      </span>
                    </div>
                    <ProgressBar pct={c.pct} tone={col} h={7} />
                  </div>
                )
              }}
            </For>
          </div>
        </Card>

        <Card pad={false}>
          <div class="border-b border-line px-4 py-3 text-[13px] font-semibold text-[color:var(--text)]">Hoàn thiện theo DMA</div>
          <div class="px-2 py-1.5">
            <For each={data().byDma}>
              {(d) => {
                const col = tone(d.pct >= 95 ? '#1A7F37' : d.pct >= 85 ? '#9A6700' : '#D86C1F')
                return (
                  <div class="flex items-center gap-3 rounded-lg px-2 py-2">
                    <DmaChip dma={d.id} sm />
                    <span class="min-w-0 flex-1 truncate text-[12px] text-[color:var(--text2)]">{d.name}</span>
                    <div class="w-24 shrink-0"><ProgressBar pct={d.pct} tone={col} h={6} /></div>
                    <span class="w-9 shrink-0 text-right font-mono text-[11.5px] font-medium" style={{ color: col }}>{d.pct}%</span>
                  </div>
                )
              }}
            </For>
          </div>
        </Card>
      </div>

      <Card pad={false} class="mt-3">
        <div class="flex items-center justify-between border-b border-line px-4 py-3">
          <span class="text-[13px] font-semibold text-[color:var(--text)]">Cần hoàn thiện</span>
          <Badge color={tone('#D86C1F')} soft dot>{fmtInt(data().totalGaps)} đối tượng</Badge>
        </div>
        <div class="max-h-[340px] overflow-y-auto">
          <table class="w-full text-left">
            <thead class="sticky top-0 bg-[var(--surface)]">
              <tr class="border-b border-line text-[10.5px] uppercase tracking-wider text-[color:var(--muted2)]">
                <th class="px-4 py-2 font-semibold">Mã ống</th>
                <th class="px-4 py-2 font-semibold">Tên</th>
                <th class="px-4 py-2 font-semibold">DMA</th>
                <th class="px-4 py-2 font-semibold">Thiếu</th>
                <th class="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              <For each={data().gaps.slice(0, 30)}>
                {({ p, g }) => (
                  <tr class="border-b border-line/60 transition-colors hover:bg-[var(--surface2)]">
                    <td class="px-4 py-2 font-mono text-[11.5px] text-[color:var(--text2)]">{p.code}</td>
                    <td class="px-4 py-2 text-[12px] text-[color:var(--text)]">Ống DN{p.dn} · {p.material}</td>
                    <td class="px-4 py-2"><DmaChip dma={p.dma} sm /></td>
                    <td class="px-4 py-2">
                      <div class="flex flex-wrap gap-1">
                        <For each={g}>
                          {(x) => (
                            <span
                              class="rounded px-1.5 py-[1px] text-[10px] font-medium"
                              style={{ background: chex('#D86C1F', cTheme() === 'light' ? 0.12 : 0.2), color: tone('#D86C1F') }}
                            >
                              {x}
                            </span>
                          )}
                        </For>
                      </div>
                    </td>
                    <td class="px-4 py-2 text-right">
                      <button
                        onClick={() => props.go({ name: 'map', focusAsset: { id: p.id } })}
                        class="font-mono text-[11px] font-semibold"
                        style={{ color: tone(cAccent()) }}
                      >
                        Định vị ↗
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={data().gaps.length > 30}>
            <div class="px-4 py-2.5 text-center font-mono text-[10.5px] text-[color:var(--muted2)]">
              … +{fmtInt(data().gaps.length - 30)} đối tượng khác
            </div>
          </Show>
        </div>
      </Card>
    </div>
  )
}
