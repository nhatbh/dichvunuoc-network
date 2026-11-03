/* GIS — Biên tập mạng lưới (SolidJS port of editor-screen.jsx EditorScreen/EditorWorkspace).
   Branch gate → CAD workspace: ribbon · palette · canvas · properties/batch · change set ·
   command line · status bar. Every edit is a DRAFT inside a change set, validated against the
   rule engine, then submitted for approval. Mounts as the `editor` route inside the GIS shell. */
import { Show, createEffect, createMemo, createSignal, onCleanup, type Setter } from 'solid-js'
import { type EditorDefaults, type SnapModes } from '../editor/canvas'
import { EditorOLCanvas } from '../editor/ol-canvas'
import {
  EdBranchGate,
  EdCogoModal,
  EdCollapsedRail,
  EdCommandLine,
  EdPalette,
  EdRibbon,
  EdStatusBar,
  type LogEntry,
} from '../editor/chrome'
import {
  ED_RULE_DEFS,
  ED_TOOLS,
  ED_U2M,
  KIND_META,
  type BaseRef,
  type CanvasSel,
  type Draft,
  type DraftKind,
  type EamRec,
  type EdTemplate,
  type Hit,
  type Pt,
  edDmaAt,
  edPolyLen,
  edRules,
  genImportFeatures,
} from '../editor/model'
import { BatchBody, ChangeSetPane, EamModal, ImportToEditorModal, PropBody } from '../editor/panels'
import { EDITOR_ACTIONS, actionsForTarget, runAction, type ActionCtx, type ActionTarget } from '../editor/actions'
import { resolveShortcut } from '../editor/shortcuts'
import { CommandPalette } from '../editor/ui/command-palette'
import { ContextMenu } from '../editor/ui/context-menu'
import { FloatingToolbar } from '../editor/ui/floating-toolbar'
import { ShortcutHelp } from '../editor/ui/shortcut-help'
import { SC_CARDS, scSaveCard, type Branch } from '../lib/branch-store'
import { useGis } from '../lib/gis-data'
import { IcChevRight, IcCopy, IcLockClosed, IcX, Icon } from '../lib/icons'
import { cAccent, tone } from '../lib/theme'
import { Btn } from '../ui/kit'
import type { Route } from '../shell/nav'
import type { Toast } from '../ui/kit'

/* small inline icon helpers for the canvas overlays */
const IcLock = () => <IcLockClosed size={15} />
const IcCopySm = () => <IcCopy size={15} />
const IcX14 = () => <IcX size={14} />
const IcChevR15 = () => <IcChevRight size={15} />
const CurToolIcon = (props: { name: string }) => <Icon name={props.name} size={14} />

type Toaster = (msg: string, kind?: Toast['kind']) => void
let edCsSeq = 319

export function EditorScreen(props: {
  toast: Toaster
  go: (r: Route) => void
  branchId?: string
  branches: Branch[]
  setBranches: Setter<Branch[]>
  importJob?: string
}) {
  const G = useGis()
  const boundBranch = () => (props.branches || []).find((b) => b.id === props.branchId) || null

  const makeBranch = (base: Branch | null) => {
    const id = 'B-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    const nb: Branch = base
      ? { id, name: base.name.replace(/ \(cũ\)$/, '') + ' — bản sửa', lane: 'future', state: 'draft', ver: 'v1', base: base.id, baseVer: base.ver, at: 'vừa xong', by: 'Lê Biên Tập', cards: [], x: 848, y: 36, pipeKm: base.pipeKm, assets: base.assets, note: 'Nhân bản từ ' + base.name + ' @ ' + base.ver + ' để biên tập.' }
      : { id, name: 'Bản trắng ' + G.TODAY, lane: 'future', state: 'draft', ver: 'v1', base: null, blank: true, at: 'vừa xong', by: 'Lê Biên Tập', cards: [], x: 848, y: 36, pipeKm: 0, assets: 0, note: 'Bản nháp trắng — vẽ mạng lưới từ đầu.' }
    props.setBranches((bs) => [...bs, nb])
    props.go({ name: 'editor', branch: id })
  }

  return (
    <Show
      when={props.branchId}
      fallback={
        <div class="fixed inset-0 z-40 bg-[var(--bg)]">
          <EdBranchGate branches={props.branches || []} onBlank={() => makeBranch(null)} onClone={(b) => makeBranch(b)} onOpen={(b) => props.go({ name: 'editor', branch: b.id })} onExit={() => props.go({ name: 'dashboard' })} />
        </div>
      }
    >
      <EditorWorkspace toast={props.toast} go={props.go} boundBranch={boundBranch()} branches={props.branches} setBranches={props.setBranches} importJob={props.importJob} />
    </Show>
  )
}

function EditorWorkspace(props: {
  toast: Toaster
  go: (r: Route) => void
  boundBranch: Branch | null
  branches: Branch[]
  setBranches: Setter<Branch[]>
  importJob?: string
}) {
  const G = useGis()
  const [tool, setTool] = createSignal('select')
  const [drafts, setDrafts] = createSignal<Draft[]>([])
  const [sel, setSel] = createSignal<CanvasSel>(null)
  const [multiSel, setMultiSel] = createSignal<string[]>([])
  const [painter, setPainter] = createSignal<{ kind: DraftKind; attrs: Partial<Draft> } | null>(null)
  const [title, setTitle] = createSignal('')
  const [status, setStatus] = createSignal<string | null>(null)
  const [coord, setCoord] = createSignal<[number, number] | null>(null)
  const [log, setLog] = createSignal<LogEntry[]>([])
  const [activeTmpl, setActiveTmpl] = createSignal<string | null>(null)
  const [leftOpen, setLeftOpen] = createSignal(true)
  const [rightOpen, setRightOpen] = createSignal(true)
  const [snap, setSnap] = createSignal(true)
  const [snapModes, setSnapModes] = createSignal<SnapModes>({ node: true, vertex: true, edge: true, grid: false })
  const [ortho, setOrtho] = createSignal(false)
  const [offsetDist, setOffsetDist] = createSignal(2)
  const [defaults, setDefaults] = createSignal<EditorDefaults>({ pipe: { dn: 200, material: 'HDPE', trunk: false, cond: 'good' }, valve: { dn: 200, vkind: 'gate' } })
  const [refLayers, setRefLayers] = createSignal<Record<string, boolean>>(props.boundBranch && props.boundBranch.blank ? { pipe: false, valve: false, node: false, dma: true, block: true } : {})
  const [ruleFlags, setRuleFlags] = createSignal<Record<string, boolean>>(Object.fromEntries(Object.keys(ED_RULE_DEFS).map((k) => [k, true])))
  const [eam, setEam] = createSignal<{ open: boolean; forId: string | null; kind: DraftKind | null }>({ open: false, forId: null, kind: null })
  const [importOpen, setImportOpen] = createSignal(false)
  const [cogoOpen, setCogoOpen] = createSignal(false)
  const [focusKey, setFocusKey] = createSignal(0)
  const [ctxMenu, setCtxMenu] = createSignal<{ open: boolean; x: number; y: number; target: ActionTarget | null }>({ open: false, x: 0, y: 0, target: null })
  const [floatXY, setFloatXY] = createSignal<[number, number] | null>(null)
  const [paletteOpen, setPaletteOpen] = createSignal(false)
  const [helpOpen, setHelpOpen] = createSignal(false)
  let lastActionId: string | null = null

  // undo/redo stacks (JSON snapshots of drafts)
  const [hist, setHist] = createSignal<string[]>([])
  const [redoStack, setRedoStack] = createSignal<string[]>([])
  let impRef: string | null = null

  const locked = () => !!props.boundBranch && (props.boundBranch.state === 'official' || props.boundBranch.state === 'archived')
  const grid = () => snapModes().grid
  const addLog = (t: string, k?: LogEntry['k']) => setLog((l) => [...l.slice(-60), { t, k: k || 'info' }])

  const guard = () => {
    if (locked()) {
      props.toast('Bản được khoá (of-record / lưu trữ) — Nhân bản để sửa', 'info')
      return true
    }
    return false
  }
  const pushHist = () => {
    setHist((h) => {
      const n = [...h, JSON.stringify(drafts())]
      if (n.length > 60) n.shift()
      return n
    })
    setRedoStack([])
  }
  const undo = () => {
    const h = hist()
    if (!h.length) return
    const last = h[h.length - 1]!
    setHist(h.slice(0, -1))
    setRedoStack((r) => [...r, JSON.stringify(drafts())])
    setDrafts(JSON.parse(last))
    setSel(null)
    setMultiSel([])
    addLog('Hoàn tác', 'ok')
  }
  const redo = () => {
    const r = redoStack()
    if (!r.length) return
    const last = r[r.length - 1]!
    setRedoStack(r.slice(0, -1))
    setHist((h) => [...h, JSON.stringify(drafts())])
    setDrafts(JSON.parse(last))
    setSel(null)
    setMultiSel([])
    addLog('Làm lại', 'ok')
  }

  const counts = createMemo(() => ({
    add: drafts().filter((f) => f.op === 'add').length,
    mod: drafts().filter((f) => f.op === 'mod').length,
    del: drafts().filter((f) => f.op === 'del').length,
  }))
  const issues = createMemo(() => edRules(G, drafts(), ruleFlags()))

  const onAdd = (f: Draft) => {
    if (guard()) return
    pushHist()
    setDrafts((d) => [...d, f])
    addLog((KIND_META[f.kind]?.label || '') + ' ' + f.id + ' đã thêm', 'ok')
  }
  const onUpdate = (id: string, patch: Partial<Draft>) => setDrafts((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const onRemove = (id: string) => {
    pushHist()
    setDrafts((d) => d.filter((f) => f.id !== id))
    setSel((s) => (s === id ? null : s))
  }
  const onClearAll = () => {
    pushHist()
    setDrafts([])
    setSel(null)
    setMultiSel([])
    addLog('Đã xoá toàn bộ thay đổi', 'info')
  }

  const onDeleteAt = (hit: Hit) => {
    if (guard()) return
    if (hit.kind === 'draft') onRemove(hit.f.id)
    else {
      const b = hit.base
      if (drafts().find((f) => f.op === 'del' && f.baseId === b.id)) return
      pushHist()
      const dma = edDmaAt(G, b.x || (b.pts ? b.pts[0]![0] : 0), b.y || (b.pts ? b.pts[0]![1] : 0))
      setDrafts((d) => [...d, { id: 'DRF-D' + b.id, op: 'del', baseId: b.id, kind: b.type, geom: b.geom || 'point', dma }])
      addLog('Đánh dấu xoá ' + b.id, 'info')
    }
  }
  const onBaseAction = (action: 'mod' | 'del', b: BaseRef) => {
    if (guard()) return
    pushHist()
    if (action === 'del') {
      if (drafts().find((f) => f.op === 'del' && f.baseId === b.id)) return
      const p = G.pipeBy[b.id]
      const id = 'DRF-D' + b.id
      setDrafts((d) => [...d, { id, op: 'del', baseId: b.id, kind: b.type, geom: b.geom || 'line', dma: p ? p.dma : 'DMA-01' }])
      setSel(id)
    } else {
      const p = G.pipeBy[b.id]
      if (!p) return
      const id = 'DRF-M' + b.id
      const f: Draft = { id, op: 'mod', baseId: b.id, kind: 'pipe', geom: 'line', pts: p.pts.map((pt) => [...pt] as Pt), dn: p.dn, material: p.material, year: p.year, cond: p.cond, trunk: p.trunk, dma: p.dma, eam: null }
      setDrafts((d) => [...d.filter((x) => x.id !== id), f])
      setSel(id)
    }
  }
  const modBaseWith = (baseId: string, patch: Partial<Draft>) => {
    const p = G.pipeBy[baseId]
    if (!p) return
    const id = 'DRF-M' + baseId
    setDrafts((d) => {
      const ex = d.find((x) => x.id === id)
      if (ex) return d.map((x) => (x.id === id ? { ...x, ...patch } : x))
      return [...d, { id, op: 'mod', baseId, kind: 'pipe', geom: 'line', pts: p.pts.map((pt) => [...pt] as Pt), dn: p.dn, material: p.material, year: p.year, cond: p.cond, trunk: p.trunk, dma: p.dma, eam: null, ...patch }]
    })
  }

  const onMerge = (a: Draft, b: Draft, mergedPts: Pt[]) => {
    if (guard()) return
    pushHist()
    const lenM = Math.round(edPolyLen(mergedPts) * ED_U2M)
    const merged: Draft = { ...a, pts: mergedPts, lenM, id: a.id }
    setDrafts((d) => d.filter((f) => f.id !== b.id).map((f) => (f.id === a.id ? merged : f)))
    setSel(a.id)
    addLog('Đã gộp ' + b.id + ' → ' + a.id, 'ok')
  }
  const onMulti = (ids: string[]) => {
    setMultiSel(ids)
    setSel(null)
    if (ids.length) setTool('select')
  }
  const applyBatch = (patch: Partial<Draft>) => {
    if (guard()) return
    pushHist()
    multiSel().forEach((id) => {
      if (id.startsWith('base:')) modBaseWith(id.slice(5), patch)
      else {
        const f = drafts().find((d) => d.id === id)
        if (f && f.kind === 'pipe') onUpdate(id, patch)
      }
    })
    addLog('Sửa hàng loạt ' + multiSel().length + ' đối tượng', 'ok')
    props.toast('Đã áp thuộc tính cho ' + multiSel().length + ' đối tượng', 'success')
  }

  const onPaint = (hit: Hit) => {
    if (guard()) return
    type PaintSrc = { dn?: number; material?: string; cond?: string; trunk?: boolean; vkind?: string }
    const grab = (src: PaintSrc, kind: DraftKind): Partial<Draft> => (kind === 'pipe' ? { dn: src.dn, material: src.material, cond: src.cond, trunk: !!src.trunk } : { dn: src.dn, vkind: src.vkind })
    if (!painter()) {
      let src: PaintSrc | null = null,
        kind: DraftKind | null = null
      if (hit.kind === 'draft') {
        src = hit.f
        kind = hit.f.kind
      } else if (hit.base.type === 'pipe') {
        src = G.pipeBy[hit.base.id] ?? null
        kind = 'pipe'
      } else if (hit.base.type === 'valve') {
        src = G.valves.find((v) => v.id === hit.base.id) ?? null
        kind = 'valve'
      }
      if (!src || !kind) return
      setPainter({ kind, attrs: grab(src, kind) })
      addLog('Lấy mẫu thuộc tính ' + kind, 'info')
      setStatus('Đã lấy mẫu — bấm đối tượng đích để gán.')
    } else {
      const p = painter()!
      pushHist()
      if (hit.kind === 'draft') {
        if (hit.f.kind === p.kind) onUpdate(hit.f.id, p.attrs)
      } else if (hit.base.type === 'pipe' && p.kind === 'pipe') modBaseWith(hit.base.id, p.attrs)
      addLog('Gán thuộc tính → ' + (hit.kind === 'draft' ? hit.f.id : hit.base.id), 'ok')
    }
  }

  const onAttach = (id: string, kind: DraftKind) => setEam({ open: true, forId: id, kind })
  const pickEam = (e: EamRec) => {
    const forId = eam().forId
    if (forId) onUpdate(forId, { eam: e })
  }

  const onTemplate = (t: EdTemplate) => {
    setActiveTmpl(t.id)
    setTool(t.kind)
    if (t.kind === 'pipe') setDefaults((d) => ({ ...d, pipe: { ...d.pipe, ...(t.attrs as Partial<EditorDefaults['pipe']>) } }))
    if (t.kind === 'valve') setDefaults((d) => ({ ...d, valve: { ...d.valve, ...(t.attrs as Partial<EditorDefaults['valve']>) } }))
    addLog('Mẫu: ' + t.label, 'info')
  }

  const loadImport = (label: string) => {
    if (locked()) {
      props.toast('Bản được khoá — Nhân bản để sửa', 'info')
      return
    }
    const feats = genImportFeatures(G)
    pushHist()
    setDrafts((d) => [...d, ...feats])
    setTool('select')
    setSel(null)
    setTitle((t) => t || 'Import khảo sát · ' + (label || 'tệp'))
    setImportOpen(false)
    addLog('Nạp ' + feats.length + ' đối tượng từ ' + (label || 'tệp'), 'ok')
    props.toast('Đã nạp ' + feats.length + ' đối tượng — bắt điểm & nối lại trước khi commit', 'info')
  }
  createEffect(() => {
    const job = props.importJob
    if (job && impRef !== job) {
      impRef = job
      setTimeout(() => loadImport(job), 60)
    }
  })

  const doCogo = (pts: Pt[]) => {
    if (guard()) return
    const dma = edDmaAt(G, pts[0]![0], pts[0]![1])
    const dp = defaults().pipe
    pushHist()
    const f: Draft = { id: 'DRF-' + Math.random().toString(36).slice(2, 5).toUpperCase(), op: 'add', kind: 'pipe', geom: 'line', pts, dn: dp.dn, material: dp.material, year: 2026, cond: dp.cond, trunk: !!dp.trunk, dma, lenM: Math.round(edPolyLen(pts) * ED_U2M), eam: null }
    setDrafts((d) => [...d, f])
    setSel(f.id)
    addLog('Tạo tuyến COGO ' + f.id, 'ok')
  }

  const cloneHere = () => {
    const bb = props.boundBranch
    if (!bb) return
    const id = 'B-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    const nb: Branch = { id, name: bb.name.replace(/ \(cũ\)$/, '') + ' — bản sửa', lane: 'future', state: 'draft', ver: 'v1', base: bb.id, baseVer: bb.ver, at: 'vừa xong', by: 'Lê Biên Tập', cards: [], x: 848, y: 36, pipeKm: bb.pipeKm, assets: bb.assets, note: 'Nhân bản từ ' + bb.name }
    props.setBranches((bs) => [...bs, nb])
    props.toast('Đã nhân bản → mở để sửa', 'success')
    props.go({ name: 'editor', branch: id })
  }

  const validate = () => {
    const e = issues().filter((i) => i.sev === 'error').length
    if (!e) {
      props.toast('Hợp lệ — sẵn sàng gửi duyệt', 'success')
      addLog('Validate: hợp lệ', 'ok')
    } else {
      props.toast(e + ' lỗi · ' + (issues().length - e) + ' cảnh báo', 'error')
      addLog('Validate: ' + e + ' lỗi, ' + (issues().length - e) + ' cảnh báo', 'err')
    }
  }
  const commit = () => {
    if (!drafts().length) return
    const e = issues().filter((i) => i.sev === 'error').length
    if (e) {
      props.toast('Còn ' + e + ' lỗi — chưa thể gửi duyệt', 'error')
      return
    }
    const id = 'CS-' + edCsSeq++
    const dmaMain = (drafts()[0] && drafts()[0]!.dma) || 'DMA-04'
    const kinds = drafts().map((d) => d.kind)
    const major = kinds.slice().sort((a, b) => kinds.filter((k) => k === b).length - kinds.filter((k) => k === a).length)[0] || 'pipe'
    const cardTitle = title().trim() || 'Biên tập ' + (props.boundBranch ? props.boundBranch.name : 'mạng lưới') + ' ' + G.TODAY
    const c = counts()
    G.changeSets.unshift({ id, title: cardTitle, author: 'Lê Biên Tập', at: 'vừa xong', status: 'pending', adds: c.add, mods: c.mod, dels: c.del, dma: dmaMain, reviewer: null })
    G.DASH.csPending = (G.DASH.csPending || 0) + 1
    const bb = props.boundBranch
    if (bb && !locked()) {
      const card = { title: cardTitle, kind: major, adds: c.add, mods: c.mod, dels: c.del, dma: dmaMain, by: 'Lê Biên Tập' }
      SC_CARDS[id] = card
      scSaveCard(id, card)
      const nextVer = 'v' + (parseInt(bb.ver.slice(1)) + 1)
      props.setBranches((bs) => bs.map((b) => (b.id === bb.id ? { ...b, cards: [...b.cards, id], ver: nextVer, at: 'vừa xong', by: 'Lê Biên Tập' } : b)))
      props.toast('Đã commit ' + id + ' vào “' + bb.name + '” → ' + nextVer, 'success')
      setDrafts([])
      setSel(null)
      setTitle('')
      setTimeout(() => props.go({ name: 'scenarios' }), 600)
      return
    }
    props.toast('Đã gửi ' + id + ' sang phê duyệt', 'success')
    setDrafts([])
    setSel(null)
    setTitle('')
    setTimeout(() => props.go({ name: 'versions' }), 600)
  }

  // command line
  const cmdMap: Record<string, () => void> = {}
  ED_TOOLS.forEach((t) => {
    cmdMap[t.cmd.toLowerCase()] = () => setTool(t.id)
  })
  const onCommand = (raw: string) => {
    addLog(raw, 'cmd')
    const c = raw.trim().toLowerCase()
    if (cmdMap[c]) {
      cmdMap[c]!()
      addLog((ED_TOOLS.find((t) => t.cmd.toLowerCase() === c) || {}).label || '', 'info')
      return
    }
    if (c === 'u' || c === 'undo') return undo()
    if (c === 'y' || c === 'redo') return redo()
    if (c === 'ze' || c === 'zoom') {
      setFocusKey((n) => n + 1)
      addLog('Zoom toàn mạng', 'info')
      return
    }
    if (c === 'cogo') return setCogoOpen(true)
    if (c === 'check' || c === 'validate') return validate()
    if (c === 'commit') return commit()
    if (c === 'esc' || c === 'select') {
      setTool('select')
      setSel(null)
      return
    }
    const mt = c.match(/^(-?\d+)\s*,\s*(-?\d+)$/)
    if (mt) {
      addLog('Toạ độ (' + mt[1] + ', ' + mt[2] + ') — dùng COGO để dựng tuyến chính xác', 'info')
      return
    }
    addLog('Lệnh không nhận diện: ' + raw, 'err')
  }

  // keyboard undo/redo + command palette + shortcut help + repeat-last-command
  createEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        undo()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        redo()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
      // Guard: ignore ? and Space when focus is on an input/textarea
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen((o) => !o)
      }
      if (e.key === ' ' && lastActionId && selTarget()) {
        e.preventDefault()
        runAction(lastActionId, selTarget()!, actionCtx())
      }
      const sid = resolveShortcut(e)
      const st = selTarget()
      if (sid && st) { e.preventDefault(); lastActionId = sid; runAction(sid, st, actionCtx()) }
    }
    window.addEventListener('keydown', h)
    onCleanup(() => window.removeEventListener('keydown', h))
  })

  const curTool = () => ED_TOOLS.find((t) => t.id === tool()) || ED_TOOLS[0]!
  const onSelectCanvas = (s: CanvasSel) => {
    setSel(s)
    setMultiSel([])
    if (s === null) setFloatXY(null)
  }
  const rightMode = () => (multiSel().length ? 'batch' : 'single')

  const setToolFromRibbon = (t: string) => {
    setTool(t)
    setActiveTmpl(null)
    setStatus(null)
    if (t !== 'match') setPainter(null)
    addLog((ED_TOOLS.find((x) => x.id === t) || {}).label || '', 'info')
  }

  /* ── context menu wiring ── */
  const actionCtx = (clickPt?: Pt): ActionCtx => ({
    G,
    drafts: drafts(),
    defaults: defaults(),
    offsetDist: offsetDist(),
    clickPt,
    onAdd,
    onUpdate,
    onRemove,
    onDeleteAt,
    onSelect: onSelectCanvas,
    onMulti,
    onMatch: (hit) => onPaint(hit),
    onAttachEam: (id, kind) => onAttach(id, kind),
    setStatus,
    toast: (msg, kind) => props.toast(msg, kind as Parameters<Toaster>[1]),
    setTool: setToolFromRibbon,
    zoomExtent: () => setFocusKey((n) => n + 1),
  })

  /** Map the current sel() to an ActionTarget for the floating toolbar. */
  const selTarget = (): ActionTarget | null => {
    const s = sel()
    if (s === null) return null
    if (typeof s === 'string') {
      const f = drafts().find((d) => d.id === s)
      if (!f) return null
      return { kind: f.kind === 'pipe' ? 'pipe' : 'point', hit: { kind: 'draft', f } }
    }
    // s is { base: BaseRef }
    const base = s.base
    return { kind: base.type === 'pipe' ? 'pipe' : 'point', hit: { kind: 'base', base } }
  }

  /** Target for the command palette: selection if any, else empty at current coord. */
  const paletteTarget = (): ActionTarget => selTarget() ?? { kind: 'empty', pt: coord() ?? [0, 0] }

  const selActions = () => {
    const t = selTarget()
    if (!t) return []
    return actionsForTarget(t, actionCtx()).filter((a) => a.quick)
  }

  const openCtxMenu = (t: ActionTarget, xy: [number, number]) => {
    setCtxMenu({ open: true, x: xy[0], y: xy[1], target: t })
    setFloatXY(xy)
  }

  const pickCtxAction = (id: string) => {
    const m = ctxMenu()
    if (!m.target) return
    lastActionId = id
    runAction(id, m.target, actionCtx(m.target.kind === 'empty' ? m.target.pt : undefined))
  }

  const ctxTargetLabel = (t: ActionTarget): string => {
    if (t.kind === 'multi') return t.ids.length + ' đối tượng đã chọn'
    if (t.kind === 'empty') return 'Vị trí trên bản đồ'
    const id = t.hit.kind === 'draft' ? t.hit.f.id : t.hit.base.id
    return (t.kind === 'pipe' ? 'Tuyến ống · ' : 'Đối tượng · ') + id
  }

  return (
    <div class="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]">
      <EdRibbon
        tool={tool()}
        setTool={setToolFromRibbon}
        branch={props.boundBranch}
        locked={locked()}
        onClone={cloneHere}
        onImport={() => setImportOpen(true)}
        onExit={() => props.go({ name: 'dashboard' })}
        onChangeBranch={() => props.go({ name: 'editor' })}
        onUndo={undo}
        onRedo={redo}
        canUndo={hist().length > 0}
        canRedo={redoStack().length > 0}
      />

      <div class="flex min-h-0 flex-1">
        <Show when={leftOpen()} fallback={<EdCollapsedRail side="left" label="Công cụ" icon="IcPencil" onExpand={() => setLeftOpen(true)} />}>
          <EdPalette activeTmpl={activeTmpl()} onTemplate={onTemplate} refLayers={refLayers()} setRefLayers={setRefLayers} snapModes={snapModes()} setSnapModes={setSnapModes} offsetDist={offsetDist()} setOffsetDist={setOffsetDist} onCollapse={() => setLeftOpen(false)} />
        </Show>

        <div class="relative min-w-0 flex-1">
          <EditorOLCanvas
            tool={tool()}
            drafts={drafts()}
            selId={sel()}
            multiSel={multiSel()}
            onSelect={onSelectCanvas}
            onMulti={onMulti}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onDeleteAt={onDeleteAt}
            onMerge={onMerge}
            onPaint={onPaint}
            snap={snap()}
            snapModes={snapModes()}
            ortho={ortho()}
            grid={grid()}
            offsetDist={offsetDist()}
            defaults={defaults()}
            refLayers={refLayers()}
            setStatus={setStatus}
            onCoord={(x, y) => setCoord([x, y])}
            focusKey={focusKey()}
            onContextMenu={openCtxMenu}
          />

          <Show when={locked()}>
            <div class="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-lg border border-line bg-[var(--surface)] px-3 py-2" style={{ 'box-shadow': 'var(--toast-shadow)' }}>
              <span style={{ color: tone('#9A6700') }}><IcLock /></span>
              <span class="text-[12px] text-[color:var(--text2)]">Bản <b class="text-[color:var(--text)]">{props.boundBranch!.name}</b> được khoá — chỉ xem.</span>
              <Btn size="sm" variant="primary" icon="IcCopy" onClick={cloneHere}>Nhân bản để sửa</Btn>
            </div>
          </Show>
          <Show when={!locked() && painter()}>
            {(p) => (
              <div class="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-lg border border-line bg-[var(--surface)] px-3 py-2" style={{ 'box-shadow': 'var(--card-shadow)' }}>
                <span style={{ color: tone(cAccent()) }}><IcCopySm /></span>
                <span class="text-[12px] text-[color:var(--text2)]">Đã lấy mẫu <b class="text-[color:var(--text)]">{p().kind === 'pipe' ? 'DN' + p().attrs.dn + ' · ' + p().attrs.material : 'van DN' + p().attrs.dn}</b> — bấm đối tượng đích.</span>
                <button onClick={() => setPainter(null)} class="text-[11.5px] font-semibold" style={{ color: tone(cAccent()) }}>Xong</button>
              </div>
            )}
          </Show>

          {/* hint công cụ */}
          <div class="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[480px] rounded-lg border border-line bg-[var(--surface)]/92 px-3 py-2 backdrop-blur" style={{ 'box-shadow': 'var(--card-shadow)' }}>
            <div class="flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--text)]"><CurToolIcon name={curTool().icon} />{curTool().label}</div>
            <div class="mt-0.5 text-[11px] text-[color:var(--muted)]">{status() || curTool().hint}</div>
          </div>
        </div>

        <Show when={rightOpen()} fallback={<EdCollapsedRail side="right" label="Thuộc tính" icon="IcGitBranch" onExpand={() => setRightOpen(true)} />}>
          <div class="flex w-[336px] shrink-0 flex-col overflow-hidden border-l border-line bg-[var(--surface)]">
            <div class="max-h-[46%] shrink-0 overflow-y-auto border-b border-line">
              <div class="flex items-center justify-between px-4 pb-1 pt-3">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{rightMode() === 'batch' ? 'Sửa hàng loạt' : 'Thuộc tính'}</span>
                <div class="flex items-center gap-0.5">
                  <Show when={sel() && rightMode() === 'single'}>
                    <button onClick={() => setSel(null)} class="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"><IcX14 /></button>
                  </Show>
                  <button onClick={() => setRightOpen(false)} title="Thu gọn bảng" class="flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted2)] hover:bg-[var(--surface2)] hover:text-[color:var(--text)]"><IcChevR15 /></button>
                </div>
              </div>
              <Show when={rightMode() === 'batch'} fallback={<PropBody sel={sel()} drafts={drafts()} onUpdate={onUpdate} onRemove={onRemove} onAttach={onAttach} onBaseAction={onBaseAction} />}>
                <BatchBody ids={multiSel()} drafts={drafts()} onApply={applyBatch} onClear={() => setMultiSel([])} />
              </Show>
            </div>
            <ChangeSetPane title={title()} setTitle={setTitle} drafts={drafts()} counts={counts()} sel={sel()} onSelect={onSelectCanvas} onRemove={onRemove} issues={issues()} ruleFlags={ruleFlags()} setRuleFlags={setRuleFlags} onCommit={commit} onClearAll={onClearAll} />
          </div>
        </Show>
      </div>

      <EdCommandLine log={log()} hint={curTool().label + ' — ' + curTool().cmd} onCommand={onCommand} />
      <EdStatusBar coord={coord()} snap={snap()} setSnap={setSnap} ortho={ortho()} setOrtho={setOrtho} grid={grid()} setGrid={(v) => setSnapModes((s) => ({ ...s, grid: v }))} snapModes={snapModes()} setSnapModes={setSnapModes} counts={counts()} srid={G.SRID} />

      <EamModal open={eam().open} kind={eam().kind} onClose={() => setEam({ open: false, forId: null, kind: null })} onPick={pickEam} />
      <ImportToEditorModal open={importOpen()} onClose={() => setImportOpen(false)} onLoad={loadImport} />
      <EdCogoModal open={cogoOpen()} onClose={() => setCogoOpen(false)} onCreate={doCogo} />
      <CommandPalette
        open={paletteOpen()}
        actions={EDITOR_ACTIONS.filter((a) => a.enabledFor(paletteTarget(), actionCtx()))}
        onRun={(id) => { lastActionId = id; runAction(id, paletteTarget(), actionCtx()) }}
        onClose={() => setPaletteOpen(false)}
      />
      <ShortcutHelp open={helpOpen()} onClose={() => setHelpOpen(false)} />
      <ContextMenu
        open={ctxMenu().open}
        x={ctxMenu().x}
        y={ctxMenu().y}
        label={ctxMenu().target ? ctxTargetLabel(ctxMenu().target!) : undefined}
        actions={ctxMenu().target ? actionsForTarget(ctxMenu().target!, actionCtx()) : []}
        onPick={pickCtxAction}
        onClose={() => setCtxMenu((m) => ({ ...m, open: false }))}
      />
      <Show when={selTarget() !== null && floatXY() !== null}>
        <FloatingToolbar
          open
          x={floatXY()![0]}
          y={floatXY()![1]}
          actions={selActions()}
          onPick={(id) => {
            const t = selTarget()
            if (t) { lastActionId = id; runAction(id, t, actionCtx()) }
          }}
          onMore={() => {
            const xy = floatXY()!
            setCtxMenu({ open: true, x: xy[0], y: xy[1], target: selTarget() })
          }}
        />
      </Show>
    </div>
  )
}
