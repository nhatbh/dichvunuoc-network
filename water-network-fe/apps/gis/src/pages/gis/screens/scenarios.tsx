/* GIS — Kịch bản & Phiên bản mạng lưới (SolidJS port of scenarios.jsx).
   Imports branch store from lib/branch-store.ts — do NOT redefine constants. */
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { useGis } from '../lib/gis-data'
import {
  SC_CARDS, SC_LANES, SC_STATE,
  cardDelta, effectiveCards,
  type Branch,
} from '../lib/branch-store'
import { IcAlert, IcCheckBadge, IcDownload, IcGitBranch, IcShield, IcDatabase, IcExternal } from '../lib/icons'
import { cAccent, chex, cTheme, fmtDec, rad, tone } from '../lib/theme'
import {
  Badge, Btn, Card, DmaChip, Empty, Field, KV, Modal, ScreenHead, SegToggle, Select, TextInput, Tile,
} from '../ui/kit'
import { NetworkMapOL } from '../ui/network-map-ol'
import type { Route } from '../shell/nav'

/* ── LineageGraph ── */
const NW = 172, NH = 60

function LineageGraph(props: {
  branches: Branch[]
  selId: string
  compareSel: { a: string; b: string } | null
  onSelect: (id: string) => void
}): JSX.Element {
  const byId = createMemo(() => Object.fromEntries(props.branches.map((b) => [b.id, b])))
  const cy = (b: Branch) => b.y + NH / 2
  const edges = createMemo(() =>
    props.branches
      .filter((b) => b.base && byId()[b.base])
      .map((b) => ({
        from: byId()[b.base!]!,
        to: b,
        promote: byId()[b.base!]!.lane !== b.lane && b.lane !== 'future',
      })),
  )
  const ac = () => cAccent()

  return (
    <div class="relative overflow-x-auto">
      <div class="relative" style={{ width: '1040px', height: '392px' }}>
        {/* lane bands */}
        <For each={[['past', 0, 380], ['current', 384, 252], ['future', 640, 400]] as [string, number, number][]}>
          {([k, x, w]) => (
            <div class="absolute top-0 bottom-0" style={{ left: `${x}px`, width: `${w}px` }}>
              <div
                class="absolute inset-y-2 left-0 right-0 rounded-2xl"
                style={{
                  background: chex(SC_LANES[k]!.col, cTheme() === 'light' ? 0.045 : 0.08),
                  border: `1px dashed ${chex(SC_LANES[k]!.col, 0.3)}`,
                }}
              />
              <div class="absolute left-3 top-3 flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full" style={{ background: tone(SC_LANES[k]!.col) }} />
                <span
                  class="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: tone(SC_LANES[k]!.col) }}
                >
                  {SC_LANES[k]!.label}
                </span>
                <span class="text-[10px] text-[color:var(--muted2)]">· {SC_LANES[k]!.sub}</span>
              </div>
            </div>
          )}
        </For>

        {/* edges */}
        <svg class="pointer-events-none absolute inset-0" width={1040} height={392}>
          <For each={edges()}>
            {(e) => {
              const x1 = e.from.x + NW, y1 = cy(e.from), x2 = e.to.x, y2 = cy(e.to)
              const mx = (x1 + x2) / 2
              const col = e.promote ? tone('#1A7F37') : chex(SC_LANES[e.to.lane]!.col, 0.55)
              return (
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={col}
                  stroke-width={e.promote ? 2.4 : 1.8}
                  stroke-dasharray={e.promote ? undefined : '5 4'}
                />
              )
            }}
          </For>
        </svg>

        {/* nodes */}
        <For each={props.branches}>
          {(b) => {
            const st = () => SC_STATE[b.state]!
            const col = () => tone(SC_LANES[b.lane]!.col)
            const isSel = () => props.selId === b.id
            const inCmp = () => props.compareSel && (props.compareSel.a === b.id || props.compareSel.b === b.id)
            const official = () => b.state === 'official'
            return (
              <button
                onClick={() => props.onSelect(b.id)}
                class="absolute flex flex-col justify-between rounded-xl border bg-[var(--surface)] px-3 py-2 text-left transition-all"
                style={{
                  left: `${b.x}px`,
                  top: `${b.y}px`,
                  width: `${NW}px`,
                  height: `${NH}px`,
                  'border-color': isSel() ? ac() : official() ? tone('#1A7F37') : 'var(--line)',
                  'border-width': isSel() || official() ? '2px' : '1px',
                  'box-shadow': isSel() ? `0 0 0 3px ${chex(ac(), 0.16)}` : 'var(--card-shadow)',
                  outline: inCmp() ? `2px solid ${tone('#8250DF')}` : 'none',
                  'outline-offset': '2px',
                }}
              >
                <div class="flex items-center gap-1.5">
                  <span
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                    style={{ background: chex(col(), 0.16), color: col() }}
                  >
                    <IcGitBranch size={12} />
                  </span>
                  <span class="truncate text-[12px] font-semibold text-[color:var(--text)]">{b.name}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="flex items-center gap-1 font-mono text-[10px] text-[color:var(--muted)]">
                    {b.ver}
                    <Show when={official()}>
                      <IcCheckBadge size={12} class="ml-0.5" style={{ color: tone('#1A7F37') }} />
                    </Show>
                  </span>
                  <span class="flex items-center gap-1 text-[9.5px] font-medium" style={{ color: tone(st().c) }}>
                    <span class="h-1.5 w-1.5 rounded-full" style={{ background: tone(st().c) }} />
                    {st().l}
                  </span>
                </div>
              </button>
            )
          }}
        </For>
      </div>

      <div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10.5px] text-[color:var(--muted)]">
        <span class="flex items-center gap-1.5">
          <span class="inline-block h-[2.4px] w-5 rounded" style={{ background: tone('#1A7F37') }} />
          Đề bạt chính thức
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-[2px] w-5 rounded border-b border-dashed"
            style={{ 'border-color': tone('#0969DA') }}
          />
          Fork kịch bản
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 rounded" style={{ outline: `2px solid ${tone('#8250DF')}` }} />
          Đang so sánh
        </span>
      </div>
    </div>
  )
}

/* ── CardRow ── */
function CardRow(props: { id: string; right?: JSX.Element; muted?: boolean }): JSX.Element {
  const G = useGis()
  const c = () => SC_CARDS[props.id]
  return (
    <Show when={c()}>
      {(card) => {
        const meta = () => G.ASSET_TYPES[card().kind] ?? { icon: 'IcGitBranch', col: '#0E7C86', label: card().kind }
        return (
          <div
            class="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2"
            style={{ 'border-radius': `${rad()}px`, opacity: props.muted ? 0.6 : 1 }}
          >
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: chex(tone(meta().col), 0.14), color: tone(meta().col) }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="8" r="2.4" />
                <path d="M6 8.4v7.2" /><path d="M18 10.4c0 4-3.5 4.6-6 5" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[12px] font-medium text-[color:var(--text)]">{card().title}</div>
              <div class="flex items-center gap-2 font-mono text-[10px] text-[color:var(--muted)]">
                <span>{props.id}</span>
                <span class="flex items-center gap-1.5">
                  <span style={{ color: tone('#1A7F37') }}>+{card().adds}</span>
                  <span style={{ color: tone('#9A6700') }}>~{card().mods}</span>
                  <span style={{ color: tone('#D1242F') }}>−{card().dels}</span>
                </span>
              </div>
            </div>
            <DmaChip dma={card().dma} sm />
            {props.right}
          </div>
        )
      }}
    </Show>
  )
}

/* ── DeltaPills ── */
function DeltaPills(props: { d: { adds: number; mods: number; dels: number } }): JSX.Element {
  return (
    <span class="flex items-center gap-2 font-mono text-[12px]">
      <span style={{ color: tone('#1A7F37') }}>+{props.d.adds}</span>
      <span style={{ color: tone('#9A6700') }}>~{props.d.mods}</span>
      <span style={{ color: tone('#D1242F') }}>−{props.d.dels}</span>
    </span>
  )
}

/* ── ForkModal ── */
function ForkModal(props: {
  open: boolean
  branches: Branch[]
  defBase: string
  onClose: () => void
  onCreate: (name: string, baseId: string, lane: string) => void
}): JSX.Element {
  const [name, setName] = createSignal('')
  const [base, setBase] = createSignal(props.defBase)
  const [lane, setLane] = createSignal('future')

  createEffect(() => {
    if (props.open) {
      setName('')
      setBase(props.defBase)
      setLane('future')
    }
  })

  const opts = () =>
    props.branches
      .filter((b) => b.state !== 'archived')
      .map((b) => ({ value: b.id, label: b.name + ' · ' + b.ver }))

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Tạo nhánh kịch bản mới"
      subtitle="Nhánh mới kế thừa toàn bộ dữ liệu của base, chỉ lưu phần delta của bạn."
      icon="IcGitBranch"
      footer={
        <>
          <Btn variant="ghost" onClick={props.onClose}>Huỷ</Btn>
          <Btn variant="primary" icon="IcGitBranch" onClick={() => props.onCreate(name(), base(), lane())}>
            Tạo nhánh
          </Btn>
        </>
      }
    >
      <div class="flex flex-col gap-3">
        <Field label="Tên kịch bản" required>
          <TextInput value={name()} onChange={setName} placeholder="vd: Mở rộng cấp nước phía Bắc" />
        </Field>
        <Field label="Tách từ (base)" hint="Nhánh sẽ dùng dữ liệu từ bản này làm nền.">
          <Select value={base()} onChange={setBase} options={opts()} />
        </Field>
        <Field label="Vòng đời">
          <Select
            value={lane()}
            onChange={setLane}
            options={[
              { value: 'future', label: 'Tương lai — kịch bản quy hoạch' },
              { value: 'current', label: 'Hiện tại — bản làm việc' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  )
}

/* ── CompareView ── */
function CompareView(props: {
  branches: Branch[]
  cmp: { a: string; b: string }
  setCmp: (v: { a: string; b: string }) => void
  A: Branch | undefined
  B: Branch | undefined
  diff: { onlyA: string[]; onlyB: string[]; delta: { adds: number; mods: number; dels: number }; dmas: string[] } | null
  toast: (m: string, k?: string) => void
  onApplyAll: () => void
}): JSX.Element {
  const G = useGis()
  const opts = () => props.branches.map((b) => ({ value: b.id, label: b.name + ' · ' + b.ver }))
  const empPipes = () => {
    if (!props.diff) return new Set<string>()
    const pipeIds = new Set<string>()
    const dmaSet = new Set(props.diff.dmas)
    G.pipes.forEach((p) => { if (dmaSet.has(p.dma)) pipeIds.add(p.id) })
    return pipeIds
  }

  return (
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
      <div class="flex flex-col gap-3.5">
        <Card>
          <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">So sánh hai bản</div>
          <div class="flex flex-col gap-2.5">
            <Field label="Bản nền (A)">
              <Select value={props.cmp.a} onChange={(v) => props.setCmp({ ...props.cmp, a: v })} options={opts()} />
            </Field>
            <div class="flex justify-center text-[color:var(--muted2)]">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 4v15" /><path d="m6 13 6 6 6-6" />
              </svg>
            </div>
            <Field label="Bản đích (B)">
              <Select value={props.cmp.b} onChange={(v) => props.setCmp({ ...props.cmp, b: v })} options={opts()} />
            </Field>
          </div>
        </Card>

        <Show when={props.diff}>
          {(diff) => (
            <Card>
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Δ B so với A</span>
                <DeltaPills d={diff().delta} />
              </div>
              <div class="mb-3 grid grid-cols-3 gap-2 text-center">
                <For each={[['Thêm', diff().delta.adds, '#1A7F37'], ['Sửa', diff().delta.mods, '#9A6700'], ['Xoá', diff().delta.dels, '#D1242F']] as [string, number, string][]}>
                  {(s) => (
                    <div class="rounded-lg border border-line py-2">
                      <div class="font-mono text-[17px] font-semibold" style={{ color: tone(s[2]) }}>{s[1]}</div>
                      <div class="text-[10px] text-[color:var(--muted)]">{s[0]} đối tượng</div>
                    </div>
                  )}
                </For>
              </div>
              <div class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
                Card chỉ có ở B ({diff().onlyB.length})
              </div>
              <div class="mt-1.5 flex flex-col gap-1.5">
                <Show
                  when={diff().onlyB.length > 0}
                  fallback={
                    <div class="rounded-lg bg-[var(--surface2)] px-3 py-2 text-[11.5px] text-[color:var(--muted)]">
                      B không thêm gì so với A.
                    </div>
                  }
                >
                  <For each={diff().onlyB}>{(id) => <CardRow id={id} />}</For>
                </Show>
              </div>
              <Show when={diff().onlyA.length > 0}>
                <>
                  <div class="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
                    Chỉ có ở A ({diff().onlyA.length}) — B chưa có
                  </div>
                  <div class="mt-1.5 flex flex-col gap-1.5">
                    <For each={diff().onlyA}>{(id) => <CardRow id={id} muted />}</For>
                  </div>
                </>
              </Show>
              <Show when={diff().onlyB.length > 0}>
                <Btn full size="sm" variant="primary" icon="IcArrowDown" onClick={props.onApplyAll} class="mt-3">
                  Hợp nhất A → B ({diff().onlyB.length} card)
                </Btn>
              </Show>
            </Card>
          )}
        </Show>
      </div>

      <Card pad={false} class="overflow-hidden">
        <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span class="text-[13px] font-semibold text-[color:var(--text)]">Overlay khác biệt trên bản đồ</span>
          <span class="text-[11px] text-[color:var(--muted)]">Vùng tô đậm = nơi B thay đổi so với A</span>
        </div>
        <div class="h-[440px]">
          <NetworkMapOL
            layers={{ dma: true, pipe: true, valve: true, source: true, node: false, hydrant: false, conn: false, label: false }}
            emphasis={{ dim: true, pipes: empPipes() }}
            selected={null}
            onSelect={() => {}}
            legend={false}
          />
        </div>
      </Card>
    </div>
  )
}

/* ── Main screen ── */
export function ScenariosScreen(props: {
  toast: (m: string, k?: string) => void
  go: (r: Route) => void
  branches: Branch[]
  setBranches: (fn: (bs: Branch[]) => Branch[]) => void
}): JSX.Element {
  const [selId, setSelId] = createSignal('B-QH30')
  const [mode, setMode] = createSignal<'tree' | 'compare'>('tree')
  const [cmp, setCmp] = createSignal({ a: 'B-CUR', b: 'B-QH30' })
  const [impOpen, setImpOpen] = createSignal(false)
  const [forkOpen, setForkOpen] = createSignal(false)
  const [promo, setPromo] = createSignal<Branch | null>(null)

  const byId = createMemo(() => Object.fromEntries(props.branches.map((b) => [b.id, b])))
  const sel = createMemo(() => byId()[selId()] ?? null)
  const baseOf = createMemo(() => {
    const s = sel()
    return s && s.base ? byId()[s.base] ?? null : null
  })
  const selDelta = createMemo(() => {
    const s = sel()
    return s ? cardDelta(s.cards) : null
  })

  const importableByBranch = createMemo(() => {
    const s = sel()
    if (!s) return []
    const own = new Set(effectiveCards(s, props.branches))
    return props.branches
      .filter((b) => b.id !== s.id)
      .map((b) => ({ b, cards: b.cards.filter((c) => !own.has(c)) }))
      .filter((g) => g.cards.length > 0)
  })

  const applyCard = (cardId: string) => {
    const s = sel()
    if (!s) return
    props.setBranches((bs) =>
      bs.map((b) =>
        b.id === selId()
          ? { ...b, cards: b.cards.includes(cardId) ? b.cards : [...b.cards, cardId], ver: 'v' + (parseInt(b.ver.slice(1)) + 1) }
          : b,
      ),
    )
    props.toast('Đã nhập ' + cardId + ' vào ' + s.name + ' — tạo v' + (parseInt(s.ver.slice(1)) + 1), 'success')
  }

  const doFork = (name: string, baseIdSel: string, lane: string) => {
    const base = byId()[baseIdSel]
    if (!base) return
    const id = 'B-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    const nb: Branch = {
      id, name: name || 'Kịch bản mới', lane: lane as Branch['lane'], state: 'draft',
      ver: 'v1', base: baseIdSel, baseVer: base.ver, at: 'vừa xong', by: 'Lê Biên Tập',
      cards: [], x: 848, y: 36, pipeKm: base.pipeKm, assets: base.assets,
      note: 'Fork từ ' + base.name + ' @ ' + base.ver + '.',
    }
    props.setBranches((bs) => [...bs, nb])
    setSelId(id)
    setForkOpen(false)
    props.toast('Đã tạo nhánh ' + nb.name + ' từ ' + base.name, 'success')
  }

  const doPromote = (b: Branch) => {
    props.setBranches((bs) =>
      bs.map((x) => {
        if (x.id === b.id) return { ...x, lane: 'current' as const, state: 'official' as const, base: 'B-CUR' }
        if (x.state === 'official') return { ...x, lane: 'past' as const, state: 'archived' as const, name: x.name + ' (cũ)' }
        return x
      }),
    )
    setPromo(null)
    setSelId(b.id)
    props.toast('Đã đề bạt "' + b.name + '" làm bản CHÍNH THỨC — đóng băng bản cũ, phát gis.network.published', 'success')
  }

  const editable = (b: Branch | null) => b && (b.state === 'draft' || b.state === 'review')

  const cloneAndEdit = (b: Branch) => {
    const id = 'B-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    const nb: Branch = {
      id, name: b.name.replace(/ \(cũ\)$/, '') + ' — bản sửa',
      lane: 'future', state: 'draft', ver: 'v1', base: b.id, baseVer: b.ver,
      at: 'vừa xong', by: 'Lê Biên Tập', cards: [], x: 848, y: 36,
      pipeKm: b.pipeKm, assets: b.assets, note: 'Nhân bản từ ' + b.name + ' @ ' + b.ver + ' để biên tập.',
    }
    props.setBranches((bs) => [...bs, nb])
    props.toast('Đã nhân bản → "' + nb.name + '", mở để sửa', 'success')
    props.go({ name: 'editor', branch: id })
  }

  const openEdit = (b: Branch) => {
    if (editable(b)) props.go({ name: 'editor', branch: b.id })
    else cloneAndEdit(b)
  }

  const A = createMemo(() => byId()[cmp().a])
  const B = createMemo(() => byId()[cmp().b])

  const diff = createMemo(() => {
    const aa = A(), bb = B()
    if (!aa || !bb) return null
    const ea = new Set(effectiveCards(aa, props.branches))
    const eb = new Set(effectiveCards(bb, props.branches))
    const onlyB = [...eb].filter((c) => !ea.has(c))
    const onlyA = [...ea].filter((c) => !eb.has(c))
    const dmas = [...new Set([...onlyA, ...onlyB].map((c) => SC_CARDS[c]?.dma).filter((d): d is string => Boolean(d)))]
    return { onlyA, onlyB, delta: cardDelta(onlyB), dmas }
  })

  const applyCardTo = (branchId: string, cardId: string) => {
    props.setBranches((bs) =>
      bs.map((b) =>
        b.id === branchId
          ? { ...b, cards: b.cards.includes(cardId) ? b.cards : [...b.cards, cardId], ver: 'v' + (parseInt(b.ver.slice(1)) + 1) }
          : b,
      ),
    )
  }

  return (
    <div class="mx-auto flex max-w-[1320px] flex-col gap-3.5 px-4 py-5 sm:px-6" data-screen-label="Kịch bản mạng lưới">
      <ScreenHead
        title="Kịch bản & phiên bản mạng lưới"
        sub="Quá khứ · Hiện tại · Tương lai — fork nhánh, cherry-pick card, so sánh, đề bạt bản chính thức"
        right={
          <>
            <SegToggle
              options={[
                { id: 'tree', label: 'Cây phiên bản', icon: 'IcGitBranch' },
                { id: 'compare', label: 'So sánh', icon: 'IcLayers' },
              ]}
              value={mode()}
              onChange={(v) => setMode(v as 'tree' | 'compare')}
            />
            <Btn size="sm" variant="primary" icon="IcPlus" onClick={() => setForkOpen(true)}>
              Tạo nhánh
            </Btn>
          </>
        }
      />

      {/* lifecycle KPI */}
      <div class="grid grid-cols-3 gap-3">
        <For each={['past', 'current', 'future'] as const}>
          {(k) => {
            const list = () => props.branches.filter((b) => b.lane === k)
            return (
              <div
                class="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-3.5"
                style={{ 'box-shadow': 'var(--card-shadow)', 'border-radius': `${rad() + 2}px` }}
              >
                <Tile
                  icon={k === 'past' ? 'IcDatabase' : k === 'current' ? 'IcCheckBadge' : 'IcGitBranch'}
                  col={SC_LANES[k]!.col}
                  size={38}
                />
                <div class="min-w-0">
                  <div class="font-mono text-[19px] font-semibold leading-none text-[color:var(--text)]">{list().length}</div>
                  <div class="mt-1 truncate text-[10.5px] text-[color:var(--muted)]">
                    {SC_LANES[k]!.label} · {SC_LANES[k]!.sub}
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>

      <Show
        when={mode() === 'tree'}
        fallback={
          <CompareView
            branches={props.branches}
            cmp={cmp()}
            setCmp={setCmp}
            A={A()}
            B={B()}
            diff={diff()}
            toast={props.toast}
            onApplyAll={() => {
              const d = diff()
              const bb = B()
              const aa = A()
              if (!d || !bb || !aa) return
              setMode('tree')
              setSelId(bb.id)
              d.onlyB.forEach((id) => applyCardTo(bb.id, id))
              props.toast('Đã hợp nhất ' + d.onlyB.length + ' card từ ' + aa.name + ' vào ' + bb.name, 'success')
            }}
          />
        }
      >
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_372px]">
          <Card pad={false} class="overflow-hidden">
            <div class="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-[color:var(--text)]">
              Cây phả hệ phiên bản
            </div>
            <div class="p-3">
              <LineageGraph branches={props.branches} selId={selId()} compareSel={null} onSelect={setSelId} />
            </div>
          </Card>

          <Show when={sel()}>
            {(s) => (
              <div class="flex flex-col gap-3.5">
                <Card>
                  <div class="flex items-start gap-2.5">
                    <Tile icon="IcGitBranch" col={SC_LANES[s().lane]!.col} size={38} />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <Badge color={tone(SC_STATE[s().state]!.c)} soft dot>{SC_STATE[s().state]!.l}</Badge>
                        <Badge color={tone(SC_LANES[s().lane]!.col)} soft>{SC_LANES[s().lane]!.label}</Badge>
                      </div>
                      <h3 class="mt-1 text-[14.5px] font-semibold leading-tight text-[color:var(--text)]">{s().name}</h3>
                      <div class="mt-0.5 font-mono text-[11px] text-[color:var(--muted)]">{s().id} · {s().ver}</div>
                    </div>
                  </div>
                  <p class="mt-2.5 text-[11.5px] leading-relaxed text-[color:var(--muted)]">{s().note}</p>
                  <div class="mt-2.5 flex flex-col">
                    <Show
                      when={baseOf()}
                      fallback={<KV label="Gốc">Bản nền — không kế thừa</KV>}
                    >
                      {(base) => (
                        <KV label="Tách từ">
                          <button onClick={() => setSelId(base().id)} class="font-medium text-[color:var(--text)] underline decoration-dotted">
                            {base().name}
                          </button>{' '}
                          <span class="font-mono text-[color:var(--muted)]">@ {s().baseVer ?? base().ver}</span>
                        </KV>
                      )}
                    </Show>
                    <KV label="Cập nhật">{s().at} · {s().by}</KV>
                    <KV label="Chiều dài ống" mono>{fmtDec(s().pipeKm, 1)} km</KV>
                    <Show when={selDelta() && ((selDelta()!.adds + selDelta()!.mods + selDelta()!.dels) > 0)}>
                      <KV label="Δ so với base"><DeltaPills d={selDelta()!} /></KV>
                    </Show>
                  </div>
                </Card>

                <Card>
                  <div class="mb-2 flex items-center justify-between">
                    <span class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
                      Card trong nhánh ({s().cards.length})
                    </span>
                    <button
                      onClick={() => setImpOpen(true)}
                      class="flex items-center gap-1 text-[11.5px] font-medium"
                      style={{ color: tone(cAccent()) }}
                    >
                      <IcDownload size={13} />
                      Nhập card
                    </button>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <Show
                      when={s().cards.length > 0}
                      fallback={
                        <div class="rounded-lg bg-[var(--surface2)] px-3 py-3 text-center text-[11.5px] text-[color:var(--muted)]">
                          Nhánh kế thừa toàn bộ base, chưa có card delta riêng.
                        </div>
                      }
                    >
                      <For each={s().cards}>{(id) => <CardRow id={id} />}</For>
                    </Show>
                  </div>
                </Card>

                <div class="flex flex-col gap-2">
                  <Show
                    when={editable(s())}
                    fallback={
                      <Btn full variant="primary" icon="IcGitBranch" onClick={() => cloneAndEdit(s())}>
                        Nhân bản để sửa
                      </Btn>
                    }
                  >
                    <Btn full variant="primary" icon="IcPencil" onClick={() => openEdit(s())}>
                      Mở để sửa
                    </Btn>
                  </Show>
                  <div class="grid grid-cols-2 gap-2">
                    <Btn icon="IcUpload" onClick={() => props.go({ name: 'import', branch: editable(s()) ? s().id : undefined })}>
                      Import dữ liệu
                    </Btn>
                    <Btn icon="IcLayers" onClick={() => { setCmp({ a: s().base ?? 'B-CUR', b: s().id }); setMode('compare') }}>
                      So sánh base
                    </Btn>
                  </div>
                  <Btn full icon="IcGitBranch" onClick={() => setForkOpen(true)}>
                    Fork nhánh từ đây
                  </Btn>
                  <Show
                    when={s().state !== 'official'}
                    fallback={
                      <div
                        class="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium"
                        style={{ background: chex(tone('#1A7F37'), 0.12), color: tone('#1A7F37'), 'border-radius': `${rad()}px` }}
                      >
                        <IcCheckBadge size={15} />
                        Đang là bản of-record
                      </div>
                    }
                  >
                    <Btn full variant="default" icon="IcCheckBadge" onClick={() => setPromo(s())}>
                      Đặt làm bản chính thức
                    </Btn>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>

      {/* Import modal */}
      <Modal
        open={impOpen()}
        onClose={() => setImpOpen(false)}
        title={'Nhập card vào ' + (sel()?.name ?? '')}
        subtitle="Cherry-pick change set từ nhánh khác. Card đã có trong chuỗi kế thừa sẽ bị ẩn."
        icon="IcDownload"
        wide
      >
        <Show
          when={importableByBranch().length > 0}
          fallback={
            <Empty
              icon="IcDownload"
              title="Không có card nào để nhập"
              hint="Mọi card từ nhánh khác đã nằm trong chuỗi kế thừa của nhánh này."
            />
          }
        >
          <div class="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
            <For each={importableByBranch()}>
              {(g) => (
                <div>
                  <div class="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
                    <span class="h-1.5 w-1.5 rounded-full" style={{ background: tone(SC_LANES[g.b.lane]!.col) }} />
                    {g.b.name}
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <For each={g.cards}>
                      {(id) => (
                        <CardRow
                          id={id}
                          right={
                            <Btn size="sm" icon="IcPlus" onClick={() => { applyCard(id); setImpOpen(false) }}>
                              Nhập
                            </Btn>
                          }
                        />
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Modal>

      {/* Fork modal */}
      <ForkModal
        open={forkOpen()}
        branches={props.branches}
        defBase={selId()}
        onClose={() => setForkOpen(false)}
        onCreate={doFork}
      />

      {/* Promote modal */}
      <Modal
        open={!!promo()}
        onClose={() => setPromo(null)}
        title="Đề bạt bản chính thức"
        subtitle="Thao tác có kiểm soát — thay đổi nguồn sự thật của toàn hệ thống"
        icon="IcCheckBadge"
        accent="#1A7F37"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setPromo(null)}>Huỷ</Btn>
            <Btn variant="primary" icon="IcCheckBadge" onClick={() => { const p = promo(); if (p) doPromote(p) }}>
              Xác nhận đề bạt
            </Btn>
          </>
        }
      >
        <Show when={promo()}>
          {(p) => (
            <div class="flex flex-col gap-3">
              <div class="rounded-lg border border-line p-3 text-[12px]" style={{ 'border-radius': `${rad()}px` }}>
                <div class="font-semibold text-[color:var(--text)]">
                  {p().name}{' '}
                  <span class="font-mono text-[11px] text-[color:var(--muted)]">{p().ver}</span>
                </div>
                <Show when={p().base && byId()[p().base!]}>
                  <div class="mt-0.5 text-[11.5px] text-[color:var(--muted)]">
                    Tách từ {byId()[p().base!]!.name} @ {p().baseVer ?? byId()[p().base!]!.ver}
                  </div>
                </Show>
              </div>
              <div class="flex flex-col gap-2">
                <For each={[
                  ['IcShield', 'Validate topology toàn mạng trước khi publish'],
                  ['IcDatabase', 'Bản of-record hiện tại → đóng băng thành snapshot Quá khứ'],
                  ['IcExternal', 'Phát event sync sang Hydraulic · DMA · EAM · Billing'],
                ] as [string, string][]}>
                  {(r) => (
                    <div class="flex items-start gap-2.5 text-[12px] text-[color:var(--text2)]">
                      <span style={{ color: tone('#1A7F37') }}>
                        {r[0] === 'IcShield' && <IcShield size={15} />}
                        {r[0] === 'IcDatabase' && <IcDatabase size={15} />}
                        {r[0] === 'IcExternal' && <IcExternal size={15} />}
                      </span>
                      {r[1]}
                    </div>
                  )}
                </For>
              </div>
              <div
                class="rounded-lg px-3 py-2 text-[11.5px]"
                style={{ background: chex(tone('#9A6700'), 0.12), color: tone('#9A6700') }}
              >
                <IcAlert size={13} class="mr-1 inline" />
                Cần quyền GIS_PUBLISHER. Hành động được ghi audit và có thể rollback về snapshot trước.
              </div>
            </div>
          )}
        </Show>
      </Modal>
    </div>
  )
}
