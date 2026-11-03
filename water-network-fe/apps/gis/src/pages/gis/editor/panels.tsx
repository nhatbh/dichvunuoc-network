/* GIS — Biên tập mạng lưới: right-side panels (SolidJS port of editor-screen.jsx panels).
   PropBody (single selection) · BatchBody (multi-select) · ChangeSetPane (drafts + rules)
   · EamModal (asset-record picker) · ImportToEditorModal. */
import { For, Show, createSignal, type JSX } from 'solid-js'
import {
  ED_DN,
  ED_RULE_DEFS,
  ED_U2M,
  EAM_REG,
  KIND_META,
  type BaseRef,
  type CanvasSel,
  type Draft,
  type DraftKind,
  type EamRec,
  type RuleIssue,
  edPolyLen,
} from './model'
import { useGis } from '../lib/gis-data'
import { Icon } from '../lib/icons'
import { cAccent, cnorm, cTheme, chex, fmtInt, fmtKm, tone } from '../lib/theme'
import { Badge, Btn, DmaChip, Empty, Field, KV, Modal, Select, Switch, TextInput, Tile } from '../ui/kit'

const OP_LABEL: Record<string, [string, string]> = { add: ['Mới', '#1A7F37'], mod: ['Sửa', '#9A6700'], del: ['Xoá', '#D1242F'] }

/* ── EAM picker ── */
export function EamModal(props: { open: boolean; kind: DraftKind | null; onClose: () => void; onPick: (e: EamRec) => void }): JSX.Element {
  const [q, setQ] = createSignal('')
  const list = () => EAM_REG.filter((e) => (!props.kind || e.kind === props.kind) && (!q().trim() || cnorm(e.code + e.name + e.serial).includes(cnorm(q()))))
  return (
    <Modal open={props.open} onClose={props.onClose} title="Gắn lý lịch tài sản (EAM)" subtitle="Liên kết geometry với bản ghi tài sản trong EAM — đồng bộ mã tài sản & serial" icon="IcLink" wide>
      <div class="mb-3"><TextInput value={q()} onChange={setQ} placeholder="Tìm theo mã / tên / serial…" icon="IcSearch" /></div>
      <div class="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto">
        <Show when={list().length} fallback={<Empty icon="IcLink" title="Không có bản ghi phù hợp" hint="Thử bỏ bộ lọc loại tài sản hoặc nhập từ khoá khác." />}>
          <For each={list()}>
            {(e) => {
              const meta = KIND_META[e.kind]
              return (
                <button onClick={() => { props.onPick(e); props.onClose() }} class="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]">
                  <Tile icon={meta ? meta.icon : 'IcCube'} col={meta ? meta.col : '#0E7C86'} size={36} />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[12.5px] font-medium text-[color:var(--text)]">{e.name}</div>
                    <div class="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-[color:var(--muted)]"><span>{e.code}</span><span class="text-[color:var(--faint)]">·</span><span>{e.serial}</span></div>
                  </div>
                  <div class="shrink-0 text-right text-[10.5px] text-[color:var(--muted2)]"><div>{e.maker}</div><div class="font-mono">{e.year}</div></div>
                </button>
              )
            }}
          </For>
        </Show>
      </div>
    </Modal>
  )
}

/* ── Properties (single selection) ── */
export function PropBody(props: {
  sel: CanvasSel
  drafts: Draft[]
  onUpdate: (id: string, patch: Partial<Draft>) => void
  onRemove: (id: string) => void
  onAttach: (id: string, kind: DraftKind) => void
  onBaseAction: (action: 'mod' | 'del', b: BaseRef) => void
}): JSX.Element {
  const G = useGis()
  const sel = () => props.sel

  const baseView = (b: BaseRef) => {
    const meta = KIND_META[b.type] || KIND_META.pipe
    const delDraft = () => props.drafts.find((f) => f.op === 'del' && f.baseId === b.id)
    const modDraft = () => props.drafts.find((f) => f.op === 'mod' && f.baseId === b.id)
    return (
      <div class="px-4 py-3.5">
        <div class="mb-2 flex items-center gap-2"><Tile icon={meta.icon} col={meta.col} size={30} /><div><div class="text-[12.5px] font-semibold text-[color:var(--text)]">{b.id}</div><div class="font-mono text-[10.5px] text-[color:var(--muted)]">{meta.label} · đối tượng gốc</div></div></div>
        <div class="rounded-lg border border-line bg-[var(--surface2)] px-3 py-2.5 text-[11px] text-[color:var(--muted)]"><Icon name="IcLockClosed" size={12} class="mr-1 inline" />Sửa đối tượng gốc tạo bản ghi thay đổi trong change set — không ghi đè cho tới khi được duyệt.</div>
        <div class="mt-3 flex flex-col gap-2">
          <Show when={b.type === 'pipe' && !modDraft() && !delDraft()}>
            <Btn full size="sm" icon="IcPencil" onClick={() => props.onBaseAction('mod', b)}>Khoá & sửa thuộc tính</Btn>
          </Show>
          <Show when={modDraft()}>
            <div class="rounded-lg px-3 py-2 text-[11px]" style={{ background: chex(tone('#9A6700'), 0.12), color: tone('#9A6700') }}>Đang sửa — xem bản ghi “Sửa” trong change set.</div>
          </Show>
          <Show when={!delDraft()} fallback={<div class="flex items-center justify-between rounded-lg px-3 py-2 text-[11px]" style={{ background: chex(tone('#D1242F'), 0.12), color: tone('#D1242F') }}><span>Đã đánh dấu xoá</span><button onClick={() => props.onRemove(delDraft()!.id)} class="font-medium underline">Hoàn tác</button></div>}>
            <Btn full size="sm" danger icon="IcTrash" onClick={() => props.onBaseAction('del', b)}>Đánh dấu xoá</Btn>
          </Show>
        </div>
      </div>
    )
  }

  const draftView = (id: string) => {
    const f = () => props.drafts.find((x) => x.id === id)
    return (
      <Show when={f()} fallback={<div class="px-4 py-6 text-center text-[12px] text-[color:var(--muted)]">Đối tượng không còn tồn tại.</div>}>
        {(ff) => {
          const meta = () => KIND_META[ff().kind] || KIND_META.pipe
          const opLabel = () => OP_LABEL[ff().op]!
          const set = (k: keyof Draft, v: unknown) => props.onUpdate(ff().id, { [k]: v } as Partial<Draft>)
          return (
            <div class="px-4 py-3.5">
              <div class="mb-3 flex items-center gap-2">
                <Tile icon={meta().icon} col={meta().col} size={30} />
                <div class="min-w-0 flex-1"><div class="truncate text-[12.5px] font-semibold text-[color:var(--text)]">{ff().eam ? ff().eam!.name : meta().label}</div><div class="font-mono text-[10.5px] text-[color:var(--muted)]">{ff().baseId ? ff().baseId + ' · sửa' : ff().id}</div></div>
                <Badge color={tone(opLabel()[1])} soft dot>{opLabel()[0]}</Badge>
              </div>
              <div class="flex flex-col gap-3">
                <Show when={ff().kind === 'pipe'}>
                  <div class="grid grid-cols-2 gap-2.5">
                    <Field label="Đường kính"><Select value={String(ff().dn)} onChange={(v) => set('dn', +v)} options={ED_DN.map((d) => ({ value: String(d), label: 'DN ' + d }))} /></Field>
                    <Field label="Vật liệu"><Select value={ff().material!} onChange={(v) => set('material', v)} options={G.MATERIALS.map((m) => ({ value: m, label: m }))} /></Field>
                    <Field label="Năm lắp"><TextInput value={String(ff().year)} onChange={(v) => set('year', v.replace(/\D/g, '').slice(0, 4))} mono /></Field>
                    <Field label="Tình trạng"><Select value={ff().cond!} onChange={(v) => set('cond', v)} options={Object.keys(G.COND).map((k) => ({ value: k, label: G.COND[k]!.label }))} /></Field>
                  </div>
                  <div class="flex items-center justify-between rounded-lg border border-line px-3 py-2"><span class="text-[12px] font-medium text-[color:var(--text2)]">Ống truyền tải chính</span><Switch on={!!ff().trunk} onChange={(v) => set('trunk', v)} /></div>
                  <Show when={ff().pts}>
                    <KV label="Chiều dài" mono>{fmtKm(Math.round(edPolyLen(ff().pts!) * ED_U2M))} · {ff().pts!.length} đỉnh</KV>
                  </Show>
                </Show>
                <Show when={ff().kind === 'valve'}>
                  <div class="grid grid-cols-2 gap-2.5">
                    <Field label="Đường kính"><Select value={String(ff().dn)} onChange={(v) => set('dn', +v)} options={ED_DN.map((d) => ({ value: String(d), label: 'DN ' + d }))} /></Field>
                    <Field label="Loại van"><Select value={ff().vkind!} onChange={(v) => set('vkind', v)} options={[{ value: 'gate', label: 'Van cổng' }, { value: 'butterfly', label: 'Van bướm' }, { value: 'boundary', label: 'Van biên DMA' }, { value: 'air', label: 'Van xả khí' }]} /></Field>
                    <Field label="Trạng thái"><Select value={ff().state!} onChange={(v) => set('state', v)} options={[{ value: 'open', label: 'Đang mở' }, { value: 'closed', label: 'Đang đóng' }]} /></Field>
                    <Field label="Vị trí"><div class="flex h-9 items-center text-[12px] text-[color:var(--muted)]"><Show when={ff().onPipe} fallback={'Tự do'}><span class="font-mono">{ff().onPipe}</span></Show></div></Field>
                  </div>
                </Show>
                <Show when={ff().kind === 'hydrant'}>
                  <Field label="Loại trụ"><Select value={ff().htype!} onChange={(v) => set('htype', v)} options={[{ value: '3 cửa', label: '3 cửa' }, { value: '2 cửa', label: '2 cửa' }, { value: 'ngầm', label: 'Trụ ngầm' }]} /></Field>
                </Show>
                <Show when={ff().kind === 'node'}>
                  <div class="grid grid-cols-2 gap-2.5">
                    <Field label="Loại phụ kiện"><Select value={ff().ntype!} onChange={(v) => set('ntype', v)} options={[{ value: 'Tê', label: 'Tê' }, { value: 'Cút', label: 'Cút' }, { value: 'Côn thu', label: 'Côn thu' }, { value: 'Nút tách', label: 'Nút tách' }, { value: 'Nắp bịt', label: 'Nắp bịt' }]} /></Field>
                    <Field label="Cao độ (m)"><TextInput value={String(ff().z)} onChange={(v) => set('z', v.replace(/[^\d.]/g, ''))} mono /></Field>
                  </div>
                </Show>
                <div><div class="mb-1 text-[12px] font-medium text-[color:var(--text2)]">Thuộc DMA</div><DmaChip dma={ff().dma} /></div>
                <div class="rounded-lg border border-line p-3">
                  <div class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]"><Icon name="IcLink" size={13} />Lý lịch tài sản (EAM)</div>
                  <Show when={ff().eam} fallback={<Btn full size="sm" icon="IcPlus" onClick={() => props.onAttach(ff().id, ff().kind)}>Gắn tài sản từ EAM</Btn>}>
                    <div class="flex items-center gap-2.5">
                      <Tile icon={meta().icon} col={meta().col} size={32} />
                      <div class="min-w-0 flex-1"><div class="truncate text-[12px] font-medium text-[color:var(--text)]">{ff().eam!.code}</div><div class="truncate font-mono text-[10.5px] text-[color:var(--muted)]">{ff().eam!.serial} · {ff().eam!.maker}</div></div>
                      <button onClick={() => set('eam', null)} class="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"><Icon name="IcX" size={14} /></button>
                    </div>
                  </Show>
                </div>
                <Btn full size="sm" danger variant="ghost" icon="IcTrash" onClick={() => props.onRemove(ff().id)}>Xoá khỏi change set</Btn>
              </div>
            </div>
          )
        }}
      </Show>
    )
  }

  return (
    <Show when={sel()} fallback={<div class="px-4 py-6 text-center text-[12px] text-[color:var(--muted)]">Chọn một đối tượng để xem & sửa thuộc tính.</div>}>
      {(s) => {
        const v = s()
        if (typeof v === 'object' && v !== null && 'base' in v) return baseView(v.base)
        return draftView(v as string)
      }}
    </Show>
  )
}

/* ── Batch panel (multi-select) ── */
export function BatchBody(props: { ids: string[]; drafts: Draft[]; onApply: (patch: Partial<Draft>) => void; onClear: () => void }): JSX.Element {
  const G = useGis()
  const [dn, setDn] = createSignal('')
  const [material, setMaterial] = createSignal('')
  const [cond, setCond] = createSignal('')
  const [trunk, setTrunk] = createSignal('')
  const pipeN = () => props.ids.filter((id) => { if (id.startsWith('base:')) return true; const f = props.drafts.find((d) => d.id === id); return f && f.kind === 'pipe' }).length
  const any = () => dn() || material() || cond() || trunk()
  const apply = () => {
    const patch: Partial<Draft> = {}
    if (dn()) patch.dn = +dn()
    if (material()) patch.material = material()
    if (cond()) patch.cond = cond()
    if (trunk()) patch.trunk = trunk() === 'yes'
    props.onApply(patch)
  }
  return (
    <div class="px-4 py-3.5">
      <div class="mb-3 flex items-center gap-2"><Tile icon="IcGridSq" col="#8250DF" size={30} /><div class="min-w-0 flex-1"><div class="text-[12.5px] font-semibold text-[color:var(--text)]">Sửa hàng loạt</div><div class="text-[10.5px] text-[color:var(--muted)]">{props.ids.length} đối tượng · {pipeN()} tuyến ống</div></div><button onClick={props.onClear} class="text-[11px] font-medium text-[color:var(--muted)] hover:text-[color:var(--text)]">Bỏ chọn</button></div>
      <div class="rounded-lg border border-line bg-[var(--surface2)] px-3 py-2 text-[11px] text-[color:var(--muted)]">Chỉ trường được đặt mới ghi đè; để trống = giữ nguyên. Áp cho tuyến ống trong vùng chọn (gốc → tạo bản ghi sửa).</div>
      <div class="mt-3 flex flex-col gap-2.5">
        <Field label="Đường kính"><Select value={dn()} onChange={setDn} options={[{ value: '', label: '— giữ nguyên —' }, ...ED_DN.map((d) => ({ value: String(d), label: 'DN ' + d }))]} /></Field>
        <Field label="Vật liệu"><Select value={material()} onChange={setMaterial} options={[{ value: '', label: '— giữ nguyên —' }, ...G.MATERIALS.map((m) => ({ value: m, label: m }))]} /></Field>
        <Field label="Tình trạng"><Select value={cond()} onChange={setCond} options={[{ value: '', label: '— giữ nguyên —' }, ...Object.keys(G.COND).map((k) => ({ value: k, label: G.COND[k]!.label }))]} /></Field>
        <Field label="Ống chính"><Select value={trunk()} onChange={setTrunk} options={[{ value: '', label: '— giữ nguyên —' }, { value: 'yes', label: 'Có' }, { value: 'no', label: 'Không' }]} /></Field>
        <Btn full size="sm" variant="primary" icon="IcCheck" disabled={!any()} onClick={apply}>Áp cho {pipeN()} ống</Btn>
      </div>
    </div>
  )
}

/* ── Change set + rules ── */
export function ChangeSetPane(props: {
  title: string
  setTitle: (v: string) => void
  drafts: Draft[]
  counts: { add: number; mod: number; del: number }
  sel: CanvasSel
  onSelect: (s: CanvasSel) => void
  onRemove: (id: string) => void
  issues: RuleIssue[]
  ruleFlags: Record<string, boolean>
  setRuleFlags: (v: Record<string, boolean>) => void
  onCommit: () => void
  onClearAll: () => void
}): JSX.Element {
  const [tab, setTab] = createSignal<'list' | 'rules'>('list')
  const errs = () => props.issues.filter((i) => i.sev === 'error').length
  const warns = () => props.issues.length - errs()
  return (
    <div class="flex min-h-0 flex-1 flex-col border-t border-line">
      <div class="flex items-center gap-2 px-3 pt-2.5">
        <span class="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: chex(cAccent(), cTheme() === 'light' ? 0.14 : 0.24), color: tone(cAccent()) }}><Icon name="IcGitBranch" size={13} /></span>
        <input value={props.title} onInput={(e) => props.setTitle(e.currentTarget.value)} placeholder="Tiêu đề change set…" class="h-7 min-w-0 flex-1 rounded-md border border-line bg-[var(--surface)] px-2 text-[12px] font-medium text-[color:var(--text)] outline-none" />
      </div>
      <div class="flex items-center gap-1 px-3 pt-2">
        <button onClick={() => setTab('list')} class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors" style={{ background: tab() === 'list' ? 'var(--surface2)' : 'transparent', color: tab() === 'list' ? 'var(--text)' : 'var(--muted)' }}>Thay đổi <span class="font-mono text-[10px] text-[color:var(--muted2)]">{props.drafts.length}</span></button>
        <button onClick={() => setTab('rules')} class="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors" style={{ background: tab() === 'rules' ? 'var(--surface2)' : 'transparent', color: tab() === 'rules' ? 'var(--text)' : 'var(--muted)' }}>
          Quy tắc <Show when={errs()} fallback={<Show when={warns()} fallback={<span style={{ color: tone('#1A7F37') }}><Icon name="IcCheckCircle" size={12} /></span>}><span class="font-mono text-[10px]" style={{ color: tone('#9A6700') }}>{warns()}</span></Show>}><span class="font-mono text-[10px]" style={{ color: tone('#D1242F') }}>{errs()}</span></Show>
        </button>
        <div class="ml-auto flex items-center gap-2 font-mono text-[11px]"><span style={{ color: tone('#1A7F37') }}>+{props.counts.add}</span><span style={{ color: tone('#9A6700') }}>~{props.counts.mod}</span><span style={{ color: tone('#D1242F') }}>−{props.counts.del}</span></div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        <Show
          when={tab() === 'list'}
          fallback={
            <div class="flex flex-col gap-1">
              <For each={Object.entries(ED_RULE_DEFS)}>
                {([k, def]) => {
                  const on = () => props.ruleFlags[k] !== false
                  const hit = () => props.issues.filter((i) => i.rule === k)
                  const iconName = () => (on() ? (hit().length ? (def.sev === 'error' ? 'IcAlert' : 'IcInfo') : 'IcCheckCircle') : 'IcEyeOff')
                  return (
                    <div class="rounded-lg px-1.5 py-1">
                      <div class="flex items-center gap-2">
                        <button onClick={() => !def.lock && props.setRuleFlags({ ...props.ruleFlags, [k]: !on() })} disabled={def.lock} class="shrink-0" style={{ color: on() ? tone(hit().length ? (def.sev === 'error' ? '#D1242F' : '#9A6700') : '#1A7F37') : 'var(--muted2)', opacity: def.lock ? 0.7 : 1 }}>
                          <Icon name={iconName()} size={15} />
                        </button>
                        <span class="flex-1 text-[11.5px]" style={{ color: on() ? 'var(--text2)' : 'var(--muted2)' }}>{def.label}</span>
                        <Show when={on() && hit().length}>
                          <span class="font-mono text-[10px]" style={{ color: tone(def.sev === 'error' ? '#D1242F' : '#9A6700') }}>{hit().length}</span>
                        </Show>
                      </div>
                      <Show when={on() && hit().length}>
                        <div class="ml-7 mt-0.5 flex flex-col gap-0.5"><For each={hit().slice(0, 4)}>{(is) => <div class="text-[10px] leading-snug text-[color:var(--muted)]">{is.msg}</div>}</For></div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          }
        >
          <Show when={props.drafts.length} fallback={<div class="px-3 py-6 text-center text-[11.5px] text-[color:var(--muted)]">Chưa có thay đổi. Chọn công cụ và vẽ trên bản đồ.</div>}>
            <For each={props.drafts}>
              {(f) => {
                const meta = () => KIND_META[f.kind] || KIND_META.pipe
                const op = () => OP_LABEL[f.op]!
                const on = () => {
                  const s = props.sel
                  return s === f.id || (typeof s === 'object' && s !== null && 'base' in s && f.baseId === s.base.id)
                }
                return (
                  <div class="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors" style={{ background: on() ? 'var(--surface2)' : 'transparent' }}>
                    <button onClick={() => props.onSelect(f.baseId ? { base: { id: f.baseId, type: f.kind } } : f.id)} class="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: chex(tone(meta().col), 0.14), color: tone(meta().col) }}><Icon name={meta().icon} size={13} /></span>
                      <div class="min-w-0 flex-1"><div class="truncate text-[11.5px] font-medium text-[color:var(--text)]">{f.eam ? f.eam.code : meta().label}{f.kind === 'pipe' && f.dn ? ' · DN' + f.dn : ''}</div><div class="truncate font-mono text-[9.5px] text-[color:var(--muted)]">{f.baseId || f.id}</div></div>
                    </button>
                    <Badge color={tone(op()[1])} soft>{op()[0]}</Badge>
                    <button onClick={() => props.onRemove(f.id)} class="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface)] hover:text-[color:var(--text)]"><Icon name="IcX" size={12} /></button>
                  </div>
                )
              }}
            </For>
          </Show>
        </Show>
      </div>
      <div class="flex items-center gap-2 border-t border-line p-2.5">
        <Show when={props.drafts.length}>
          <button onClick={props.onClearAll} class="text-[11.5px] font-medium text-[color:var(--muted)] hover:text-[color:var(--text)]">Xoá hết</button>
        </Show>
        <span class="ml-auto flex items-center gap-1 text-[10.5px]" style={{ color: errs() ? tone('#D1242F') : warns() ? tone('#9A6700') : tone('#1A7F37') }}>
          <Icon name={errs() ? 'IcAlert' : warns() ? 'IcInfo' : 'IcCheckCircle'} size={13} />{errs() ? errs() + ' lỗi' : warns() ? warns() + ' cảnh báo' : 'Hợp lệ'}
        </span>
        <Btn size="sm" variant="primary" icon="IcSend" disabled={!props.drafts.length} onClick={props.onCommit}>Gửi duyệt</Btn>
      </div>
    </div>
  )
}

/* ── Import to editor ── */
export function ImportToEditorModal(props: { open: boolean; onClose: () => void; onLoad: (label: string) => void }): JSX.Element {
  const G = useGis()
  const files = () => G.importJobs.filter((j) => j.status === 'done' || j.status === 'review')
  return (
    <Modal open={props.open} onClose={props.onClose} title="Import dữ liệu vào phiên biên tập" subtitle="Nạp geometry từ tệp lên canvas dưới dạng nháp — rà soát, bắt điểm & nối lại rồi mới commit." icon="IcUpload" wide>
      <div class="mb-3 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line py-6 text-center">
        <span class="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: chex(cAccent(), 0.12), color: cAccent() }}><Icon name="IcUpload" size={20} /></span>
        <div class="text-[12.5px] font-medium text-[color:var(--text)]">Kéo thả tệp <button onClick={() => props.onLoad('tệp tải lên')} class="font-semibold" style={{ color: cAccent() }}>hoặc chọn tệp</button></div>
        <div class="flex flex-wrap justify-center gap-1.5"><For each={['GPS RTK', 'GeoJSON', 'CSV', 'Shapefile']}>{(f) => <span class="rounded-md bg-[var(--surface2)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--muted)]">{f}</span>}</For></div>
      </div>
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">Hoặc nạp từ job đã rà soát</div>
      <div class="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto">
        <For each={files()}>
          {(j) => (
            <button onClick={() => props.onLoad(j.file)} class="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:bg-[var(--surface2)]">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: chex(tone('#0969DA'), 0.14), color: tone('#0969DA') }}><Icon name="IcDatabase" size={15} /></span>
              <div class="min-w-0 flex-1"><div class="truncate font-mono text-[12px] font-medium text-[color:var(--text)]">{j.file}</div><div class="text-[10.5px] text-[color:var(--muted)]">{j.src} · {fmtInt(j.ok)} đối tượng hợp lệ</div></div>
              <Badge soft>{j.fmt}</Badge>
            </button>
          )}
        </For>
      </div>
    </Modal>
  )
}
