/* GIS — Ứng dụng hiện trường (SolidJS port of field.jsx). */
import { For, Show, createSignal, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { IcAlert, IcCheckCircle, IcClock } from '../lib/icons'
import { cAccent, chex, fmtInt, rad, tone } from '../lib/theme'
import { Badge, Btn, Card, DmaChip, ScreenHead, Tile } from '../ui/kit'
import { NetworkMapOL } from '../ui/network-map-ol'

const SYNC: Record<string, { l: string; c: string; ic: string }> = {
  synced: { l: 'Đã đồng bộ', c: '#1A7F37', ic: 'IcCheckCircle' },
  pending: { l: 'Chờ đồng bộ', c: '#9A6700', ic: 'IcClock' },
  conflict: { l: 'Xung đột', c: '#D1242F', ic: 'IcAlert' },
}

const PKG: Record<string, { l: string; c: string }> = {
  active: { l: 'Sẵn sàng', c: '#1A7F37' },
  syncing: { l: 'Đang đồng bộ', c: '#0969DA' },
  expired: { l: 'Hết hạn', c: '#8B949E' },
}

function PhoneMock(): JSX.Element {
  return (
    <div class="mx-auto w-[176px] shrink-0">
      <div
        class="rounded-[26px] border-[6px] border-[#1B2733] bg-[#0D1117] p-1.5"
        style={{ 'box-shadow': '0 12px 30px -10px rgba(0,0,0,0.45)' }}
      >
        <div class="relative overflow-hidden rounded-[18px]" style={{ height: '312px', background: '#0D1117' }}>
          <div class="h-[120px]">
            <NetworkMapOL
              layers={{ basemap: true, pipe: true, valve: true, conn: true }}
              theme="dark"
              controls={false}
              legend={false}
              focus={{ x: 600, y: 400, w: 320, h: 260, _k: 1 }}
            />
          </div>
          <div class="flex items-center justify-between px-3 pt-2.5">
            <span class="text-[10px] font-semibold text-[#E6EDF3]">Hiện trường</span>
            <span class="flex items-center gap-1 rounded-full bg-[#16341f] px-1.5 py-0.5 text-[8px] font-medium text-[#3FB950]">
              <span class="h-1 w-1 rounded-full bg-[#3FB950]" />
              Offline
            </span>
          </div>
          <div class="mt-2 flex flex-col gap-1.5 px-3">
            <For each={[['Van rò rỉ ti', '#D29922'], ['Trụ PCC lệch vị trí', '#F85149'], ['Bổ sung đồng hồ', '#58A6FF']] as [string, string][]}>
              {(r) => (
                <div class="flex items-center gap-2 rounded-lg bg-[#161B22] px-2 py-1.5">
                  <span class="h-1.5 w-1.5 rounded-full" style={{ background: r[1] }} />
                  <span class="text-[9px] text-[#c6cfd9]">{r[0]}</span>
                </div>
              )}
            </For>
          </div>
          <div
            class="absolute bottom-2.5 left-3 right-3 flex items-center justify-center gap-1.5 rounded-lg py-1.5"
            style={{ background: '#0E7C86' }}
          >
            <span class="text-[10px] font-semibold text-white">+ Ghi nhận tài sản</span>
          </div>
        </div>
      </div>
    </div>
  )
}

interface FieldObs {
  id: string
  type: string
  asset: string
  by: string
  at: string
  sync: string
  photo?: boolean
  note?: string
}

interface OfflinePkg {
  id: string
  dma: string
  area: string
  assets: number
  size: string
  by: string
  state: string
}

export function FieldScreen(props: {
  toast: (m: string, k?: string) => void
}): JSX.Element {
  const G = useGis()
  const [obs, setObs] = createSignal<FieldObs[]>((G.fieldObs as FieldObs[]).map((o) => ({ ...o })))

  const resolve = (id: string, how: string) => {
    setObs((a) => a.map((o) => (o.id === id ? { ...o, sync: 'synced' } : o)))
    props.toast(
      how === 'server' ? 'Giữ phiên bản máy chủ' : 'Áp phiên bản hiện trường — đồng bộ EAM/CMMS',
    )
  }

  const pending = () => obs().filter((o) => o.sync === 'pending').length
  const conflict = () => obs().filter((o) => o.sync === 'conflict').length

  return (
    <div class="mx-auto flex max-w-[1200px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Ứng dụng hiện trường">
      <ScreenHead
        title="Ứng dụng hiện trường"
        sub="Offline-first · đồng bộ hai chiều EAM/CMMS · xử lý xung đột phiên bản"
        right={
          <Btn size="sm" variant="primary" icon="IcRefresh" onClick={() => props.toast('Đồng bộ tất cả bản ghi hiện trường')}>
            Đồng bộ tất cả
          </Btn>
        }
      />

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <For each={[
          ['Chờ đồng bộ', pending(), '#9A6700', 'IcClock'],
          ['Xung đột', conflict(), '#D1242F', 'IcAlert'],
          ['Gói offline', (G.offlinePkgs as OfflinePkg[]).length, '#0E7C86', 'IcDownload'],
          ['Đội hiện trường', 3, '#0969DA', 'IcMobile'],
        ] as [string, number, string, string][]}>
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

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Card pad={false} class="overflow-hidden">
          <div class="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-[color:var(--text)]">
            Bản ghi từ hiện trường
          </div>
          <div>
            <For each={obs()}>
              {(o) => {
                const S = () => SYNC[o.sync] ?? SYNC.synced!
                const col = () => tone(S().c)
                const SIcon = () => {
                  const ic = S().ic
                  if (ic === 'IcCheckCircle') return <IcCheckCircle size={16} />
                  if (ic === 'IcClock') return <IcClock size={16} />
                  if (ic === 'IcAlert') return <IcAlert size={16} />
                  return <IcCheckCircle size={16} />
                }
                return (
                  <div class="flex items-start gap-3 border-t border-line px-4 py-3">
                    <span
                      class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: chex(col(), 0.14), color: col() }}
                    >
                      <SIcon />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-[12.5px] font-medium text-[color:var(--text)]">{o.type}</span>
                        <Show when={o.photo}>
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="text-[color:var(--muted2)]">
                            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
                            <circle cx="12" cy="12" r="2.7" />
                          </svg>
                        </Show>
                      </div>
                      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-[color:var(--muted)]">
                        <span class="font-mono">{o.id}</span>
                        ·<span>{o.by}</span>
                        ·<span>{o.at}</span>
                        <Show when={o.asset && o.asset !== '—'}>
                          <>·<span class="font-mono">{o.asset}</span></>
                        </Show>
                      </div>
                      <Show when={o.note}>
                        <div class="mt-1 text-[11px] text-[color:var(--text2)]">{o.note}</div>
                      </Show>
                      <Show when={o.sync === 'conflict'}>
                        <div class="mt-2 flex items-center gap-2 rounded-lg border border-line bg-[var(--surface2)] px-2.5 py-1.5">
                          <span class="text-[10.5px] text-[color:var(--muted)]">Geometry máy chủ ≠ hiện trường</span>
                          <div class="ml-auto flex items-center gap-1.5">
                            <button
                              onClick={() => resolve(o.id, 'field')}
                              class="rounded-md px-2 py-1 text-[10.5px] font-medium text-white"
                              style={{ background: cAccent() }}
                            >
                              Dùng hiện trường
                            </button>
                            <button
                              onClick={() => resolve(o.id, 'server')}
                              class="rounded-md border border-line px-2 py-1 text-[10.5px] font-medium text-[color:var(--text2)]"
                            >
                              Giữ máy chủ
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                    <Badge color={col()} soft dot>{S().l}</Badge>
                  </div>
                )
              }}
            </For>
          </div>
        </Card>

        <div class="flex flex-col gap-4">
          <Card>
            <div class="mb-3 text-[13px] font-semibold text-[color:var(--text)]">Gói dữ liệu offline</div>
            <div class="flex flex-col gap-2">
              <For each={G.offlinePkgs as OfflinePkg[]}>
                {(p) => {
                  const S = () => PKG[p.state] ?? PKG.active!
                  const col = () => tone(S().c)
                  return (
                    <div class="rounded-lg border border-line px-3 py-2">
                      <div class="flex items-center gap-2">
                        <span class="text-[12px] font-medium text-[color:var(--text)]">{p.area}</span>
                        <DmaChip dma={p.dma} sm />
                        <Badge color={col()} soft class="ml-auto">{S().l}</Badge>
                      </div>
                      <div class="mt-1 flex items-center gap-2 text-[10.5px] text-[color:var(--muted)]">
                        <span class="font-mono">{fmtInt(p.assets)} tài sản</span>
                        ·<span>{p.size}</span>
                        ·<span>{p.by}</span>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
            <Btn size="sm" full variant="ghost" icon="IcPlus" onClick={() => props.toast('Tạo gói offline mới theo DMA')} class="mt-2">
              Tạo gói offline
            </Btn>
          </Card>
          <Card><PhoneMock /></Card>
        </div>
      </div>
    </div>
  )
}
