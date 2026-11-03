/* GIS — Biên tập mạng lưới: CAD chrome (SolidJS port of editor-cad.jsx UI parts).
   Branch gate, command line, status bar, COGO modal + collapsed rails. The workspace bars and
   panels live in workspace-chrome.tsx. */
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { ED_U2M, type Pt, edPolyLen } from './model'
import { SC_LANES, SC_STATE, type Branch } from '../lib/branch-store'
import { Icon } from '../lib/icons'
import { cAccent, cTheme, chex, fmtDec, fmtInt, fmtKm, tone } from '../lib/theme'
import { Badge, Btn, Field, Modal, TextInput } from '../ui/kit'
import type { SnapModes } from './canvas'

export interface LogEntry {
  t: string
  k: 'info' | 'ok' | 'err' | 'cmd'
}

/* ── Branch gate ──
   Modern project browser: the official record leads as a hero card, working branches follow in
   a responsive grid of preview cards (thumbnail saved with the draft), archives last. */
type GateFilter = 'all' | 'draft' | 'review'

function BranchThumb(props: { src?: string | null; fallback?: string | null; class?: string; children?: JSX.Element }): JSX.Element {
  const src = () => props.src || props.fallback
  return (
    <div class={'relative overflow-hidden bg-[var(--surface2)] ' + (props.class ?? '')}>
      <Show when={src()} fallback={<div class="flex h-full w-full items-center justify-center text-[color:var(--muted2)]"><Icon name="IcMap" size={26} /></div>}>
        <img src={src()!} alt="" class="h-full w-full object-cover" classList={{ 'opacity-60 saturate-50': !props.src }} draggable={false} />
      </Show>
      {props.children}
    </div>
  )
}

function MetaDot(): JSX.Element {
  return <span class="text-[color:var(--faint,var(--muted2))]">·</span>
}

/** Base version behind the official record → the branch needs a rebase. */
function rebaseHint(b: Branch, official: Branch | undefined): string | null {
  if (!official || b.base !== official.id || !b.baseVer || b.baseVer === official.ver) return null
  return `Cần rebase: dựa trên ${b.baseVer}, chính thức đã ${official.ver}`
}

function OfficialHero(props: { b: Branch; fallbackThumb?: string | null; onClone: (b: Branch) => void }): JSX.Element {
  const green = () => tone('#1A7F37')
  return (
    <button
      onClick={() => props.onClone(props.b)}
      data-testid="official-record"
      class="group grid w-full grid-cols-1 overflow-hidden rounded-2xl border-2 bg-[var(--surface)] text-left transition-shadow hover:shadow-lg md:grid-cols-[minmax(280px,420px)_1fr]"
      style={{ 'border-color': chex('#1A7F37', 0.55), 'box-shadow': 'var(--card-shadow)' }}
    >
      <BranchThumb src={props.b.thumb} fallback={props.fallbackThumb} class="aspect-[16/9] md:aspect-auto md:min-h-[210px]">
        <span class="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow" style={{ background: '#1A7F37' }}>
          <Icon name="IcCheckBadge" size={13} /> Bản chính thức
        </span>
      </BranchThumb>
      <div class="flex min-w-0 flex-col gap-3 p-5" style={{ background: `linear-gradient(135deg, ${chex('#1A7F37', cTheme() === 'light' ? 0.07 : 0.14)}, transparent 60%)` }}>
        <div>
          <div class="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: green() }}>Nguồn sự thật · of-record</div>
          <div class="mt-0.5 flex flex-wrap items-baseline gap-2">
            <h2 class="text-[20px] font-semibold tracking-tight text-[color:var(--text)]">{props.b.name}</h2>
            <span class="font-mono text-[12px] text-[color:var(--muted)]">{props.b.id} · {props.b.ver}</span>
          </div>
          <Show when={props.b.note}><p class="mt-1 text-[12.5px] leading-relaxed text-[color:var(--muted)]">{props.b.note}</p></Show>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <For each={[
            { k: 'Phiên bản', v: props.b.ver },
            { k: 'Chiều dài ống', v: fmtDec(props.b.pipeKm, 1) + ' km' },
            { k: 'Tài sản', v: fmtInt(props.b.assets) },
            { k: 'Change set đã nhập', v: String(props.b.cards.length) },
          ]}>
            {(s) => (
              <div class="rounded-lg border border-line bg-[var(--surface)] px-3 py-2">
                <div class="font-mono text-[15px] font-semibold text-[color:var(--text)]">{s.v}</div>
                <div class="text-[10.5px] text-[color:var(--muted)]">{s.k}</div>
              </div>
            )}
          </For>
        </div>
        <div class="mt-auto flex flex-wrap items-center gap-3">
          <span class="text-[11.5px] text-[color:var(--muted)]">Cập nhật <b class="font-medium text-[color:var(--text2)]">{props.b.at}</b> · {props.b.by}</span>
          <span class="ml-auto flex items-center gap-1.5 text-[11px] text-[color:var(--muted)]"><Icon name="IcLockClosed" size={12} /> Chỉ xem</span>
          <span class="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white transition-transform group-hover:translate-x-0.5" style={{ background: '#1A7F37' }}>
            <Icon name="IcCopy" size={14} /> Nhân bản để sửa
          </span>
        </div>
      </div>
    </button>
  )
}

function BranchCard(props: { b: Branch; official?: Branch; fallbackThumb?: string | null; onOpen: (b: Branch) => void }): JSX.Element {
  const st = () => SC_STATE[props.b.state]!
  const lane = () => SC_LANES[props.b.lane]!
  const rebase = () => rebaseHint(props.b, props.official)
  return (
    <button
      onClick={() => props.onOpen(props.b)}
      class="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-[var(--surface)] text-left transition-all hover:-translate-y-0.5 hover:border-[color:var(--text2)]"
      style={{ 'box-shadow': 'var(--card-shadow)' }}
    >
      <BranchThumb src={props.b.thumb} fallback={props.fallbackThumb} class="aspect-[16/9] w-full">
        <span class="absolute left-2 top-2"><Badge color={tone(st().c)} dot>{st().l}</Badge></span>
        <span class="absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10.5px] text-white">{props.b.ver}</span>
        <Show when={!props.b.thumb}>
          <span class="absolute bottom-2 left-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] text-white">Chưa có ảnh — lưu nháp để tạo</span>
        </Show>
        <span class="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1.5 bg-[var(--focus,#0969DA)] py-1.5 text-[12px] font-semibold text-white transition-transform group-hover:translate-y-0">
          <Icon name="IcPencil" size={13} /> Mở sửa
        </span>
      </BranchThumb>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div class="flex items-start gap-2">
          <span class="mt-0.5 shrink-0" style={{ color: tone(lane().col) }}><Icon name="IcGitBranch" size={14} /></span>
          <span class="line-clamp-2 text-[13px] font-semibold leading-snug text-[color:var(--text)]">{props.b.name}</span>
        </div>
        <div class="flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] text-[color:var(--muted)]">
          <span class="text-[color:var(--text2)]">{props.b.id}</span>
          <MetaDot />
          <span>{fmtDec(props.b.pipeKm, 1)} km</span>
          <Show when={props.b.assets}><MetaDot /><span>{fmtInt(props.b.assets)} TS</span></Show>
          <Show when={props.b.base}><MetaDot /><span>từ {props.b.base}{props.b.baseVer ? ' ' + props.b.baseVer : ''}</span></Show>
        </div>
        <Show when={props.b.note}><div class="line-clamp-2 text-[11.5px] leading-snug text-[color:var(--muted)]">{props.b.note}</div></Show>
        <Show when={rebase()}>
          <div class="flex items-center gap-1 text-[11px] font-medium" style={{ color: tone('#9A6700') }}><Icon name="IcAlert" size={12} />{rebase()}</div>
        </Show>
        <div class="mt-auto flex items-center gap-2 border-t border-line pt-2 text-[11px] text-[color:var(--muted)]">
          <span class="truncate font-medium text-[color:var(--text2)]">{props.b.by}</span>
          <span class="ml-auto shrink-0">{props.b.at}</span>
        </div>
      </div>
    </button>
  )
}

function ArchiveRow(props: { b: Branch; fallbackThumb?: string | null; onClone: (b: Branch) => void }): JSX.Element {
  return (
    <button onClick={() => props.onClone(props.b)} class="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-2 text-left opacity-90 transition-colors hover:border-[color:var(--text2)] hover:opacity-100">
      <BranchThumb src={props.b.thumb} fallback={props.fallbackThumb} class="h-14 w-24 shrink-0 rounded-lg grayscale" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12.5px] font-semibold text-[color:var(--text)]">{props.b.name}</div>
        <div class="truncate font-mono text-[10.5px] text-[color:var(--muted)]">{props.b.id} · {props.b.ver} · {fmtDec(props.b.pipeKm, 1)} km · {props.b.at}</div>
      </div>
      <span class="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-[color:var(--text2)]"><Icon name="IcCopy" size={12} />Nhân bản</span>
    </button>
  )
}

function GateHeading(props: { icon: string; title: string; sub?: string; count?: number; right?: JSX.Element }): JSX.Element {
  return (
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span class="text-[color:var(--muted2)]"><Icon name={props.icon} size={15} /></span>
      <span class="text-[13px] font-semibold text-[color:var(--text)]">{props.title}</span>
      <Show when={props.count != null}><span class="rounded-full bg-[var(--surface2)] px-2 font-mono text-[11px] text-[color:var(--muted)]">{props.count}</span></Show>
      <Show when={props.sub}><span class="text-[11.5px] text-[color:var(--muted2)]">{props.sub}</span></Show>
      <div class="ml-auto flex items-center gap-2">{props.right}</div>
    </div>
  )
}

export function EdBranchGate(props: {
  branches: Branch[]
  onBlank: () => void
  onClone: (b: Branch) => void
  onOpen: (b: Branch) => void
  onExit: () => void
  /** Preview of the base network, used for branches that have no saved thumbnail yet. */
  fallbackThumb?: string | null
}): JSX.Element {
  const [q, setQ] = createSignal('')
  const [filter, setFilter] = createSignal<GateFilter>('all')
  const match = (b: Branch) => {
    const s = q().trim().toLowerCase()
    return !s || [b.name, b.id, b.by, b.note].some((v) => v && v.toLowerCase().includes(s))
  }
  const official = () => props.branches.filter((b) => b.state === 'official')
  const mainOfficial = () => official().find((b) => b.lane === 'current') ?? official()[0]
  const allWorking = () => props.branches.filter((b) => (b.state === 'draft' || b.state === 'review') && b.lane !== 'past')
  // under review first, then most recently saved / created first
  const working = createMemo(() =>
    allWorking()
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => match(b) && (filter() === 'all' || b.state === filter()))
      .sort((x, y) => (x.b.state === 'review' ? 0 : 1) - (y.b.state === 'review' ? 0 : 1) || (y.b.touched ?? 0) - (x.b.touched ?? 0) || y.i - x.i)
      .map(({ b }) => b)
  )
  const archived = () => props.branches.filter((b) => b.lane === 'past' || (b.state === 'archived' && b.lane !== 'current')).filter(match)
  const count = (st: GateFilter) => (st === 'all' ? allWorking().length : allWorking().filter((b) => b.state === st).length)

  return (
    <div class="flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]">
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-[var(--surface)] px-5 py-2.5">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: cAccent(), color: cTheme() === 'light' ? '#fff' : '#06231f' }}>
          <Icon name="IcPencil" size={16} />
        </span>
        <div class="min-w-0">
          <h1 class="text-[14px] font-semibold leading-tight text-[color:var(--text)]">Chọn bản làm việc</h1>
          <div class="text-[10.5px] leading-tight text-[color:var(--muted2)]">Biên tập mạng lưới · mọi thay đổi diễn ra trên một bản (nhánh)</div>
        </div>
        <label class="ml-auto flex h-8 w-full max-w-[320px] items-center gap-2 rounded-lg border border-line bg-[var(--bg)] px-2.5 text-[color:var(--muted)] sm:w-auto sm:min-w-[260px]">
          <Icon name="IcSearch" size={14} />
          <input value={q()} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Tìm theo tên, mã, người sửa…" aria-label="Tìm bản" class="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted2)]" />
        </label>
        <button onClick={props.onBlank} class="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold" style={{ background: cAccent(), color: cTheme() === 'light' ? '#fff' : '#06231f' }}>
          <Icon name="IcPlus" size={15} /> Bản trắng mới
        </button>
        <button onClick={props.onExit} class="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-medium text-[color:var(--text2)] transition-colors hover:border-[color:var(--text2)]">
          <Icon name="IcMap" size={14} />
          <span class="hidden sm:inline">Cổng GIS</span>
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-6">
          <Show when={mainOfficial()}>
            {(b) => (
              <section>
                <GateHeading icon="IcCheckBadge" title="Bản chính thức" sub="Nhân bản để chỉnh sửa an toàn — bản này chỉ xem" />
                <OfficialHero b={b()} fallbackThumb={props.fallbackThumb} onClone={props.onClone} />
              </section>
            )}
          </Show>

          <section>
            <GateHeading
              icon="IcGitBranch"
              title="Đang biên tập"
              count={allWorking().length}
              right={
                <div class="flex rounded-lg border border-line bg-[var(--surface)] p-0.5" role="tablist" aria-label="Lọc theo trạng thái">
                  <For each={[['all', 'Tất cả'], ['review', 'Chờ duyệt'], ['draft', 'Nháp']] as [GateFilter, string][]}>
                    {([id, label]) => (
                      <button role="tab" aria-selected={filter() === id} onClick={() => setFilter(id)} class="rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors" classList={{ 'bg-[var(--surface2)] text-[color:var(--text)]': filter() === id, 'text-[color:var(--muted)]': filter() !== id }}>
                        {label} <span class="font-mono text-[10px] text-[color:var(--muted2)]">{count(id)}</span>
                      </button>
                    )}
                  </For>
                </div>
              }
            />
            <div class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              <button onClick={props.onBlank} class="group flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-center transition-colors hover:border-[color:var(--focus)]">
                <span class="flex h-11 w-11 items-center justify-center rounded-xl transition-transform group-hover:scale-105" style={{ background: chex(cAccent(), cTheme() === 'light' ? 0.14 : 0.24), color: tone(cAccent()) }}>
                  <Icon name="IcPlus" size={22} />
                </span>
                <span class="text-[13px] font-semibold text-[color:var(--text)]">Tạo bản trắng</span>
                <span class="px-6 text-[11.5px] text-[color:var(--muted)]">Nhánh nháp mới, vẽ từ đầu</span>
              </button>
              <For each={working()}>{(b) => <BranchCard b={b} official={mainOfficial()} fallbackThumb={props.fallbackThumb} onOpen={props.onOpen} />}</For>
            </div>
            <Show when={!working().length && (q() || filter() !== 'all')}>
              <div class="mt-3 text-[12px] text-[color:var(--muted)]">Không có bản nào khớp bộ lọc.</div>
            </Show>
          </section>

          <Show when={archived().length}>
            <section>
              <GateHeading icon="IcDatabase" title="Lưu trữ" sub="snapshot bất biến · chỉ xem" count={archived().length} />
              <div class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
                <For each={archived()}>{(b) => <ArchiveRow b={b} fallbackThumb={props.fallbackThumb} onClone={props.onClone} />}</For>
              </div>
            </section>
          </Show>
        </div>
      </div>
    </div>
  )
}

/* ── collapsed rail ── */
export function EdCollapsedRail(props: { side: 'left' | 'right'; label: string; icon: string; onExpand: () => void }): JSX.Element {
  const chev = () => (props.side === 'left' ? 'IcChevRight' : 'IcChevL')
  return (
    <div class={'flex w-9 shrink-0 flex-col items-center gap-2 bg-[var(--surface)] py-2 ' + (props.side === 'left' ? 'border-r' : 'border-l') + ' border-line'}>
      <button onClick={props.onExpand} title={'Mở bảng ' + props.label} class="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--muted)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
        <Icon name={chev()} size={16} />
      </button>
      <div class="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: chex(cAccent(), cTheme() === 'light' ? 0.12 : 0.22), color: tone(cAccent()) }}>
        <Icon name={props.icon} size={14} />
      </div>
      <button onClick={props.onExpand} class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)] transition-colors hover:text-[color:var(--text2)]" style={{ 'writing-mode': 'vertical-rl' }}>
        {props.label}
      </button>
    </div>
  )
}

/* ── command line ── */
export function EdCommandLine(props: { log: LogEntry[]; hint: string; onCommand: (raw: string) => void }): JSX.Element {
  const [v, setV] = createSignal('')
  const [open, setOpen] = createSignal(false)
  let endRef: HTMLDivElement | undefined
  createEffect(() => {
    void props.log.length
    if (open() && endRef) endRef.scrollTop = endRef.scrollHeight
  })
  const submit = (e: Event) => {
    e.preventDefault()
    if (!v().trim()) return
    props.onCommand(v().trim())
    setV('')
  }
  const last = () => (props.log.length ? props.log[props.log.length - 1]! : null)
  const lastCol = () => {
    const l = last()
    return l ? (l.k === 'err' ? tone('#D1242F') : l.k === 'ok' ? tone('#1A7F37') : l.k === 'cmd' ? 'var(--text2)' : 'var(--muted)') : 'var(--muted2)'
  }
  return (
    <div class="relative shrink-0">
      <Show when={open()}>
        <div class="absolute bottom-full left-0 right-0 z-20 flex flex-col border-t border-line bg-[var(--bg2)]" style={{ height: '176px', 'box-shadow': '0 -8px 24px -10px rgba(0,0,0,0.35)' }}>
          <div class="flex items-center justify-between border-b border-line px-3 py-1">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Lịch sử lệnh</span>
            <button onClick={() => setOpen(false)} class="text-[color:var(--muted2)] hover:text-[color:var(--text)]"><Icon name="IcChevD" size={14} /></button>
          </div>
          <div ref={endRef} class="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed">
            <Show when={props.log.length} fallback={<div class="text-[color:var(--muted2)]">Gõ lệnh: PL (ống) · VA (van) · SP (tách) · OF (offset) · MG (gộp) · MA (sao chép) · U (hoàn tác) · COGO · ZE (toàn mạng)…</div>}>
              <For each={props.log}>
                {(l) => <div style={{ color: l.k === 'err' ? tone('#D1242F') : l.k === 'ok' ? tone('#1A7F37') : l.k === 'cmd' ? 'var(--text)' : 'var(--muted)' }}>{l.k === 'cmd' ? '› ' : ''}{l.t}</div>}
              </For>
            </Show>
          </div>
        </div>
      </Show>
      <form onSubmit={submit} class="flex h-8 items-center gap-2 border-t border-line bg-[var(--bg2)] px-3">
        <span class="font-mono text-[12px] font-semibold" style={{ color: tone(cAccent()) }}>›</span>
        <input value={v()} onInput={(e) => setV(e.currentTarget.value)} placeholder={props.hint || 'Nhập lệnh hoặc toạ độ…'} class="h-6 w-[200px] shrink-0 bg-transparent font-mono text-[12px] text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted2)]" />
        <Show when={!v() && last()} fallback={<span class="flex-1" />}>
          <span class="min-w-0 flex-1 truncate font-mono text-[11px]" style={{ color: lastCol() }}>{last()!.k === 'cmd' ? '› ' : ''}{last()!.t}</span>
        </Show>
        <button type="button" onClick={() => setOpen((o) => !o)} title="Lịch sử lệnh" class="flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-[color:var(--muted2)] transition-colors hover:text-[color:var(--text)]">
          <Icon name={open() ? 'IcChevD' : 'IcChevU'} size={13} />
          <span class="font-mono">{props.log.length}</span>
        </button>
      </form>
    </div>
  )
}

/* ── status bar ── */
function StatusToggle(props: { on: boolean; label: string; onClick: () => void }): JSX.Element {
  return (
    <button onClick={props.onClick} class="rounded px-2 py-0.5 text-[10.5px] font-semibold tracking-wide transition-colors" style={{ background: props.on ? chex(cAccent(), cTheme() === 'light' ? 0.16 : 0.28) : 'transparent', color: props.on ? tone(cAccent()) : 'var(--muted2)' }}>
      {props.label}
    </button>
  )
}

export function EdStatusBar(props: {
  coord: [number, number] | null
  snap: boolean
  setSnap: (v: boolean) => void
  ortho: boolean
  setOrtho: (v: boolean) => void
  grid: boolean
  setGrid: (v: boolean) => void
  snapModes: SnapModes
  setSnapModes: (v: SnapModes) => void
  counts: { add: number; mod: number; del: number }
  srid: string
}): JSX.Element {
  const osnapOn = () => Object.values(props.snapModes).some(Boolean)
  return (
    <div class="flex shrink-0 items-center gap-1 border-t border-line bg-[var(--surface)] px-3 py-1 text-[10.5px] text-[color:var(--muted)]">
      <span class="font-mono tabular-nums" style={{ 'min-width': '132px' }}>X {props.coord ? props.coord[0] : '—'} · Y {props.coord ? props.coord[1] : '—'}</span>
      <span class="h-3.5 w-px bg-[var(--line)]" />
      <StatusToggle on={props.snap} label="SNAP" onClick={() => props.setSnap(!props.snap)} />
      <StatusToggle on={props.grid} label="GRID" onClick={() => props.setGrid(!props.grid)} />
      <StatusToggle on={props.ortho} label="ORTHO" onClick={() => props.setOrtho(!props.ortho)} />
      <StatusToggle on={osnapOn()} label="OSNAP" onClick={() => props.setSnapModes(osnapOn() ? { node: false, vertex: false, edge: false, grid: false } : { node: true, vertex: true, edge: true, grid: false })} />
      <div class="ml-auto flex items-center gap-3 font-mono">
        <span style={{ color: tone('#1A7F37') }}>+{props.counts.add}</span>
        <span style={{ color: tone('#9A6700') }}>~{props.counts.mod}</span>
        <span style={{ color: tone('#D1242F') }}>−{props.counts.del}</span>
        <span class="h-3.5 w-px bg-[var(--line)]" />
        <span>{props.srid}</span>
        <span class="h-3.5 w-px bg-[var(--line)]" />
        <span>mét · 1:1,15</span>
      </div>
    </div>
  )
}

/* ── COGO modal ── */
export function EdCogoModal(props: { open: boolean; onClose: () => void; onCreate: (pts: Pt[]) => void }): JSX.Element {
  const [sx, setSx] = createSignal('400')
  const [sy, setSy] = createSignal('300')
  const [segs, setSegs] = createSignal<{ bearing: string; dist: string }[]>([{ bearing: '90', dist: '50' }])
  createEffect(() => {
    if (props.open) {
      setSx('400')
      setSy('300')
      setSegs([{ bearing: '90', dist: '50' }])
    }
  })
  const pts = createMemo<Pt[]>(() => {
    let x = +sx() || 0,
      y = +sy() || 0
    const out: Pt[] = [[Math.round(x), Math.round(y)]]
    segs().forEach((s) => {
      const b = ((+s.bearing || 0) * Math.PI) / 180,
        d = (+s.dist || 0) / ED_U2M
      x += Math.sin(b) * d
      y -= Math.cos(b) * d
      out.push([Math.round(x), Math.round(y)])
    })
    return out
  })
  const totalM = () => Math.round(edPolyLen(pts()) * ED_U2M)
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Nhập toạ độ / COGO"
      subtitle="Dựng tuyến ống chính xác bằng toạ độ gốc + chuỗi phương vị · khoảng cách"
      icon="IcCompass"
      wide
      footer={
        <>
          <Btn variant="ghost" onClick={props.onClose}>Huỷ</Btn>
          <Btn variant="primary" icon="IcCheck" disabled={pts().length < 2} onClick={() => { props.onCreate(pts()); props.onClose() }}>Tạo tuyến ({fmtKm(totalM())})</Btn>
        </>
      }
    >
      <div class="grid grid-cols-2 gap-3">
        <Field label="Toạ độ gốc X"><TextInput value={sx()} onChange={setSx} mono /></Field>
        <Field label="Toạ độ gốc Y"><TextInput value={sy()} onChange={setSy} mono /></Field>
      </div>
      <div class="mb-1.5 mt-3 flex items-center justify-between">
        <span class="text-[12px] font-medium text-[color:var(--text2)]">Các đoạn (phương vị° · khoảng cách m)</span>
        <button onClick={() => setSegs([...segs(), { bearing: '0', dist: '20' }])} class="flex items-center gap-1 text-[11.5px] font-medium" style={{ color: tone(cAccent()) }}>
          <Icon name="IcPlus" size={13} />Thêm đoạn
        </button>
      </div>
      <div class="flex flex-col gap-1.5">
        <For each={segs()}>
          {(s, i) => (
            <div class="flex items-center gap-2">
              <span class="w-5 text-center font-mono text-[11px] text-[color:var(--muted2)]">{i() + 1}</span>
              <div class="relative flex-1">
                <TextInput value={s.bearing} onChange={(val) => setSegs(segs().map((x, j) => (j === i() ? { ...x, bearing: val.replace(/[^\d.]/g, '') } : x)))} mono />
                <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[color:var(--muted2)]">°</span>
              </div>
              <div class="relative flex-1">
                <TextInput value={s.dist} onChange={(val) => setSegs(segs().map((x, j) => (j === i() ? { ...x, dist: val.replace(/[^\d.]/g, '') } : x)))} mono />
                <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[color:var(--muted2)]">m</span>
              </div>
              <button onClick={() => setSegs(segs().filter((_, j) => j !== i()))} disabled={segs().length === 1} class="flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)] disabled:opacity-30">
                <Icon name="IcX" size={14} />
              </button>
            </div>
          )}
        </For>
      </div>
      <div class="mt-3 rounded-lg bg-[var(--surface2)] px-3 py-2 font-mono text-[11px] text-[color:var(--muted)]">{pts().length} đỉnh · tổng {fmtKm(totalM())} · điểm cuối ({pts()[pts().length - 1]![0]}, {pts()[pts().length - 1]![1]})</div>
    </Modal>
  )
}
