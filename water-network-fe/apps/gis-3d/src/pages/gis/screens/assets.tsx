/* GIS — Tài sản không gian (SolidJS port of assets.jsx). */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { useGis, type Asset } from '../lib/gis-data'
import { Icon, IcChevRight } from '../lib/icons'
import { cAccent, chex, cTheme, cnorm, fmtInt, tone } from '../lib/theme'
import { AssetTypeChip, Btn, Card, CondPill, DmaChip, Empty, KV, ScreenHead, Select, TextInput } from '../ui/kit'
import { NetworkMapOL, type FocusBox, type Selection } from '../ui/network-map-ol'
import type { Route } from '../shell/nav'

export function AssetsScreen(props: { toast: (m: string, k?: string) => void; go: (r: Route) => void }): JSX.Element {
  const G = useGis()
  const [type, setType] = createSignal('all')
  const [dma, setDma] = createSignal('all')
  const [cond, setCond] = createSignal('all')
  const [q, setQ] = createSignal('')
  const [sel, setSel] = createSignal<Selection>(null)

  const rows = createMemo(() => {
    const k = cnorm(q())
    return G.assets.filter(
      (a) =>
        (type() === 'all' || a.type === type()) &&
        (dma() === 'all' || a.dma === dma()) &&
        (cond() === 'all' || a.cond === cond()) &&
        (!k || cnorm(a.code).includes(k) || cnorm(a.name).includes(k)),
    )
  })

  const selAsset = createMemo<Asset | null>(() => {
    const s = sel()
    return s ? G.assets.find((a) => a.id === s.id) ?? null : null
  })

  const focus = createMemo<FocusBox | null>(() => {
    const a = selAsset()
    if (!a) return null
    const g = a.geomRef as unknown as { x: number; y: number; pts: [[number, number], [number, number]]; poly: [number, number][] }
    if (a.geom === 'point') return { x: g.x - 70, y: g.y - 70, w: 140, h: 140, _k: Math.random() }
    if (a.geom === 'line') {
      const xs = g.pts.map((p) => p[0])
      const ys = g.pts.map((p) => p[1])
      return { x: Math.min(...xs) - 20, y: Math.min(...ys) - 20, w: Math.abs(xs[1]! - xs[0]!) + 40, h: Math.abs(ys[1]! - ys[0]!) + 40, _k: Math.random() }
    }
    const xs = g.poly.map((p) => p[0])
    const ys = g.poly.map((p) => p[1])
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), _k: Math.random() }
  })

  const typeChips = createMemo(() => {
    const chips: [string, string, number][] = [['all', 'Tất cả', G.assets.length]]
    Object.keys(G.ASSET_TYPES).forEach((t) => {
      chips.push([t, G.ASSET_TYPES[t]!.label, G.assets.filter((a) => a.type === t).length])
    })
    return chips
  })

  return (
    <div class="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Tài sản không gian">
      <ScreenHead
        title="Quản lý tài sản không gian"
        sub={fmtInt(G.assets.length) + ' đối tượng GIS · geometry có lịch sử phiên bản đầy đủ'}
        right={
          <>
            <Btn size="sm" variant="ghost" icon="IcDownload" onClick={() => props.toast('Xuất GeoJSON ' + rows().length + ' đối tượng')}>
              Xuất
            </Btn>
            <Btn size="sm" variant="primary" icon="IcPlus" onClick={() => props.toast('Vẽ tài sản mới trên bản đồ')}>
              Tài sản mới
            </Btn>
          </>
        }
      />

      {/* filter chips */}
      <div class="flex flex-wrap items-center gap-1.5">
        <For each={typeChips()}>
          {(c) => {
            const on = () => type() === c[0]
            return (
              <button
                onClick={() => setType(c[0])}
                class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                style={{
                  'border-color': on() ? 'transparent' : 'var(--line)',
                  background: on() ? cAccent() : 'var(--surface)',
                  color: on() ? (cTheme() === 'light' ? '#fff' : '#06231f') : 'var(--text2)',
                }}
              >
                {c[1]}
                <span class="font-mono opacity-70">{c[2]}</span>
              </button>
            )
          }}
        </For>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* table */}
        <Card pad={false} class="overflow-hidden">
          <div class="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <div class="w-full max-w-[260px]">
              <TextInput value={q()} onChange={setQ} placeholder="Tìm mã / tên tài sản…" icon="IcSearch" />
            </div>
            <div class="ml-auto flex items-center gap-2">
              <div class="w-[150px]">
                <Select
                  value={dma()}
                  onChange={setDma}
                  options={[{ value: 'all', label: 'Mọi DMA' }].concat(G.dmas.map((d) => ({ value: d.id, label: d.id })))}
                />
              </div>
              <div class="w-[120px]">
                <Select
                  value={cond()}
                  onChange={setCond}
                  options={[{ value: 'all', label: 'Tình trạng' }].concat(Object.entries(G.COND).map(([k, v]) => ({ value: k, label: v.label })))}
                />
              </div>
            </div>
          </div>
          <div class="max-h-[calc(100vh-280px)] overflow-y-auto">
            <table class="w-full text-left">
              <thead class="sticky top-0 z-10 bg-[var(--surface2)] text-[10.5px] uppercase tracking-wider text-[color:var(--muted2)]">
                <tr>
                  <th class="px-3 py-2 font-semibold">Mã</th>
                  <th class="px-3 py-2 font-semibold">Tên / loại</th>
                  <th class="px-3 py-2 font-semibold">DMA</th>
                  <th class="px-3 py-2 font-semibold">Tình trạng</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                <For each={rows().slice(0, 200)}>
                  {(a) => {
                    const on = () => {
                      const s = sel()
                      return s && s.id === a.id
                    }
                    return (
                      <tr
                        onClick={() => setSel({ type: a.type, id: a.id })}
                        class="cursor-pointer border-t border-line transition-colors"
                        style={{ background: on() ? chex(cAccent(), 0.08) : 'transparent' }}
                      >
                        <td class="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-[color:var(--muted)]">{a.code}</td>
                        <td class="px-3 py-2">
                          <div class="flex items-center gap-2">
                            <span style={{ color: tone(G.ASSET_TYPES[a.type]!.col) }}>
                              <Icon name={G.ASSET_TYPES[a.type]!.icon} size={15} />
                            </span>
                            <span class="truncate text-[12px] font-medium text-[color:var(--text)]" style={{ 'max-width': '200px' }}>
                              {a.name}
                            </span>
                          </div>
                        </td>
                        <td class="px-3 py-2">
                          <DmaChip dma={a.dma} sm />
                        </td>
                        <td class="px-3 py-2">
                          <CondPill cond={a.cond} sm />
                        </td>
                        <td class="px-3 py-2 text-right">
                          <IcChevRight size={14} class="text-[color:var(--faint)]" />
                        </td>
                      </tr>
                    )
                  }}
                </For>
              </tbody>
            </table>
            <Show when={rows().length === 0}>
              <Empty title="Không có tài sản khớp lọc" hint="Thử bỏ bớt bộ lọc" />
            </Show>
            <Show when={rows().length > 200}>
              <div class="border-t border-line px-3 py-2 text-center text-[11px] text-[color:var(--muted2)]">
                Hiển thị 200 / {fmtInt(rows().length)} — thu hẹp bộ lọc để xem tiếp
              </div>
            </Show>
          </div>
        </Card>

        {/* map + inspector */}
        <div class="flex flex-col gap-4">
          <Card pad={false} class="overflow-hidden">
            <div class="h-[300px]">
              <NetworkMapOL
                layers={{ basemap: true, dma: true, pipe: true, valve: true, hydrant: true, node: true, source: true }}
                selected={sel()}
                focus={focus()}
                onSelect={setSel}
                onBg={() => {}}
                controls
                legend={false}
              />
            </div>
          </Card>
          <Show
            when={selAsset()}
            fallback={
              <Card>
                <Empty icon="IcPolygon" title="Chọn một tài sản" hint="Bấm dòng trong bảng để định vị trên bản đồ và xem thuộc tính, lịch sử phiên bản." />
              </Card>
            }
          >
            {(a) => (
              <Card>
                <div class="mb-1.5 flex items-center gap-1.5">
                  <AssetTypeChip type={a().type} sm />
                  <CondPill cond={a().cond} sm />
                  <span class="ml-auto font-mono text-[11px] text-[color:var(--muted)]">{a().code}</span>
                </div>
                <h3 class="text-[14px] font-semibold text-[color:var(--text)]">{a().name}</h3>
                <div class="mt-2 flex flex-col">
                  <For each={Object.entries(a().attrs)}>{([k, v]) => <KV label={k} mono>{v}</KV>}</For>
                  <KV label="DMA">
                    <DmaChip dma={a().dma} />
                  </KV>
                </div>
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <Btn size="sm" icon="IcPencil" onClick={() => props.toast('Sửa geometry — yêu cầu GIS_EDITOR')}>
                    Sửa geometry
                  </Btn>
                  <Btn size="sm" variant="ghost" icon="IcMap" onClick={() => props.go({ name: 'map' })}>
                    Xem trên bản đồ
                  </Btn>
                </div>
              </Card>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
