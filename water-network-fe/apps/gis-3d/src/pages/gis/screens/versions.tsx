/* GIS — Phiên bản & phê duyệt: the design revisions saved from the editor (design-be via the BFF
   `/api/gis/editor/*`), what each one changes, and the review: approve (publishes to the GIS
   network) or return with a reason. */
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { For, Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { useSession } from '@/entities/session/api/use-session'
import { REVISION_STATUS } from '../editor/revision-sync'
import { importSessionScope } from '../import-workspace/api'
import { IcCheckCircle, IcClock, IcX } from '../lib/icons'
import { cAccent, chex, tone } from '../lib/theme'
import { createNetworkEditorApi } from '../network-editor/api'
import { Badge, Btn, Card, KV, ScreenHead, Tile } from '../ui/kit'
import type { Edit, Revision } from '../network-editor/model'

export const APPROVE_PERMISSION = 'network-design:approve'

const STATUS_COLOR: Record<string, string> = {
  Draft: '#8B949E',
  Validated: '#0969DA',
  Submitted: '#9A6700',
  Approved: '#1A7F37',
  Published: '#1A7F37',
  PartiallyPublished: '#BC4C00',
  Rejected: '#D1242F',
}
const KIND_LABEL: Record<string, string> = { Pipe: 'Ống', Node: 'Nút', Device: 'Thiết bị' }
const ACTION_LABEL: Record<string, string> = { Add: 'Thêm', Update: 'Sửa', Delete: 'Xoá' }

type RevisionRow = Pick<Revision, 'id' | 'status' | 'version'> & { projectId?: string; name?: string; updatedAt?: string }

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—')
/** Changes the editor drew (derived junctions and split pieces are counted with them, not apart). */
const drawn = (ops: Edit[] | null | undefined) => (ops ?? []).filter(o => !o.after?.attributes.derived)

export function VersionsScreen(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const session = useSession()
  const qc = useQueryClient()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const api = () => createNetworkEditorApi(importSessionScope(session.data()), controller.signal)
  const canApprove = () => session.data()?.user.permissions?.includes(APPROVE_PERMISSION) ?? false

  const list = createQuery(() => ({
    queryKey: ['editor', 'revisions'],
    queryFn: async () => (await api().list()) as RevisionRow[],
    refetchInterval: 15_000,
  }))
  const rows = createMemo(() =>
    [...(list.data ?? [])].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  )
  const [sel, setSel] = createSignal<string | null>(null)
  const selected = () => sel() ?? rows().find(r => r.status === 'Submitted')?.id ?? rows()[0]?.id ?? null
  const detail = createQuery(() => ({
    queryKey: ['editor', 'revision', selected()],
    queryFn: () => api().get(selected()!),
    enabled: !!selected(),
  }))
  const results = createQuery(() => ({
    queryKey: ['editor', 'publish-result', selected()],
    queryFn: () => api().results(selected()!),
    enabled: !!selected() && ['Approved', 'Published', 'PartiallyPublished'].includes(detail.data?.status ?? ''),
  }))

  const count = (st: string) => rows().filter(r => r.status === st).length
  const [busy, setBusy] = createSignal(false)
  const [reason, setReason] = createSignal('')
  const [rejecting, setRejecting] = createSignal(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['editor'] })
  const act = async (action: 'approve' | 'reject') => {
    const id = selected()
    if (!id || busy()) return
    setBusy(true)
    try {
      await api().action(id, action, action === 'reject' ? reason().trim() : undefined)
      props.toast(action === 'approve' ? 'Đã duyệt — thay đổi đang được phát hành vào mạng lưới' : 'Đã trả lại bản thiết kế cho người lập', 'success')
      setRejecting(false)
      setReason('')
      await refresh()
    } catch (e) {
      props.toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const tally = createMemo(() => {
    const t = { Add: 0, Update: 0, Delete: 0 }
    for (const o of drawn(detail.data?.operations)) t[o.action]++
    return t
  })

  return (
    <div class="flex flex-col gap-3" data-screen-label="Phiên bản & phê duyệt" data-testid="versions-screen">
      <ScreenHead title="Phiên bản & phê duyệt" sub="Bản thiết kế từ Biên tập · chỉ bản đã duyệt mới được phát hành vào mạng lưới" />

      <div class="grid grid-cols-2 gap-3">
        <For each={[
          ['Chờ duyệt', count('Submitted'), '#9A6700', 'IcClock'],
          ['Đã phát hành', count('Published') + count('PartiallyPublished') + count('Approved'), '#1A7F37', 'IcCheckCircle'],
          ['Đang soạn', count('Draft') + count('Validated'), '#8B949E', 'IcPencil'],
          ['Tổng bản thiết kế', rows().length, '#0E7C86', 'IcGitBranch'],
        ] as [string, number, string, string][]}>
          {s => (
            <div class="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5" style={{ 'box-shadow': 'var(--card-shadow)' }}>
              <Tile icon={s[3]} col={s[2]} size={38} />
              <div>
                <div class="font-mono text-[19px] font-semibold leading-none text-[color:var(--text)]">{s[1]}</div>
                <div class="mt-1 text-[10.5px] text-[color:var(--muted)]">{s[0]}</div>
              </div>
            </div>
          )}
        </For>
      </div>

      <Card pad={false} class="overflow-hidden">
        <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span class="text-[13px] font-semibold text-[color:var(--text)]">Bản thiết kế</span>
          <Btn size="sm" variant="default" onClick={() => void refresh()}>Làm mới</Btn>
        </div>
        <Show when={!list.isLoading} fallback={<div class="px-4 py-6 text-[12px] text-[color:var(--muted)]">Đang tải…</div>}>
          <Show when={!list.isError} fallback={<div class="px-4 py-6 text-[12px]" style={{ color: tone('#D1242F') }}>{(list.error as Error)?.message}</div>}>
            <Show when={rows().length} fallback={<div class="px-4 py-6 text-[12px] text-[color:var(--muted)]">Chưa có bản thiết kế nào. Lưu nháp từ màn hình Biên tập để bắt đầu.</div>}>
              <div data-testid="revision-list">
                <For each={rows()}>
                  {r => {
                    const col = () => tone(STATUS_COLOR[r.status] ?? '#8B949E')
                    return (
                      <button
                        type="button"
                        onClick={() => setSel(r.id)}
                        class="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]"
                        style={{ background: selected() === r.id ? chex(cAccent(), 0.08) : 'transparent' }}
                        data-revision={r.id}
                      >
                        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: chex(col(), 0.14), color: col() }}>
                          {r.status === 'Submitted' ? <IcClock size={16} /> : r.status === 'Draft' ? <IcX size={16} /> : <IcCheckCircle size={16} />}
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-[12.5px] font-medium text-[color:var(--text)]">{r.name ?? `Bản thiết kế ${r.id.slice(0, 8)}`}</span>
                          <span class="block font-mono text-[10.5px] text-[color:var(--muted)]">{r.id.slice(0, 13)} · v{r.version} · {when(r.updatedAt)}</span>
                        </span>
                        <Badge color={col()} soft>{REVISION_STATUS[r.status] ?? r.status}</Badge>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Card>

      <Show when={detail.data}>
        {d => (
          <Card>
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-[11px] text-[color:var(--muted)]">{d().id.slice(0, 13)}</span>
              <Badge color={tone(STATUS_COLOR[d().status] ?? '#8B949E')} soft>{REVISION_STATUS[d().status] ?? d().status}</Badge>
            </div>
            <div class="mt-2 grid grid-cols-3 gap-2 text-center" data-testid="revision-tally">
              <For each={[['Thêm', tally().Add, '#1A7F37'], ['Sửa', tally().Update, '#9A6700'], ['Xoá', tally().Delete, '#D1242F']] as [string, number, string][]}>
                {s => (
                  <div class="rounded-lg border border-line py-2">
                    <div class="font-mono text-[16px] font-semibold" style={{ color: tone(s[2]) }}>{s[1]}</div>
                    <div class="text-[10px] text-[color:var(--muted)]">{s[0]}</div>
                  </div>
                )}
              </For>
            </div>
            <div class="mt-3 max-h-[220px] overflow-auto rounded-lg border border-line">
              <For each={drawn(d().operations)} fallback={<div class="px-3 py-3 text-[12px] text-[color:var(--muted)]">Bản thiết kế chưa có thay đổi.</div>}>
                {o => (
                  <div class="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[12px] first:border-t-0">
                    <span class="w-10 shrink-0 font-medium">{ACTION_LABEL[o.action]}</span>
                    <span class="w-16 shrink-0 text-[color:var(--muted)]">{KIND_LABEL[o.kind]}</span>
                    <span class="min-w-0 flex-1 truncate font-mono">{o.after?.assetCode ?? o.before?.assetCode ?? o.targetId}</span>
                    <Show when={o.after?.attributes.diameterMm}>
                      <span class="text-[color:var(--muted)]">DN{o.after!.attributes.diameterMm}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>

            <Show when={d().status === 'Submitted'}>
              <Show
                when={canApprove()}
                fallback={<div class="mt-3 text-[11.5px] text-[color:var(--muted)]">Chờ người có quyền phê duyệt.</div>}
              >
                <Show
                  when={rejecting()}
                  fallback={
                    <div class="mt-3 flex items-center gap-2">
                      <Btn full variant="primary" icon="IcCheck" disabled={busy()} onClick={() => void act('approve')}>Phê duyệt &amp; phát hành</Btn>
                      <Btn variant="default" danger icon="IcX" disabled={busy()} onClick={() => setRejecting(true)}>Trả lại</Btn>
                    </div>
                  }
                >
                  <div class="mt-3 flex flex-col gap-2">
                    <textarea
                      class="min-h-[64px] rounded-lg border border-line bg-[var(--surface)] p-2 text-[12.5px]"
                      placeholder="Lý do trả lại (bắt buộc)"
                      aria-label="Lý do trả lại"
                      value={reason()}
                      onInput={e => setReason(e.currentTarget.value)}
                    />
                    <div class="flex items-center gap-2">
                      <Btn variant="default" danger icon="IcX" disabled={busy() || !reason().trim()} onClick={() => void act('reject')}>Trả lại bản thiết kế</Btn>
                      <Btn variant="default" disabled={busy()} onClick={() => setRejecting(false)}>Huỷ</Btn>
                    </div>
                  </div>
                </Show>
              </Show>
            </Show>

            <Show when={results.data?.length}>
              <div class="mt-3 flex flex-col">
                <KV label="Phát hành">
                  {results.data!.filter(x => !x.reason && !/fail|reject|error/i.test(x.status ?? '')).length}/{results.data!.length} đối tượng
                </KV>
                <For each={results.data!.filter(x => x.reason)}>
                  {x => <div class="text-[11.5px]" style={{ color: tone('#D1242F') }}>{x.draftAssetId}: {x.reason}</div>}
                </For>
              </div>
            </Show>
          </Card>
        )}
      </Show>
    </div>
  )
}
