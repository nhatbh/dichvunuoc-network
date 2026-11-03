/* GIS — Đấu nối khách hàng (SolidJS port of connections.jsx). */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { IcShield } from '../lib/icons'
import { cAccent, chex, cnorm, fmtInt, rad, tone } from '../lib/theme'
import { Badge, Btn, Card, DmaChip, Empty, KV, ScreenHead, Select, TextInput, Tile } from '../ui/kit'
import { NetworkMapOL } from '../ui/network-map-ol'
import type { FocusBox, Pin } from '../ui/network-map-ol'

function ConnStatusPill(props: { st: string }): JSX.Element {
  const M: Record<string, { l: string; c: string }> = {
    active: { l: 'Đang cấp', c: '#1A7F37' },
    pending: { l: 'Chờ đấu nối', c: '#9A6700' },
    review: { l: 'Chờ duyệt vị trí', c: '#0969DA' },
  }
  const s = () => M[props.st] ?? M.active!
  const col = () => tone(s().c)
  return (
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[10.5px] font-medium"
      style={{ background: chex(col(), 0.1), color: col() }}
    >
      <span class="h-1.5 w-1.5 rounded-full" style={{ background: col() }} />
      {s().l}
    </span>
  )
}

export function ConnectionsScreen(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const G = useGis()
  const [dma, setDma] = createSignal('all')
  const [type, setType] = createSignal('all')
  const [status, setStatus] = createSignal('all')
  const [q, setQ] = createSignal('')
  const [sel, setSel] = createSignal<string | null>(null)

  const rows = createMemo(() => {
    const k = cnorm(q())
    return G.connections.filter(
      (c) =>
        (dma() === 'all' || c.dma === dma()) &&
        (type() === 'all' || c.type === type()) &&
        (status() === 'all' || c.status === status()) &&
        (!k || cnorm(c.name).includes(k) || c.danhbo.includes(q()) || cnorm(c.meter).includes(k)),
    )
  })

  const selConn = createMemo(() => G.connections.find((c) => c.id === sel()) ?? null)

  const focus = createMemo<FocusBox | null>(() => {
    const c = selConn()
    if (!c) return null
    return { x: c.x - 80, y: c.y - 80, w: 160, h: 160, _k: Math.random() }
  })

  const pins = createMemo<Pin[]>(() => {
    const c = selConn()
    if (!c) return []
    const ctype = G.CTYPE[c.type]
    return [{ id: sel()!, x: c.x, y: c.y, col: tone(ctype?.col ?? '#0E7C86'), pulse: true }]
  })

  const geocoded = createMemo(() =>
    Math.round((G.connections.filter((c) => c.geocoded).length / G.connections.length) * 100)
  )
  const pendingN = createMemo(() => G.connections.filter((c) => c.status !== 'active').length)

  return (
    <div class="mx-auto flex max-w-[1280px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Đấu nối khách hàng">
      <ScreenHead
        title="Đấu nối khách hàng"
        sub="Đồng bộ từ CIS/Billing · geocode & gán vào DMA · chỉ lưu mã tham chiếu, không dữ liệu thương mại"
        right={
          <>
            <Btn size="sm" variant="ghost" icon="IcRefresh" onClick={() => props.toast('Đồng bộ đấu nối mới từ CIS/Billing')}>
              Đồng bộ CIS
            </Btn>
            <Btn size="sm" variant="primary" icon="IcCrosshair" onClick={() => props.toast('Gán DMA tự động theo vị trí cho ' + pendingN() + ' đấu nối')}>
              Tự gán DMA
            </Btn>
          </>
        }
      />

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <For each={[
          ['Tổng đấu nối', fmtInt(G.connections.length), '#9A6700', 'IcPlug'],
          ['Đã geocode', geocoded() + '%', '#1A7F37', 'IcCrosshair'],
          ['GPS RTK', G.DASH.rtkPct + '%', '#0E7C86', 'IcSatellite'],
          ['Chờ xử lý', pendingN(), '#0969DA', 'IcClock'],
        ] as [string, string | number, string, string][]}>
          {(s) => (
            <div
              class="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5"
              style={{ 'box-shadow': 'var(--card-shadow)', 'border-radius': `${rad() + 2}px` }}
            >
              <Tile icon={s[3]} col={s[2]} size={38} />
              <div>
                <div class="font-mono text-[19px] font-semibold leading-none text-[color:var(--text)]">{s[1]}</div>
                <div class="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        <Card pad={false} class="overflow-hidden">
          <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div class="w-full max-w-[220px]">
              <TextInput value={q()} onChange={setQ} placeholder="Danh bộ / tên / đồng hồ…" icon="IcSearch" />
            </div>
            <div class="ml-auto flex items-center gap-2">
              <div class="w-[130px]">
                <Select
                  value={dma()}
                  onChange={setDma}
                  options={[{ value: 'all', label: 'Mọi DMA' }].concat(G.dmas.map((d) => ({ value: d.id, label: d.id })))}
                />
              </div>
              <div class="w-[130px]">
                <Select
                  value={type()}
                  onChange={setType}
                  options={[{ value: 'all', label: 'Mọi loại' }].concat(Object.entries(G.CTYPE).map(([k, v]) => ({ value: k, label: v.label })))}
                />
              </div>
              <div class="w-[140px]">
                <Select
                  value={status()}
                  onChange={setStatus}
                  options={[
                    { value: 'all', label: 'Mọi trạng thái' },
                    { value: 'active', label: 'Đang cấp' },
                    { value: 'pending', label: 'Chờ đấu nối' },
                    { value: 'review', label: 'Chờ duyệt vị trí' },
                  ]}
                />
              </div>
            </div>
          </div>
          <div class="max-h-[calc(100vh-330px)] overflow-y-auto">
            <table class="w-full text-left">
              <thead class="sticky top-0 z-10 bg-[var(--surface2)] text-[10.5px] uppercase tracking-wider text-[color:var(--muted2)]">
                <tr>
                  <th class="px-3 py-2 font-semibold">Danh bộ</th>
                  <th class="px-3 py-2 font-semibold">Khách hàng</th>
                  <th class="px-3 py-2 font-semibold">DMA</th>
                  <th class="px-3 py-2 font-semibold">Đồng hồ</th>
                  <th class="px-3 py-2 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows().slice(0, 200)}>
                  {(c) => {
                    const on = () => sel() === c.id
                    return (
                      <tr
                        onClick={() => setSel(c.id)}
                        class="cursor-pointer border-t border-line transition-colors"
                        style={{ background: on() ? chex(cAccent(), 0.08) : 'transparent' }}
                      >
                        <td class="px-3 py-2 font-mono text-[11.5px] text-[color:var(--text2)]">{c.danhbo}</td>
                        <td class="px-3 py-2">
                          <div class="truncate text-[12px] font-medium text-[color:var(--text)]" style={{ 'max-width': '170px' }}>{c.name}</div>
                          <div class="truncate text-[10px] text-[color:var(--muted2)]" style={{ 'max-width': '170px' }}>{c.addr}</div>
                        </td>
                        <td class="px-3 py-2"><DmaChip dma={c.dma} sm /></td>
                        <td class="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-[color:var(--muted)]">{c.meter}</td>
                        <td class="px-3 py-2"><ConnStatusPill st={c.status} /></td>
                      </tr>
                    )
                  }}
                </For>
              </tbody>
            </table>
            <Show when={rows().length === 0}>
              <Empty title="Không có đấu nối khớp lọc" />
            </Show>
            <Show when={rows().length > 200}>
              <div class="border-t border-line px-3 py-2 text-center text-[11px] text-[color:var(--muted2)]">
                Hiển thị 200 / {fmtInt(rows().length)}
              </div>
            </Show>
          </div>
        </Card>

        <div class="flex flex-col gap-4">
          <Card pad={false} class="overflow-hidden">
            <div class="h-[280px]">
              <NetworkMapOL
                layers={{ basemap: true, dma: true, pipe: true, conn: true, source: true }}
                pins={pins()}
                focus={focus()}
                controls
                legend={false}
                onBg={() => {}}
              />
            </div>
          </Card>

          <Show
            when={selConn()}
            fallback={
              <Card>
                <Empty icon="IcPlug" title="Chọn một đấu nối" hint="Bấm dòng để định vị điểm đấu nối trên bản đồ và xem chi tiết." />
              </Card>
            }
          >
            {(c) => {
              const ctype = () => G.CTYPE[c().type]
              return (
                <Card>
                  <div class="mb-1.5 flex items-center gap-1.5">
                    <Show when={ctype()}>
                      {(ct) => <Badge color={tone(ct().col)} soft>{ct().label}</Badge>}
                    </Show>
                    <ConnStatusPill st={c().status} />
                  </div>
                  <h3 class="text-[14px] font-semibold text-[color:var(--text)]">{c().name}</h3>
                  <div class="mt-2 flex flex-col">
                    <KV label="Danh bộ (CIS)" mono>{c().danhbo}</KV>
                    <KV label="Địa chỉ">{c().addr}</KV>
                    <KV label="Đồng hồ" mono>{c().meter} · DN{c().dn}</KV>
                    <KV label="DMA"><DmaChip dma={c().dma} /></KV>
                    <KV label="Định vị">
                      <span class="inline-flex items-center gap-2">
                        <Show
                          when={c().geocoded}
                          fallback={<Badge color={tone('#D86C1F')} soft dot>Chưa geocode</Badge>}
                        >
                          <Badge color={tone('#1A7F37')} soft dot>Đã geocode</Badge>
                        </Show>
                        <Show when={c().gpsRtk}>
                          <Badge color={tone('#0E7C86')} soft>RTK</Badge>
                        </Show>
                      </span>
                    </KV>
                  </div>
                  <div class="mt-3 rounded-lg bg-[var(--surface2)] px-3 py-2 text-[11px] text-[color:var(--muted)]">
                    <IcShield size={13} class="mr-1 inline" />
                    Chỉ lưu mã tham chiếu danh bộ — dữ liệu cước & thương mại nằm ở CIS/Billing.
                  </div>
                  <div class="mt-3 grid grid-cols-2 gap-2">
                    <Btn size="sm" icon="IcCrosshair" onClick={() => props.toast('Cập nhật vị trí đấu nối từ GPS RTK')}>
                      Sửa vị trí
                    </Btn>
                    <Btn size="sm" variant="ghost" icon="IcExternal" onClick={() => props.toast('Mở hồ sơ khách hàng trong CIS')}>
                      CIS
                    </Btn>
                  </div>
                </Card>
              )
            }}
          </Show>
        </div>
      </div>
    </div>
  )
}
