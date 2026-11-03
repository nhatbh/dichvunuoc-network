/* GIS — Phiên bản & phê duyệt change set (SolidJS port of versions.jsx). */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import { IcCheckCircle, IcClock, IcExternal, IcX } from '../lib/icons'
import { cAccent, chex, tone } from '../lib/theme'
import { Badge, Btn, Card, DmaChip, KV, ScreenHead, Tile } from '../ui/kit'

const CS_STATUS: Record<string, { l: string; c: string; ic: string }> = {
  pending: { l: 'Chờ duyệt', c: '#9A6700', ic: 'IcClock' },
  approved: { l: 'Đã duyệt', c: '#1A7F37', ic: 'IcCheckCircle' },
  rejected: { l: 'Từ chối', c: '#D1242F', ic: 'IcX' },
  draft: { l: 'Nháp', c: '#8B949E', ic: 'IcPencil' },
}

interface ChangeSet {
  id: string
  title: string
  author: string
  at: string
  status: string
  adds: number
  mods: number
  dels: number
  dma: string
  reviewer: string | null
}

export function VersionsScreen(props: {
  toast: (m: string, k?: string) => void
}): JSX.Element {
  const G = useGis()
  const [sets, setSets] = createSignal<ChangeSet[]>((G.changeSets as ChangeSet[]).map((c) => ({ ...c })))
  // Solid's createSignal does NOT lazy-eval a function initializer (unlike React's
  // useState) — passing a function stores the function as the value. Compute eagerly.
  const initialSel =
    (G.changeSets as ChangeSet[]).find((c) => c.status === 'pending')?.id ??
    (G.changeSets as ChangeSet[])[0]?.id ??
    ''
  const [sel, setSel] = createSignal<string>(initialSel)

  const cs = createMemo(() => sets().find((c) => c.id === sel()) ?? null)
  const pending = createMemo(() => sets().filter((c) => c.status === 'pending').length)

  const act = (id: string, st: string, msg: string) => {
    setSets((a) => a.map((c) => (c.id === id ? { ...c, status: st, reviewer: 'Vũ Phê Duyệt' } : c)))
    props.toast(msg)
  }

  return (
    <div class="mx-auto flex max-w-[1200px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Phiên bản & phê duyệt">
      <ScreenHead
        title="Phiên bản & phê duyệt"
        sub="Change set · optimistic locking · audit đầy đủ — chỉ dữ liệu đã duyệt mới đồng bộ sang Hydraulic & DMA"
        right={
          <Btn size="sm" variant="primary" icon="IcPlus" onClick={() => props.toast('Tạo change set nháp mới')}>
            Change set mới
          </Btn>
        }
      />

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <For each={[
          ['Chờ duyệt', pending(), '#9A6700', 'IcClock'],
          ['Đã duyệt', sets().filter((c) => c.status === 'approved').length, '#1A7F37', 'IcCheckCircle'],
          ['Từ chối', sets().filter((c) => c.status === 'rejected').length, '#D1242F', 'IcX'],
          ['Đối tượng thay đổi', sets().reduce((s, c) => s + c.adds + c.mods + c.dels, 0), '#0E7C86', 'IcGitBranch'],
        ] as [string, number, string, string][]}>
          {(s) => (
            <div
              class="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5"
              style={{ 'box-shadow': 'var(--card-shadow)', 'border-radius': `${9 + 2}px` }}
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
          <div class="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-[color:var(--text)]">
            Danh sách change set
          </div>
          <div>
            <For each={sets()}>
              {(c) => {
                const S = () => CS_STATUS[c.status] ?? CS_STATUS.draft!
                const on = () => sel() === c.id
                const col = () => tone(S().c)
                const SIcon = () => {
                  const ic = S().ic
                  if (ic === 'IcCheckCircle') return <IcCheckCircle size={16} />
                  if (ic === 'IcClock') return <IcClock size={16} />
                  if (ic === 'IcX') return <IcX size={16} />
                  return <IcClock size={16} />
                }
                return (
                  <button
                    onClick={() => setSel(c.id)}
                    class="flex w-full items-start gap-3 border-t border-line px-4 py-3 text-left transition-colors hover:bg-[var(--surface2)]"
                    style={{ background: on() ? chex(cAccent(), 0.08) : 'transparent' }}
                  >
                    <span
                      class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: chex(col(), 0.14), color: col() }}
                    >
                      <SIcon />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="font-mono text-[11px] text-[color:var(--muted)]">{c.id}</span>
                        <DmaChip dma={c.dma} sm />
                      </div>
                      <div class="mt-0.5 truncate text-[12.5px] font-medium text-[color:var(--text)]">{c.title}</div>
                      <div class="mt-1 flex items-center gap-2.5 text-[10.5px]">
                        <span class="text-[color:var(--muted2)]">{c.author} · {c.at}</span>
                        <span class="flex items-center gap-2 font-mono">
                          <Show when={c.adds}>
                            <span style={{ color: tone('#1A7F37') }}>+{c.adds}</span>
                          </Show>
                          <Show when={c.mods}>
                            <span style={{ color: tone('#9A6700') }}>~{c.mods}</span>
                          </Show>
                          <Show when={c.dels}>
                            <span style={{ color: tone('#D1242F') }}>−{c.dels}</span>
                          </Show>
                        </span>
                      </div>
                    </div>
                    <Badge color={col()} soft>{S().l}</Badge>
                  </button>
                )
              }}
            </For>
          </div>
        </Card>

        <Show when={cs()}>
          {(c) => (
            <div class="flex flex-col gap-4">
              <Card>
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-[11px] text-[color:var(--muted)]">{c().id}</span>
                  <Badge color={tone(CS_STATUS[c().status]?.c ?? '#8B949E')} soft>
                    {CS_STATUS[c().status]?.l ?? c().status}
                  </Badge>
                </div>
                <h3 class="mt-1 text-[14px] font-semibold text-[color:var(--text)]">{c().title}</h3>
                <div class="mt-2 flex flex-col">
                  <KV label="Tác giả">{c().author}</KV>
                  <KV label="Thời gian">{c().at}</KV>
                  <KV label="DMA"><DmaChip dma={c().dma} /></KV>
                  <Show when={c().reviewer}>
                    <KV label="Người duyệt">{c().reviewer}</KV>
                  </Show>
                </div>
                <div class="mt-3 grid grid-cols-3 gap-2 text-center">
                  <For each={[['Thêm', c().adds, '#1A7F37'], ['Sửa', c().mods, '#9A6700'], ['Xoá', c().dels, '#D1242F']] as [string, number, string][]}>
                    {(s) => (
                      <div class="rounded-lg border border-line py-2">
                        <div class="font-mono text-[16px] font-semibold" style={{ color: tone(s[2]) }}>{s[1]}</div>
                        <div class="text-[10px] text-[color:var(--muted)]">{s[0]} đối tượng</div>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={c().status === 'pending'}>
                  <div class="mt-3 flex items-center gap-2">
                    <Btn
                      full
                      variant="primary"
                      icon="IcCheck"
                      onClick={() => act(c().id, 'approved', 'Đã duyệt — phát event gis.change-set.approved, sync Hydraulic/DMA')}
                    >
                      Phê duyệt
                    </Btn>
                    <Btn
                      variant="default"
                      danger
                      icon="IcX"
                      onClick={() => act(c().id, 'rejected', 'Đã từ chối change set ' + c().id)}
                    >
                      Từ chối
                    </Btn>
                  </div>
                </Show>
                <Show when={c().status === 'approved'}>
                  <div
                    class="mt-3 rounded-lg bg-[var(--surface2)] px-3 py-2 text-[11.5px]"
                    style={{ color: tone('#1A7F37') }}
                  >
                    <IcExternal size={13} class="mr-1 inline" />
                    Đã đồng bộ sang Hydraulic &amp; DMA Management.
                  </div>
                </Show>
              </Card>

              <Card>
                <div class="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
                  Nhật ký audit
                </div>
                <div class="relative pl-4">
                  <div class="absolute bottom-1 left-[5px] top-1 w-px bg-[var(--line)]" />
                  <For each={[
                    ['Tạo change set', c().author, c().at],
                    ['Validate topology', 'Hệ thống', 'tự động · sạch'],
                    c().reviewer
                      ? [c().status === 'approved' ? 'Phê duyệt' : 'Từ chối', c().reviewer!, 'vừa xong']
                      : ['Đang chờ review', '—', '—'],
                  ] as [string, string, string][]}>
                    {(h) => (
                      <div class="relative mb-2.5 last:mb-0">
                        <span
                          class="absolute -left-4 top-1 h-2.5 w-2.5 rounded-full border-2"
                          style={{ 'border-color': cAccent(), background: 'var(--surface)' }}
                        />
                        <div class="text-[11.5px] font-medium text-[color:var(--text)]">{h[0]}</div>
                        <div class="text-[10.5px] text-[color:var(--muted)]">{h[1]} · {h[2]}</div>
                      </div>
                    )}
                  </For>
                </div>
              </Card>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
