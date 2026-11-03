/* GIS — Biên tập mạng lưới: CAD chrome (SolidJS port of editor-cad.jsx UI parts).
   Branch gate, ribbon, left palette, command line, status bar, COGO modal + collapsed rails. */
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import {
  ED_TEMPLATES,
  ED_TOOLS,
  ED_TOOL_GRP,
  ED_U2M,
  KIND_META,
  type EdTemplate,
  type EdTool,
  type Pt,
  edPolyLen,
} from './model'
import { SC_LANES, SC_STATE, type Branch } from '../lib/branch-store'
import { Icon } from '../lib/icons'
import { cAccent, cTheme, chex, fmtDec, fmtInt, fmtKm, rad, tone } from '../lib/theme'
import { Badge, Btn, Field, Modal, TextInput } from '../ui/kit'
import type { SnapModes } from './canvas'

export interface LogEntry {
  t: string
  k: 'info' | 'ok' | 'err' | 'cmd'
}

/* ── Branch gate ── */
function EdGateStat(props: { value: number; label: string; col?: string }): JSX.Element {
  return (
    <div class="flex flex-col">
      <span class="font-mono text-[20px] font-semibold leading-none" style={{ color: props.col ? tone(props.col) : 'var(--text)' }}>
        {props.value}
      </span>
      <span class="mt-1 text-[10.5px] leading-tight text-[color:var(--muted)]">{props.label}</span>
    </div>
  )
}

function EdBranchCard(props: { b: Branch; onClone: (b: Branch) => void; onOpen: (b: Branch) => void }): JSX.Element {
  const lane = () => SC_LANES[props.b.lane]!
  const st = () => SC_STATE[props.b.state]!
  const editable = () => props.b.state === 'draft' || props.b.state === 'review'
  const act = () => (editable() ? props.onOpen(props.b) : props.onClone(props.b))
  return (
    <button onClick={act} class="group flex items-stretch overflow-hidden rounded-xl border border-line bg-[var(--surface)] text-left transition-all hover:-translate-y-px hover:border-[color:var(--text2)]" style={{ 'border-radius': `${rad() + 3}px`, 'box-shadow': 'var(--card-shadow)' }}>
      <span class="w-1.5 shrink-0" style={{ background: tone(lane().col) }} />
      <div class="flex min-w-0 flex-1 items-center gap-3 p-3.5">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: chex(lane().col, cTheme() === 'light' ? 0.14 : 0.24), color: tone(lane().col), 'border-radius': `${rad() + 3}px` }}>
          <Icon name="IcGitBranch" size={18} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="truncate text-[13.5px] font-semibold text-[color:var(--text)]">{props.b.name}</span>
            <Badge color={tone(st().c)} soft dot>{st().l}</Badge>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-[color:var(--muted)]">
            <span class="text-[color:var(--text2)]">{props.b.id}</span>
            <span class="text-[color:var(--faint)]">·</span>
            <span>{props.b.ver}</span>
            <span class="text-[color:var(--faint)]">·</span>
            <span>{fmtDec(props.b.pipeKm, 1)} km</span>
            <Show when={props.b.assets}>
              <span class="text-[color:var(--faint)]">·</span>
              <span>{fmtInt(props.b.assets)} tài sản</span>
            </Show>
            <Show when={props.b.base}>
              <span class="text-[color:var(--faint)]">·</span>
              <span class="inline-flex items-center gap-1">từ {props.b.base}{props.b.baseVer ? ' ' + props.b.baseVer : ''}</span>
            </Show>
          </div>
          <Show when={props.b.note}>
            <div class="mt-1.5 truncate text-[11.5px] text-[color:var(--muted)]">{props.b.note}</div>
          </Show>
        </div>
        <div class="hidden shrink-0 flex-col items-end gap-0.5 pr-1 text-right sm:flex">
          <span class="text-[11px] font-medium text-[color:var(--text2)]">{props.b.by}</span>
          <span class="text-[10.5px] text-[color:var(--muted2)]">{props.b.at}</span>
        </div>
        <span
          class="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
          style={editable() ? { background: cAccent(), color: cTheme() === 'light' ? '#fff' : '#06231f', 'border-radius': `${rad()}px` } : { border: '1px solid var(--line)', color: 'var(--text2)', 'border-radius': `${rad()}px` }}
        >
          <Icon name={editable() ? 'IcPencil' : 'IcCopy'} size={14} />
          {editable() ? 'Mở sửa' : 'Nhân bản'}
        </span>
      </div>
    </button>
  )
}

function EdGateSection(props: { icon: string; title: string; sub?: string; count?: number; children?: JSX.Element }): JSX.Element {
  return (
    <div>
      <div class="mb-2 flex items-center gap-2">
        <span class="text-[color:var(--muted2)]"><Icon name={props.icon} size={14} /></span>
        <span class="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text2)]">{props.title}</span>
        <Show when={props.count != null}>
          <span class="font-mono text-[10.5px] text-[color:var(--muted2)]">{props.count}</span>
        </Show>
        <Show when={props.sub}>
          <span class="text-[10.5px] text-[color:var(--muted2)]">· {props.sub}</span>
        </Show>
      </div>
      <div class="flex flex-col gap-2">{props.children}</div>
    </div>
  )
}

export function EdBranchGate(props: {
  branches: Branch[]
  onBlank: () => void
  onClone: (b: Branch) => void
  onOpen: (b: Branch) => void
  onExit: () => void
}): JSX.Element {
  const official = () => props.branches.filter((b) => b.state === 'official')
  const working = () => props.branches.filter((b) => (b.state === 'draft' || b.state === 'review') && b.lane !== 'past')
  const archived = () => props.branches.filter((b) => b.lane === 'past')

  return (
    <div class="flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]">
      <div class="flex shrink-0 items-center gap-2.5 border-b border-line bg-[var(--surface)] px-5 py-3">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: cAccent(), color: cTheme() === 'light' ? '#fff' : '#06231f' }}>
          <Icon name="IcPencil" size={16} />
        </span>
        <div class="min-w-0">
          <div class="text-[13px] font-semibold leading-tight text-[color:var(--text)]">Biên tập mạng lưới</div>
          <div class="text-[10px] leading-tight text-[color:var(--muted2)]">Network Editor · Water Platform</div>
        </div>
        <button onClick={props.onExit} class="ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-medium text-[color:var(--text2)] transition-colors hover:border-[color:var(--text2)]" style={{ 'border-radius': `${rad()}px` }}>
          <Icon name="IcMap" size={14} />
          <span class="hidden sm:inline">Cổng GIS</span>
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto grid max-w-[1080px] grid-cols-1 gap-6 px-5 py-7 md:grid-cols-[300px_1fr]">
          <div class="flex flex-col gap-4 md:sticky md:top-0 md:self-start">
            <div>
              <div class="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--muted)]"><Icon name="IcPencil" size={13} />Phiên biên tập</div>
              <h1 class="mt-1 text-[21px] font-semibold tracking-tight text-[color:var(--text)]">Chọn bản làm việc</h1>
              <p class="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--muted)]">Mọi thay đổi diễn ra trên một bản (nhánh). Tạo bản trắng hoặc nhân bản / mở một bản hiện có.</p>
            </div>

            <button onClick={props.onBlank} class="group flex items-center gap-3 rounded-xl border-2 border-dashed border-line p-3.5 text-left transition-colors hover:border-[color:var(--focus)]" style={{ 'border-radius': `${rad() + 3}px` }}>
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105" style={{ background: chex(cAccent(), cTheme() === 'light' ? 0.14 : 0.24), color: tone(cAccent()) }}>
                <Icon name="IcPlus" size={20} />
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-[13.5px] font-semibold text-[color:var(--text)]">Tạo bản trắng</div>
                <div class="text-[11.5px] leading-snug text-[color:var(--muted)]">Nhánh nháp mới, vẽ từ đầu.</div>
              </div>
            </button>

            <div class="rounded-xl border border-line bg-[var(--surface)] p-4" style={{ 'border-radius': `${rad() + 3}px`, 'box-shadow': 'var(--card-shadow)' }}>
              <div class="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Tổng quan nhánh</div>
              <div class="grid grid-cols-2 gap-y-4">
                <EdGateStat value={props.branches.length} label="Tổng số bản" />
                <EdGateStat value={working().length} label="Đang sửa được" col="#0969DA" />
                <EdGateStat value={official().length} label="Bản chính thức" col="#1A7F37" />
                <EdGateStat value={archived().length} label="Lưu trữ" col="#8B949E" />
              </div>
            </div>

            <div class="flex items-start gap-2 rounded-lg bg-[var(--surface2)] px-3 py-2.5 text-[11px] leading-relaxed text-[color:var(--muted)]">
              <Icon name="IcInfo" size={14} class="mt-px shrink-0" />
              <span>Bản <b class="text-[color:var(--text2)]">chính thức</b> & <b class="text-[color:var(--text2)]">lưu trữ</b> chỉ xem — nhân bản để chỉnh sửa an toàn.</span>
            </div>
          </div>

          <div class="flex min-w-0 flex-col gap-6">
            <Show when={working().length}>
              <EdGateSection icon="IcGitBranch" title="Đang biên tập" sub="nháp & chờ duyệt" count={working().length}>
                <For each={working()}>{(b) => <EdBranchCard b={b} onClone={props.onClone} onOpen={props.onOpen} />}</For>
              </EdGateSection>
            </Show>
            <Show when={official().length}>
              <EdGateSection icon="IcCheckBadge" title="Bản chính thức" sub="of-record" count={official().length}>
                <For each={official()}>{(b) => <EdBranchCard b={b} onClone={props.onClone} onOpen={props.onOpen} />}</For>
              </EdGateSection>
            </Show>
            <Show when={archived().length}>
              <EdGateSection icon="IcDatabase" title="Lưu trữ" sub="snapshot bất biến" count={archived().length}>
                <For each={archived()}>{(b) => <EdBranchCard b={b} onClone={props.onClone} onOpen={props.onOpen} />}</For>
              </EdGateSection>
            </Show>
          </div>
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

/* ── ribbon ── */
function RibbonTool(props: { t: EdTool; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button onClick={props.onClick} title={props.t.label + ' (' + props.t.cmd + ')'} class="flex h-[44px] w-[46px] flex-col items-center justify-center gap-1 rounded-lg transition-colors" style={{ background: props.on ? chex(cAccent(), cTheme() === 'light' ? 0.14 : 0.26) : 'transparent', color: props.on ? tone(cAccent()) : 'var(--muted)' }}>
      <Icon name={props.t.icon} size={18} />
      <span class="text-[9px] font-medium leading-none" style={{ color: props.on ? tone(cAccent()) : 'var(--muted2)' }}>{props.t.cmd}</span>
    </button>
  )
}

export function EdRibbon(props: {
  tool: string
  setTool: (t: string) => void
  branch: Branch | null
  locked: boolean
  onClone: () => void
  onImport: () => void
  onExit: () => void
  onChangeBranch: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}): JSX.Element {
  const grpd = () => ED_TOOL_GRP.map(([g, lbl]) => ({ g, lbl, items: ED_TOOLS.filter((t) => t.grp === g) }))
  const lane = () => (props.branch ? SC_LANES[props.branch.lane]! : null)
  return (
    <div class="flex shrink-0 items-stretch gap-2 border-b border-line bg-[var(--surface)] px-2.5 py-1.5">
      <div class="flex items-center gap-2 pr-1">
        <button onClick={props.onExit} title="Về cổng GIS" class="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[color:var(--muted)] transition-colors hover:text-[color:var(--text)]" style={{ 'border-radius': `${rad()}px` }}>
          <Icon name="IcChevL" size={16} />
        </button>
        <Show when={props.branch}>
          <button onClick={props.onChangeBranch} class="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 transition-colors hover:border-[color:var(--text2)]" style={{ 'border-radius': `${rad()}px` }} title="Đổi bản làm việc">
            <span class="flex h-5 w-5 items-center justify-center rounded-md" style={{ background: chex(lane()!.col, 0.18), color: tone(lane()!.col) }}>
              <Icon name="IcGitBranch" size={12} />
            </span>
            <span class="max-w-[124px] truncate text-[12px] font-medium text-[color:var(--text)]">{props.branch!.name}</span>
            <span class="font-mono text-[10px] text-[color:var(--muted)]">{props.branch!.ver}</span>
            <Show when={props.locked}>
              <Badge color={tone('#9A6700')} soft><Icon name="IcLockClosed" size={10} class="mr-0.5" />Khoá</Badge>
            </Show>
            <Icon name="IcChevD" size={13} class="text-[color:var(--muted2)]" />
          </button>
        </Show>
      </div>

      <div class="flex items-stretch gap-0 overflow-x-auto">
        <For each={grpd()}>
          {(grp) => (
            <div class="flex flex-col items-center border-l border-line px-2 pt-0.5 first:border-l-0">
              <div class="flex gap-0.5">
                <For each={grp.items}>{(t) => <RibbonTool t={t} on={props.tool === t.id} onClick={() => props.setTool(t.id)} />}</For>
              </div>
              <span class="mt-0.5 text-[8.5px] font-medium uppercase tracking-wider text-[color:var(--muted2)]">{grp.lbl}</span>
            </div>
          )}
        </For>
      </div>

      <div class="ml-auto flex items-center gap-1.5">
        <button onClick={props.onUndo} disabled={!props.canUndo} title="Hoàn tác (Ctrl+Z)" class="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[color:var(--muted)] transition-colors hover:text-[color:var(--text)] disabled:opacity-30" style={{ 'border-radius': `${rad()}px` }}>
          <Icon name="IcUndo" size={15} />
        </button>
        <button onClick={props.onRedo} disabled={!props.canRedo} title="Làm lại (Ctrl+Y)" class="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[color:var(--muted)] transition-colors hover:text-[color:var(--text)] disabled:opacity-30" style={{ 'border-radius': `${rad()}px` }}>
          <Icon name="IcRedo" size={15} />
        </button>
        <Show when={props.locked} fallback={<Btn size="sm" icon="IcUpload" onClick={props.onImport}>Import</Btn>}>
          <Btn size="sm" variant="primary" icon="IcCopy" onClick={props.onClone}>Nhân bản để sửa</Btn>
        </Show>
      </div>
    </div>
  )
}

/* ── left palette ── */
function PalSection(props: { label: string; children?: JSX.Element }): JSX.Element {
  return (
    <div class="border-b border-line px-3 py-2.5">
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{props.label}</div>
      {props.children}
    </div>
  )
}

export function EdPalette(props: {
  activeTmpl: string | null
  onTemplate: (t: EdTemplate) => void
  refLayers: Record<string, boolean>
  setRefLayers: (v: Record<string, boolean>) => void
  snapModes: SnapModes
  setSnapModes: (v: SnapModes) => void
  offsetDist: number
  setOffsetDist: (v: number) => void
  onCollapse: () => void
}): JSX.Element {
  const SNAPS: [keyof SnapModes, string][] = [
    ['node', 'Nút'],
    ['vertex', 'Đỉnh'],
    ['edge', 'Tim ống'],
    ['grid', 'Lưới'],
  ]
  const LAYERS: [string, string][] = [
    ['pipe', 'Ống hiện trạng'],
    ['valve', 'Van'],
    ['node', 'Nút'],
    ['dma', 'Ranh DMA'],
    ['block', 'Nền khối nhà'],
  ]
  return (
    <div class="flex w-[230px] shrink-0 flex-col overflow-y-auto border-r border-line bg-[var(--surface)]">
      <div class="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Công cụ vẽ</span>
        <button onClick={props.onCollapse} title="Thu gọn bảng" class="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted2)] transition-colors hover:bg-[var(--surface2)] hover:text-[color:var(--text)]">
          <Icon name="IcChevL" size={15} />
        </button>
      </div>
      <PalSection label="Mẫu nhanh (preset)">
        <div class="flex flex-col gap-1">
          <For each={ED_TEMPLATES}>
            {(t) => {
              const meta = KIND_META[t.kind]
              const on = () => props.activeTmpl === t.id
              return (
                <button onClick={() => props.onTemplate(t)} class="flex items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors" style={{ 'border-color': on() ? cAccent() : 'var(--line)', background: on() ? chex(cAccent(), cTheme() === 'light' ? 0.1 : 0.2) : 'transparent', 'border-radius': `${rad() - 1}px` }}>
                  <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: chex(meta.col, 0.14), color: tone(meta.col) }}>
                    <Icon name={meta.icon} size={14} />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[11.5px] font-medium text-[color:var(--text)]">{t.label}</div>
                    <div class="truncate text-[9.5px] text-[color:var(--muted)]">{t.sub}</div>
                  </div>
                </button>
              )
            }}
          </For>
        </div>
      </PalSection>
      <PalSection label="Bắt điểm (OSNAP)">
        <div class="grid grid-cols-2 gap-1.5">
          <For each={SNAPS}>
            {([k, lbl]) => {
              const on = () => props.snapModes[k]
              return (
                <button onClick={() => props.setSnapModes({ ...props.snapModes, [k]: !on() })} class="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors" style={{ 'border-color': on() ? cAccent() : 'var(--line)', color: on() ? tone(cAccent()) : 'var(--muted)', background: on() ? chex(cAccent(), 0.1) : 'transparent', 'border-radius': `${rad() - 2}px` }}>
                  <span class="h-2.5 w-2.5 rounded-sm" style={{ background: on() ? cAccent() : 'var(--surface-active)' }} />
                  {lbl}
                </button>
              )
            }}
          </For>
        </div>
      </PalSection>
      <PalSection label="Khoảng cách offset">
        <div class="flex items-center gap-2">
          <input
            type="number"
            value={props.offsetDist}
            min="0.5"
            step="0.5"
            onInput={(e) => props.setOffsetDist(Math.max(0.5, +e.currentTarget.value || 0.5))}
            class="h-8 w-full rounded-lg border border-line bg-[var(--surface)] px-2.5 font-mono text-[12px] text-[color:var(--text)] outline-none"
            style={{ 'border-radius': `${rad()}px` }}
          />
          <span class="text-[11px] text-[color:var(--muted)]">m</span>
        </div>
      </PalSection>
      <PalSection label="Lớp tham chiếu">
        <div class="flex flex-col gap-0.5">
          <For each={LAYERS}>
            {([k, lbl]) => {
              const on = () => props.refLayers[k] !== false
              return (
                <button onClick={() => props.setRefLayers({ ...props.refLayers, [k]: !on() })} class="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] transition-colors hover:bg-[var(--surface2)]" style={{ color: on() ? 'var(--text2)' : 'var(--muted2)' }}>
                  <span style={{ color: on() ? tone(cAccent()) : 'var(--muted2)' }}>
                    <Icon name={on() ? 'IcEye' : 'IcEyeOff'} size={14} />
                  </span>
                  {lbl}
                </button>
              )
            }}
          </For>
        </div>
      </PalSection>
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
