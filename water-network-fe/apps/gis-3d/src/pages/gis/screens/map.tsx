/* GIS — Bản đồ mạng lưới + Quản lý lớp (SolidJS port of map.jsx). */
import { For, Show, createContext, createMemo, createSignal, onCleanup, useContext, type JSX } from 'solid-js'
import {
  gisPixelDistanceM,
  gisPixelToLonLat,
  useGis,
  type Asset,
  type GisData,
  type Pipe,
} from '../lib/gis-data'
import {
  Icon,
  IcExternal,
  IcLink,
  IcRuler,
  IcSearch,
  IcFile,
  IcX,
  IcLockClosed,
  IcEye,
  IcEyeOff,
} from '../lib/icons'
import { cAccent, chex, cTheme, cnorm, fmtInt, fmtKm, rad, tone } from '../lib/theme'
import { MapOverlay } from '../shell/map-stage'
import {
  AssetTypeChip,
  Badge,
  Btn,
  Check,
  CondPill,
  DmaChip,
  Field,
  KV,
  Modal,
  Select,
  StackBar,
} from '../ui/kit'
import type { Route } from '../shell/nav'
import type { FocusBox, Selection } from '../ui/network-map-ol'

const assetIndex = (G: GisData): Record<string, Asset> => {
  const m: Record<string, Asset> = {}
  G.assets.forEach(a => (m[a.id] = a))
  return m
}

const SYMB = [
  { id: 'status', label: 'Trạng thái' },
  { id: 'material', label: 'Vật liệu' },
  { id: 'cond', label: 'Tình trạng' },
  { id: 'dn', label: 'Đường kính' },
  { id: 'age', label: 'Tuổi ống' },
  { id: 'dma', label: 'Phân vùng DMA' },
]
function symbLegend(mode: string, G: GisData): { label: string; col: string }[] | null {
  if (mode === 'material')
    return G.MATERIALS.map(m => ({
      label: m,
      col:
        (
          {
            'Gang dẻo': '#0E7C86',
            HDPE: '#1A7F37',
            uPVC: '#0969DA',
            Thép: '#8250DF',
            'Gang xám': '#9A6700',
          } as Record<string, string>
        )[m] ?? '#7E8997',
    }))
  if (mode === 'cond') return Object.values(G.COND).map(c => ({ label: c.label, col: c.col }))
  if (mode === 'dma') return G.dmas.map(d => ({ label: d.id, col: d.col }))
  if (mode === 'dn')
    return [
      { label: 'DN ≥ 500', col: '#8250DF' },
      { label: 'DN 300–400', col: '#0969DA' },
      { label: 'DN 200–250', col: '#0E7C86' },
      { label: 'DN 150', col: '#1A7F37' },
      { label: 'DN ≤ 110', col: '#9A6700' },
    ]
  if (mode === 'age')
    return [
      { label: '> 30 năm', col: '#D1242F' },
      { label: '18–30 năm', col: '#D86C1F' },
      { label: '8–18 năm', col: '#9A6700' },
      { label: '< 8 năm', col: '#1A7F37' },
    ]
  return null
}

function ServiceLinks(props: { asset: Asset | null; toast: (m: string, k?: string) => void }) {
  const G = useGis()
  const links = () => (props.asset ? G.assetLinks(props.asset) : [])
  return (
    <Show when={links().length > 0}>
      <div class="mb-3 rounded-lg border border-line bg-[var(--surface2)] p-3">
        <div class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
          <IcLink size={12} />
          Liên thông service
        </div>
        <div class="flex flex-col gap-0.5">
          <For each={links()}>
            {l => {
              const s = () => G.SERVICES[l.id]
              const st = () => G.LINK_STATE[l.status]
              const col = () => tone(s()?.col ?? '#7E8997')
              const sc = () => tone(st()?.col ?? '#7E8997')
              const code = props.asset?.code ?? props.asset?.id ?? ''
              return (
                <button
                  onClick={() => props.toast('Mở ' + (s()?.label ?? l.id) + ' · ' + code, 'info')}
                  title={'Mở ' + code + ' trong ' + (s()?.label ?? l.id)}
                  class="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
                >
                  <span
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: chex(s()?.col ?? '#7E8997', cTheme() === 'light' ? 0.12 : 0.2),
                      color: col(),
                    }}
                  >
                    <Icon name={s()?.icon} size={15} />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[12px] font-medium text-[color:var(--text)]">
                      {s()?.label}
                    </div>
                    <div class="truncate text-[10.5px] text-[color:var(--muted)]">{l.detail}</div>
                  </div>
                  <span
                    class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-[1px] text-[9.5px] font-medium"
                    style={{
                      background: chex(st()?.col ?? '#7E8997', cTheme() === 'light' ? 0.1 : 0.2),
                      color: sc(),
                    }}
                  >
                    <span class="h-1 w-1 rounded-full" style={{ background: sc() }} />
                    {st()?.label}
                  </span>
                  <span class="shrink-0 text-[color:var(--muted2)] opacity-0 transition-opacity group-hover:opacity-100">
                    <IcExternal size={13} />
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}

/* ── QueryPanel ── */
const QTYPES: [string, string][] = [
  ['pipe', 'Ống'],
  ['valve', 'Van'],
  ['hydrant', 'Trụ PCC'],
  ['pump', 'Trạm bơm'],
  ['reservoir', 'Bể/đài'],
  ['device', 'Thiết bị'],
]
const DN_BUCKETS: Record<string, (d: number) => boolean> = {
  all: () => true,
  le150: d => d <= 150,
  m200: d => d >= 200 && d <= 250,
  ge300: d => d >= 300,
}
const YR_BUCKETS: Record<string, (y: number) => boolean> = {
  all: () => true,
  pre2000: y => y < 2000,
  y00s: y => y >= 2000 && y <= 2010,
  post2010: y => y > 2010,
}

function QChip(props: { on: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      onClick={props.onClick}
      class="flex h-7 items-center gap-1 rounded-md border px-2 text-[11.5px] font-medium transition-colors"
      style={{
        'border-color': props.on ? cAccent() : 'var(--line)',
        background: props.on ? chex(cAccent(), cTheme() === 'light' ? 0.12 : 0.22) : 'transparent',
        color: props.on ? tone(cAccent()) : 'var(--muted)',
        'border-radius': `${rad() - 2}px`,
      }}
    >
      {props.children}
    </button>
  )
}

function QField(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1">
      <span class="text-[10.5px] font-medium uppercase tracking-wide text-[color:var(--muted2)]">
        {props.label}
      </span>
      {props.children}
    </div>
  )
}

interface QueryFilter {
  pipes: string[]
  valves: string[]
  types: Record<string, boolean>
}

function QueryPanel(props: {
  onApply: (f: QueryFilter | null) => void
  onFocus: (a: Asset) => void
  toast: (m: string, k?: string) => void
}) {
  const G = useGis()
  const [types, setTypes] = createSignal<Record<string, boolean>>({
    pipe: true,
    valve: true,
    hydrant: false,
    pump: false,
    reservoir: false,
    device: false,
  })
  const [dma, setDma] = createSignal('all')
  const [material, setMaterial] = createSignal('all')
  const [dn, setDn] = createSignal('all')
  const [yr, setYr] = createSignal('all')
  const [cond, setCond] = createSignal('all')
  const [status, setStatus] = createSignal('all')

  const results = createMemo(() => {
    return G.assets.filter(a => {
      if (!types()[a.type]) return false
      if (dma() !== 'all' && a.dma !== dma()) return false
      const g = a.geomRef as { material?: string; dn?: number; year?: number }
      if (material() !== 'all') {
        if (a.type !== 'pipe' || g.material !== material()) return false
      }
      if (dn() !== 'all') {
        const d = g.dn
        if (d == null || !DN_BUCKETS[dn()]!(d)) return false
      }
      if (yr() !== 'all') {
        const y = g.year
        if (y == null || !YR_BUCKETS[yr()]!(y)) return false
      }
      if (cond() !== 'all' && a.cond !== cond()) return false
      if (status() !== 'all' && a.status !== status()) return false
      return true
    })
  })

  // live highlight
  createMemo(() => {
    const r = results()
    props.onApply({
      pipes: r.filter(a => a.type === 'pipe').map(a => a.id),
      valves: r.filter(a => a.type === 'valve').map(a => a.id),
      types: types(),
    })
  })

  const breakdown = createMemo(() =>
    QTYPES.map(([k, lbl]) => ({
      label: lbl,
      col: G.ASSET_TYPES[k]?.col ?? '#7E8997',
      n: results().filter(r => r.type === k).length,
    })).filter(r => r.n > 0)
  )
  const totalLen = createMemo(() =>
    results()
      .filter(r => r.type === 'pipe')
      .reduce((s, r) => s + ((r.geomRef as { lenM?: number }).lenM || 0), 0)
  )

  const reset = () => {
    setTypes({
      pipe: true,
      valve: true,
      hydrant: false,
      pump: false,
      reservoir: false,
      device: false,
    })
    setDma('all')
    setMaterial('all')
    setDn('all')
    setYr('all')
    setCond('all')
    setStatus('all')
  }

  const dmaOpts = [
    { value: 'all', label: 'Tất cả DMA' },
    ...G.dmas.map(d => ({ value: d.id, label: d.id + ' · ' + d.name })),
  ]
  const matOpts = [
    { value: 'all', label: 'Mọi vật liệu' },
    ...G.MATERIALS.map(m => ({ value: m, label: m })),
  ]
  const dnOpts = [
    { value: 'all', label: 'Mọi đường kính' },
    { value: 'le150', label: 'DN ≤ 150' },
    { value: 'm200', label: 'DN 200 – 250' },
    { value: 'ge300', label: 'DN ≥ 300' },
  ]
  const yrOpts = [
    { value: 'all', label: 'Mọi năm lắp' },
    { value: 'pre2000', label: 'Trước 2000' },
    { value: 'y00s', label: '2000 – 2010' },
    { value: 'post2010', label: 'Sau 2010' },
  ]
  const condOpts = [
    { value: 'all', label: 'Mọi tình trạng' },
    ...Object.entries(G.COND).map(([k, v]) => ({ value: k, label: v.label })),
  ]
  const stOpts = [
    { value: 'all', label: 'Mọi trạng thái' },
    ...Object.entries(G.PSTATUS).map(([k, v]) => ({ value: k, label: v.label })),
  ]

  return (
    <div class="-mx-3.5 -my-3 flex min-h-full flex-col" data-testid="query-panel">
      <div class="flex flex-col gap-3 border-b border-line px-3.5 py-3">
        <QField label="Loại tài sản">
          <div class="flex flex-wrap gap-1.5">
            <For each={QTYPES}>
              {([k, lbl]) => (
                <QChip on={!!types()[k]} onClick={() => setTypes(t => ({ ...t, [k]: !t[k] }))}>
                  {lbl}
                </QChip>
              )}
            </For>
          </div>
        </QField>
        <QField label="Phân vùng (không gian)">
          <Select value={dma()} onChange={setDma} options={dmaOpts} />
        </QField>
        <div class="grid grid-cols-2 gap-2">
          <QField label="Đường kính">
            <Select value={dn()} onChange={setDn} options={dnOpts} />
          </QField>
          <QField label="Năm lắp">
            <Select value={yr()} onChange={setYr} options={yrOpts} />
          </QField>
        </div>
        <QField label="Vật liệu (ống)">
          <Select value={material()} onChange={setMaterial} options={matOpts} />
        </QField>
        <div class="grid grid-cols-2 gap-2">
          <QField label="Tình trạng">
            <Select value={cond()} onChange={setCond} options={condOpts} />
          </QField>
          <QField label="Trạng thái">
            <Select value={status()} onChange={setStatus} options={stOpts} />
          </QField>
        </div>
      </div>

      <div class="flex items-center justify-between px-3.5 py-2.5">
        <div class="flex items-baseline gap-1.5">
          <span class="font-mono text-[18px] font-semibold text-[color:var(--text)]">
            {fmtInt(results().length)}
          </span>
          <span class="text-[11px] text-[color:var(--muted)]">đối tượng</span>
        </div>
        <Show when={totalLen() > 0}>
          <span class="font-mono text-[11px] text-[color:var(--muted)]">
            {fmtKm(totalLen())} ống
          </span>
        </Show>
      </div>
      <Show when={breakdown().length > 0}>
        <div class="px-3.5 pb-2.5">
          <StackBar rows={breakdown()} h={8} />
        </div>
      </Show>

      <div class="min-h-0 flex-1 overflow-y-auto border-t border-line px-2 py-1.5">
        <Show
          when={results().length > 0}
          fallback={
            <div class="px-2 py-8 text-center text-[11.5px] text-[color:var(--muted)]">
              Không có tài sản khớp bộ lọc.
            </div>
          }
        >
          <For each={results().slice(0, 200)}>
            {a => (
              <button
                onClick={() => props.onFocus(a)}
                class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface2)]"
              >
                <span
                  class="shrink-0"
                  style={{ color: tone(G.ASSET_TYPES[a.type]?.col ?? '#7E8997') }}
                >
                  <Icon name={G.ASSET_TYPES[a.type]?.icon} size={14} />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[12px] font-medium text-[color:var(--text)]">
                    {a.name}
                  </div>
                  <div class="font-mono text-[10px] text-[color:var(--muted)]">{a.code}</div>
                </div>
                <DmaChip dma={a.dma} sm />
              </button>
            )}
          </For>
          <Show when={results().length > 200}>
            <div class="px-2 py-2 text-center font-mono text-[10px] text-[color:var(--muted2)]">
              … +{fmtInt(results().length - 200)} đối tượng khác
            </div>
          </Show>
        </Show>
      </div>

      <div
        class="grid gap-2 border-t border-line p-2.5"
        classList={{ 'grid-cols-1': G.canonical, 'grid-cols-2': !G.canonical }}
      >
        <Btn size="sm" variant="ghost" icon="IcRefresh" onClick={reset}>
          Xoá lọc
        </Btn>
        <Show when={!G.canonical}>
          <Btn
            size="sm"
            icon="IcDownload"
            onClick={() =>
              props.toast('Xuất ' + fmtInt(results().length) + ' đối tượng ra GeoJSON', 'success')
            }
          >
            GeoJSON
          </Btn>
        </Show>
      </div>
    </div>
  )
}

function AtlasModal(props: {
  open: boolean
  onClose: () => void
  toast: (m: string, k?: string) => void
}) {
  const G = useGis()
  const [sel, setSel] = createSignal<Record<string, boolean>>(
    Object.fromEntries(G.dmas.map(d => [d.id, true]))
  )
  const [paper, setPaper] = createSignal('A3')
  const [scale, setScale] = createSignal('1000')
  const n = () => Object.values(sel()).filter(Boolean).length
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Xuất tập bản đồ"
      subtitle="Map book theo DMA cho đội hiện trường"
      icon="IcFile"
      wide
      footer={
        <>
          <Btn variant="ghost" onClick={props.onClose}>
            Huỷ
          </Btn>
          <Btn
            variant="primary"
            icon="IcDownload"
            disabled={n() === 0}
            onClick={() => {
              props.toast(
                'Đang tạo tập bản đồ ' + paper() + ' · ' + n() + ' trang DMA (PDF)',
                'success'
              )
              props.onClose()
            }}
          >
            Tạo PDF ({n()} trang)
          </Btn>
        </>
      }
    >
      <div class="grid grid-cols-2 gap-3">
        <Field label="Khổ giấy">
          <Select
            value={paper()}
            onChange={setPaper}
            options={[
              { value: 'A3', label: 'A3 ngang' },
              { value: 'A2', label: 'A2 ngang' },
              { value: 'A1', label: 'A1 ngang' },
            ]}
          />
        </Field>
        <Field label="Tỉ lệ">
          <Select
            value={scale()}
            onChange={setScale}
            options={[
              { value: '500', label: '1 : 500' },
              { value: '1000', label: '1 : 1.000' },
              { value: '2000', label: '1 : 2.000' },
            ]}
          />
        </Field>
      </div>
      <div class="mt-3">
        <div class="mb-1.5 flex items-center justify-between text-[12px] font-medium text-[color:var(--text2)]">
          <span>Trang theo DMA</span>
          <button
            onClick={() =>
              setSel(Object.fromEntries(G.dmas.map(d => [d.id, n() !== G.dmas.length])))
            }
            class="text-[11px] text-[color:var(--muted)] hover:text-[color:var(--text)]"
          >
            {n() === G.dmas.length ? 'Bỏ chọn' : 'Chọn tất'}
          </button>
        </div>
        <div class="flex flex-col gap-1 rounded-lg border border-line p-2">
          <For each={G.dmas}>
            {d => (
              <button
                onClick={() => setSel(s => ({ ...s, [d.id]: !s[d.id] }))}
                class="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--surface2)]"
              >
                <Check
                  on={!!sel()[d.id]}
                  onChange={() => setSel(s => ({ ...s, [d.id]: !s[d.id] }))}
                />
                <DmaChip dma={d.id} sm />
                <span class="flex-1 truncate text-[12px] text-[color:var(--text2)]">{d.name}</span>
                <span class="font-mono text-[10.5px] text-[color:var(--muted2)]">
                  {fmtInt(G.pipes.filter(p => p.dma === d.id).length)} ống
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Modal>
  )
}

function LayerPanel(props: {
  vis: Record<string, boolean>
  setVis: (v: Record<string, boolean>) => void
  paint: string
  setPaint: (v: string) => void
}) {
  const G = useGis()
  const groups = createMemo(() => {
    const g: Record<string, (typeof G.LAYERS)[number][]> = {}
    G.LAYERS.forEach(l => {
      ;(g[l.grp] = g[l.grp] || []).push(l)
    })
    return Object.entries(g)
  })
  return (
    <div class="-mx-3.5 -my-3 flex min-h-full flex-col" data-testid="layer-panel">
      <div class="border-b border-line px-3.5 py-3">
        <div class="sx-lbl mb-2">Tô màu tuyến ống theo</div>
        <div class="flex flex-wrap gap-1.5">
          <For each={SYMB}>
            {m => (
              <QChip on={props.paint === m.id} onClick={() => props.setPaint(m.id)}>
                {m.label}
              </QChip>
            )}
          </For>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto px-2.5 py-2">
        <For each={groups()}>
          {([grp, items]) => (
            <div class="mb-1.5">
              <div class="sx-lbl px-1.5 pb-1 pt-2">
                {grp}
              </div>
              <For each={items}>
                {l => {
                  const on = () => props.vis[l.id]
                  return (
                    <div class="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[var(--surface2)]">
                      <button
                        onClick={() => !l.lock && props.setVis({ ...props.vis, [l.id]: !on() })}
                        disabled={l.lock}
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                        style={{
                          color: on() ? cAccent() : 'var(--muted2)',
                          opacity: l.lock ? 0.6 : 1,
                        }}
                      >
                        <Show
                          when={l.lock}
                          fallback={
                            <Show when={on()} fallback={<IcEyeOff size={15} />}>
                              <IcEye size={15} />
                            </Show>
                          }
                        >
                          <IcLockClosed size={15} />
                        </Show>
                      </button>
                      <div class="min-w-0 flex-1">
                        <div
                          class="truncate text-[12px] font-medium"
                          style={{ color: on() ? 'var(--text)' : 'var(--muted)' }}
                        >
                          {l.label}
                        </div>
                        <Show when={typeof l.count === 'number'}>
                          <div class="text-[10px] text-[color:var(--muted2)] font-mono">
                            {fmtInt(l.count!)} đối tượng
                          </div>
                        </Show>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          )}
        </For>
      </div>
      <div class="border-t border-line p-2.5">
        <div class="rounded-lg bg-[var(--surface2)] px-3 py-2 text-[10.5px] text-[color:var(--muted)]">
          <div class="flex items-center justify-between">
            <span>Hệ toạ độ</span>
            <span class="font-mono text-[color:var(--text2)]">{G.SRID}</span>
          </div>
          <div class="mt-1 flex items-center justify-between">
            <span>Phép chiếu FE</span>
            <span class="font-mono text-[color:var(--text2)]">WGS84</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AssetInspector(props: {
  sel: Selection
  onClose: () => void
  go: (r: Route) => void
  toast: (m: string, k?: string) => void
}) {
  const G = useGis()
  const model = createMemo(() => {
    const sel = props.sel
    if (!sel) return null
    let title = '',
      code = '',
      typeChip: string | undefined,
      condEl: string | undefined,
      dma: string | undefined,
      geomBadge = ''
    let attrs: [string, string | number][] = []
    let linkAsset: Asset | null = null
    if (sel.type === 'node') {
      const n = G.nodes.find(x => x.id === sel.id)
      if (!n) return null
      title = 'Nút lưới ' + n.code
      code = G.canonical ? n.code : n.id
      geomBadge = 'Điểm'
      const canonicalAsset = assetIndex(G)[n.id]
      if (G.canonical) {
        const coordinate = gisPixelToLonLat(G, n.x, n.y)
        typeChip = 'node'
        condEl = canonicalAsset?.cond
        attrs = [
          ['Loại', n.kind || 'Chưa xác định'],
          ['ID', n.id],
          [
            'Kinh độ',
            coordinate?.[0].toLocaleString('vi-VN', {
              minimumFractionDigits: 6,
              maximumFractionDigits: 8,
            }) ?? 'Chưa có dữ liệu',
          ],
          [
            'Vĩ độ',
            coordinate?.[1].toLocaleString('vi-VN', {
              minimumFractionDigits: 6,
              maximumFractionDigits: 8,
            }) ?? 'Chưa có dữ liệu',
          ],
          ['Cao độ', 'Chưa có dữ liệu'],
          ...Object.entries(canonicalAsset?.attrs ?? {}).filter(([key]) => key !== 'Loại nút'),
        ]
        linkAsset = canonicalAsset ?? null
      } else {
        attrs = [
          ['Loại', 'Giao lộ / phụ kiện'],
          [
            'Cao độ',
            n.z.toLocaleString('vi-VN', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }) + ' m',
          ],
          ['Toạ độ X', Math.round(n.x)],
          ['Toạ độ Y', Math.round(n.y)],
        ]
        linkAsset = {
          id: n.id,
          code: n.code,
          type: 'node',
          geom: 'point',
          name: 'Nút ' + n.code,
          dma: '',
          cond: 'good',
          status: 'ok',
          attrs: {},
          geomRef: n,
        } as unknown as Asset
      }
    } else {
      const a = assetIndex(G)[sel.id]
      if (!a) return null
      title = a.name
      code = a.code
      dma = a.dma
      geomBadge =
        ({ line: 'Đường', point: 'Điểm', polygon: 'Vùng' } as Record<string, string>)[a.geom] ??
        'Đối tượng'
      typeChip = a.type
      condEl = a.cond
      attrs = Object.entries(a.attrs)
      linkAsset = a
    }
    return { title, code, typeChip, condEl, dma, geomBadge, attrs, linkAsset }
  })
  return (
    <Show when={model()}>
      {m => (
        <aside class="sx-drawer sx-glass" aria-label="Thông tin đối tượng" data-testid="inspector">
          <div class="flex items-start gap-2.5 border-b border-line px-4 py-3.5">
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex items-center gap-1.5">
                <Show
                  when={m().typeChip}
                  fallback={
                    <Badge color={tone('#8250DF')} soft>
                      {m().geomBadge}
                    </Badge>
                  }
                >
                  <AssetTypeChip type={m().typeChip!} sm />
                </Show>
                <Show when={m().condEl}>
                  <CondPill cond={m().condEl!} sm />
                </Show>
              </div>
              <h3 class="font-[family-name:var(--f-label)] text-[17px] font-bold leading-tight tracking-[0.02em] text-[color:var(--text)]">
                {m().title}
              </h3>
              <div class="mt-0.5 font-mono text-[11px] text-[color:var(--muted)]">{m().code}</div>
            </div>
            <button onClick={props.onClose} class="sx-xbtn" aria-label="Đóng" title="Đóng (Esc)">
              <IcX size={17} />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-4 py-3">
            <div class="mb-3 flex flex-col">
              <For each={m().attrs}>
                {([k, v]) => (
                  <KV label={k} mono>
                    {v}
                  </KV>
                )}
              </For>
              <Show when={m().dma}>
                <KV label="Thuộc DMA">
                  <DmaChip dma={m().dma!} />
                </KV>
              </Show>
              <KV label="Geometry">
                <span class="inline-flex items-center gap-1.5">
                  {m().geomBadge} · {G.SRID}
                </span>
              </KV>
            </div>
            <ServiceLinks asset={m().linkAsset} toast={props.toast} />
            <Show when={!G.canonical}>
              <div class="mb-3 rounded-lg border border-line bg-[var(--surface2)] p-3">
                <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">
                  Lịch sử phiên bản
                </div>
                <div class="text-[11.5px] text-[color:var(--muted)]">
                  Chưa có dữ liệu lịch sử từ service phiên bản.
                </div>
              </div>
            </Show>
          </div>
          <Show when={!G.canonical}>
            <div class="grid grid-cols-2 gap-2 border-t border-line p-3">
              <Btn size="sm" icon="IcPencil" onClick={() => props.go({ name: 'editor' })}>
                Sửa
              </Btn>
              <Btn size="sm" icon="IcRoute" onClick={() => props.go({ name: 'trace' })}>
                Truy vết
              </Btn>
            </div>
          </Show>
        </aside>
      )}
    </Show>
  )
}

/* ── Map controller: the base layer of the full-screen stage ──────────────────
   Owns what the user set on the map itself (layer visibility, symbology,
   selection, measuring, query highlight) and exposes the pieces the shell
   places around the map: the base overlay, the Layers / Query panels, the
   inspector drawer, the measure pill and the top-bar asset search. */
export interface MapView {
  vis: () => Record<string, boolean>
  setVis: (v: Record<string, boolean>) => void
  sel: () => Selection
  setSel: (s: Selection) => void
  focus: () => FocusBox | null
  paint: () => string
  setPaint: (v: string) => void
  measuring: () => boolean
  toggleMeasure: () => void
  mpts: () => [number, number][]
  setMpts: (fn: (a: [number, number][]) => [number, number][]) => void
  queryEmphasis: () => { pipes: string[]; valves: string[] } | null
  setQueryEmphasis: (v: { pipes: string[]; valves: string[] } | null) => void
  atlas: () => boolean
  setAtlas: (v: boolean) => void
  goToAsset: (a: Asset) => void
  searchAssets: (q: string) => Asset[]
}

const MapViewCtx = createContext<MapView>()

export function useMapView(): MapView {
  const v = useContext(MapViewCtx)
  if (!v) throw new Error('useMapView must be used inside MapViewProvider')
  return v
}

export function MapViewProvider(props: { focusAsset?: { id: string }; children: JSX.Element }) {
  const G = useGis()
  const [vis, setVis] = createSignal<Record<string, boolean>>(
    Object.fromEntries(G.LAYERS.map(l => [l.id, l.on]))
  )
  const [sel, setSel] = createSignal<Selection>(null)
  const [focus, setFocus] = createSignal<FocusBox | null>(null)
  const [paint, setPaint] = createSignal('status')
  const [measuring, setMeasuring] = createSignal(false)
  const [mpts, setMpts] = createSignal<[number, number][]>([])
  const [queryEmphasis, setQueryEmphasis] = createSignal<{
    pipes: string[]
    valves: string[]
  } | null>(null)
  const [atlas, setAtlas] = createSignal(false)
  const index = assetIndex(G)

  const goToAsset = (a: Asset) => {
    const g = a.geomRef as Pipe & { x: number; y: number; poly: [number, number][] }
    let box: FocusBox
    if (a.geom === 'point') box = { x: g.x - 60, y: g.y - 60, w: 120, h: 120 }
    else if (a.geom === 'line') {
      const line = g.vertices ?? g.pts
      const xs = line.map(p => p[0]),
        ys = line.map(p => p[1])
      box = {
        x: Math.min(...xs) - 20,
        y: Math.min(...ys) - 20,
        w: Math.max(...xs) - Math.min(...xs) + 40,
        h: Math.max(...ys) - Math.min(...ys) + 40,
      }
    } else {
      const xs = g.poly.map(p => p[0]),
        ys = g.poly.map(p => p[1])
      box = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      }
    }
    setSel({ type: a.type, id: a.id })
    setFocus({ ...box, _k: Math.random() })
    const layerId = ['device', 'pump', 'reservoir'].includes(a.type) ? 'source' : a.type
    if (!vis()[layerId] && Object.prototype.hasOwnProperty.call(vis(), layerId))
      setVis({ ...vis(), [layerId]: true })
  }

  const searchAssets = (q: string): Asset[] => {
    if (!q.trim()) return []
    const k = cnorm(q)
    return G.assets.filter(a => cnorm(a.code).includes(k) || cnorm(a.name).includes(k)).slice(0, 7)
  }

  if (props.focusAsset) {
    const a = index[props.focusAsset.id]
    if (a) queueMicrotask(() => goToAsset(a))
  }

  const view: MapView = {
    vis,
    setVis,
    sel,
    setSel: s => {
      setSel(s)
      setFocus(null)
    },
    focus,
    paint,
    setPaint,
    measuring,
    toggleMeasure: () => {
      const was = measuring()
      setMeasuring(!was)
      if (was) setMpts([])
    },
    mpts,
    setMpts: fn => setMpts(fn),
    queryEmphasis,
    setQueryEmphasis,
    atlas,
    setAtlas,
    goToAsset,
    searchAssets,
  }
  return <MapViewCtx.Provider value={view}>{props.children}</MapViewCtx.Provider>
}

/** The user's own map state, pushed as the bottom-most stage overlay. */
export function BaseMapOverlay(): JSX.Element {
  const G = useGis()
  const v = useMapView()
  return (
    <MapOverlay
      layers={v.vis()}
      selected={v.sel()}
      onSelect={s => v.setSel(s)}
      focus={v.focus()}
      onBg={() => v.setSel(null)}
      paint={{ mode: v.paint() }}
      legendRows={symbLegend(v.paint(), G)}
      measure={v.measuring() ? v.mpts() : null}
      onMeasureClick={v.measuring() ? pt => v.setMpts(a => [...a, pt]) : undefined}
      emphasis={
        v.queryEmphasis()
          ? {
              dim: true,
              pipes: v.queryEmphasis()!.pipes,
              valvesOpen: new Set(v.queryEmphasis()!.valves),
            }
          : undefined
      }
    />
  )
}

/** Side panel: layer visibility + pipe symbology. */
export function LayersPanel(): JSX.Element {
  const v = useMapView()
  return <LayerPanel vis={v.vis()} setVis={v.setVis} paint={v.paint()} setPaint={v.setPaint} />
}

/** Side panel: attribute query with live highlight on the map. */
export function QueryPanelHost(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const v = useMapView()
  onCleanup(() => v.setQueryEmphasis(null))
  return (
    <QueryPanel
      onApply={f => v.setQueryEmphasis(f ? { pipes: f.pipes, valves: f.valves } : null)}
      onFocus={a => v.goToAsset(a)}
      toast={props.toast}
    />
  )
}

/** Inspector drawer for the current map selection (bottom-left, over the map). */
export function InspectorDrawer(props: {
  go: (r: Route) => void
  toast: (m: string, k?: string) => void
  /** selections another panel shows instead (e.g. a sensor opens its 24 h chart) */
  skip?: (sel: NonNullable<Selection>) => boolean
}): JSX.Element {
  const v = useMapView()
  return (
    <Show when={v.sel() && !props.skip?.(v.sel()!)}>
      <AssetInspector sel={v.sel()} onClose={() => v.setSel(null)} go={props.go} toast={props.toast} />
    </Show>
  )
}

/** Floating measure read-out (top centre) while the measure tool is on. */
export function MeasurePill(): JSX.Element {
  const G = useGis()
  const v = useMapView()
  const total = createMemo(() => {
    const a = v.mpts()
    let s = 0
    for (let i = 1; i < a.length; i++) s += gisPixelDistanceM(G, a[i - 1]!, a[i]!)
    return s
  })
  return (
    <Show when={v.measuring()}>
      <div class="sx-banner sx-glass" style={{ cursor: 'default', color: 'var(--ink)' }} role="status">
        <IcRuler size={16} />
        <b class="sx-num">
          {v.mpts().length > 1
            ? total() >= 1000
              ? (total() / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' km'
              : Math.round(total()) + ' m'
            : '0 m'}
        </b>
        <span class="text-[12px] font-normal text-[color:var(--muted)]">
          {v.mpts().length} điểm · bấm lên bản đồ để thêm
        </span>
        <button
          class="sx-bn-more"
          onClick={() => v.setMpts(a => a.slice(0, -1))}
          disabled={!v.mpts().length}
        >
          Hoàn tác
        </button>
        <button class="sx-bn-more" onClick={() => v.setMpts(() => [])} disabled={!v.mpts().length}>
          Xoá
        </button>
        <button class="sx-bn-more" onClick={() => v.toggleMeasure()}>
          Xong
        </button>
      </div>
    </Show>
  )
}

/** Banner shown when the rich viewer holds only part of the tenant's network. */
export function PartialNetworkBanner(): JSX.Element {
  const G = useGis()
  const partial = () => G.network?.truncated === true || G.network?.initialExtentPartial === true
  return (
    <Show when={partial()}>
      <a href="/gis?viewer=canonical" class="sx-banner warn" aria-live="polite">
        <span>
          Bản đồ đang hiển thị một phần dữ liệu của tenant
          <Show when={G.network?.truncated}>
            {' '}
            (giới hạn {G.network?.limit.toLocaleString('vi-VN')} đối tượng)
          </Show>
          .
        </span>
        <span class="sx-bn-more">Chế độ dữ liệu lớn</span>
      </a>
    </Show>
  )
}

export function AtlasHost(props: { toast: (m: string, k?: string) => void }): JSX.Element {
  const G = useGis()
  const v = useMapView()
  return (
    <Show when={!G.canonical}>
      <AtlasModal open={v.atlas()} onClose={() => v.setAtlas(false)} toast={props.toast} />
    </Show>
  )
}

/** Top-bar asset search: type a code or name, pick a result to fly there. */
export function AssetSearch(): JSX.Element {
  const G = useGis()
  const v = useMapView()
  const [q, setQ] = createSignal('')
  const [active, setActive] = createSignal(0)
  const results = createMemo(() => v.searchAssets(q()))
  const pick = (a: Asset) => {
    v.goToAsset(a)
    setQ('')
  }
  return (
    <div class="sx-search" data-testid="asset-search">
      <IcSearch size={16} />
      <input
        type="search"
        value={q()}
        placeholder="Tìm tài sản theo mã / tên… (vd O.300)"
        aria-label="Tìm tài sản"
        onInput={e => {
          setQ(e.currentTarget.value)
          setActive(0)
        }}
        onKeyDown={e => {
          const r = results()
          if (e.key === 'ArrowDown') setActive(i => Math.min(r.length - 1, i + 1))
          else if (e.key === 'ArrowUp') setActive(i => Math.max(0, i - 1))
          else if (e.key === 'Enter' && r[active()]) pick(r[active()]!)
          else if (e.key === 'Escape') setQ('')
          else return
          e.preventDefault()
        }}
      />
      <Show when={results().length}>
        <div class="sx-pop sx-glass left-0 right-0 top-[40px]" role="listbox">
          <For each={results()}>
            {(a, i) => (
              <button
                type="button"
                role="option"
                aria-selected={i() === active()}
                class="sx-menu-item"
                onMouseMove={() => setActive(i())}
                onClick={() => pick(a)}
              >
                <span style={{ color: tone(G.ASSET_TYPES[a.type]?.col ?? '#7E8997') }}>
                  <Icon name={G.ASSET_TYPES[a.type]?.icon} size={16} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium">{a.name}</span>
                  <span class="block font-mono text-[10.5px] text-[color:var(--muted)]">{a.code}</span>
                </span>
                <DmaChip dma={a.dma} sm />
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/** Top-bar map tools: measure distance, export map atlas. */
export function MapToolButtons(): JSX.Element {
  const G = useGis()
  const v = useMapView()
  return (
    <>
      <button
        type="button"
        class={'sx-btn sx-hide-sm' + (v.measuring() ? ' primary' : '')}
        aria-pressed={v.measuring()}
        title="Đo khoảng cách trên bản đồ"
        onClick={() => v.toggleMeasure()}
      >
        <IcRuler size={16} />
        Đo
      </button>
      <Show when={!G.canonical}>
        <button
          type="button"
          class="sx-btn sx-hide-sm"
          title="Xuất tập bản đồ theo DMA"
          onClick={() => v.setAtlas(true)}
        >
          <IcFile size={16} />
          Tập bản đồ
        </button>
      </Show>
    </>
  )
}
