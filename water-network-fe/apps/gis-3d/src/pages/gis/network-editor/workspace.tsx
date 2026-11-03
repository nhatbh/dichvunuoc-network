import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { createMapRuntime } from '@wn/map-runtime-3d/solid'
import type {
  GeometryEditComplete,
  GeometryEditTarget,
  GeometryVertexSelection,
} from '@wn/map-runtime-3d'
import type { FeatureCollection, Geometry } from 'geojson'
import { useSession } from '@/entities/session/api/use-session'
import { importSessionScope } from '../import-workspace/api'
import { createNetworkEditorApi, type EditorApi } from './api'
import {
  editAsset,
  modifyAssetGeometry,
  pipeEndpointLocks,
  extent,
  newId,
  splitPipe,
  visibleAssets,
  type Asset,
  type Edit,
  type Issue,
  type Kind,
  type Revision,
  type State,
  type Point,
} from './model'
import './editor.css'

const labels: Record<string, string> = {
  Draft: 'Đang chỉnh sửa',
  Validated: 'Đã kiểm tra',
  Submitted: 'Chờ duyệt',
  Approved: 'Đã duyệt · đang cập nhật',
  Published: 'Đã cập nhật mạng',
  PartiallyPublished: 'Cập nhật không thành công',
}
const kinds: Record<Kind, string> = { Node: 'Nút', Pipe: 'Ống', Device: 'Thiết bị' }
const actions = { Add: 'Thêm', Update: 'Sửa', Delete: 'Xóa' }
type Tool = 'select' | 'pipe' | 'node' | 'device' | 'modify' | 'segment' | 'split'
export function NetworkEditor() {
  const session = useSession()
  const scope = createMemo(() => importSessionScope(session.data()))
  const canWrite = () => session.data()?.user.permissions?.includes('network-design:write') ?? false
  const canApprove = () =>
    session.data()?.user.permissions?.includes('network-design:approve') ?? false
  const [state, setState] = createSignal<State>({})
  const [revisions, setRevisions] = createSignal<(Revision & { updatedAt: string })[]>([])
  const [revision, setRevision] = createSignal<Revision | null>(null)
  const [edits, setEdits] = createSignal<Edit[]>([])
  const [undo, setUndo] = createSignal<Edit[][]>([]),
    [redo, setRedo] = createSignal<Edit[][]>([])
  const [dirty, setDirty] = createSignal(false),
    [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal(''),
    [notice, setNotice] = createSignal('')
  const [issues, setIssues] = createSignal<Issue[]>([])
  const [selected, setSelected] = createSignal<string | null>(null)
  const [tool, setTool] = createSignal<Tool>('select')
  const [search, setSearch] = createSignal(''),
    [snap, setSnap] = createSignal(true)
  const [vertex, setVertex] = createSignal<GeometryVertexSelection | null>(null)
  const [geometryRefresh, setGeometryRefresh] = createSignal(0)
  let geometryTarget: GeometryEditTarget | null = null,
    targetContext = '',
    toolGeneration = 0
  const context = () =>
    JSON.stringify([
      scope(),
      revision()?.id,
      revision()?.version,
      revision()?.status,
      selected(),
      tool(),
      editable(),
    ])
  function cancelGeometry() {
    map.port()?.setGeometryEditTarget(null)
    geometryTarget = null
    targetContext = ''
    setVertex(null)
    ++toolGeneration
  }
  const deletableVertex = () => {
    const v = vertex(),
      a = asset()
    return (
      editable() &&
      tool() === 'modify' &&
      a?.kind === 'Pipe' &&
      v?.featureId === selected() &&
      v.vertexIndex > 0 &&
      v.vertexIndex < a.geometry.coordinates.length - 1 &&
      a.geometry.coordinates.length > 2 &&
      !!geometryTarget
    )
  }
  const [reason, setReason] = createSignal('')
  const visible = createMemo(() =>
    visibleAssets(state(), revision()?.status === 'Published' ? [] : edits())
  )
  const selectedEdit = () => edits().find(e => (e.targetId ?? e.id) === selected())
  const asset = () => visible()[selected() ?? '']?.asset ?? selectedEdit()?.before ?? null
  const editable = () =>
    canWrite() && !busy() && !!revision() && ['Draft', 'Validated'].includes(revision()!.status)
  let api: EditorApi | null = null,
    epoch = 0,
    fitted = false
  const map = createMapRuntime({ view: { center: { lon: 105.5, lat: 21.2 }, zoom: 12 } })
  const backupKey = () => `wn-network-edit:${scope()}:${revision()?.id ?? ''}`
  const remember = () => {
    try {
      if (revision())
        localStorage.setItem(
          backupKey(),
          JSON.stringify({ version: revision()!.version, edits: edits() })
        )
    } catch {
      /* server save remains available */
    }
  }
  const forget = () => {
    try {
      localStorage.removeItem(backupKey())
    } catch {
      /* optional recovery */
    }
  }
  function receive(r: Revision) {
    setRevision(r)
    setEdits(r.operations ?? [])
    setDirty(false)
    setUndo([])
    setRedo([])
    setSelected(null)
    setTool('select')
  }
  async function run(work: (client: EditorApi) => Promise<void>) {
    if (!api || busy()) return
    const generation = epoch
    cancelGeometry()
    setBusy(true)
    setError('')
    try {
      await work(api)
    } catch (e) {
      if (generation === epoch)
        setError(e instanceof Error ? e.message : 'Không thể thực hiện thao tác.')
    } finally {
      if (generation === epoch) setBusy(false)
    }
  }
  createEffect(
    on(scope, s => {
      const generation = ++epoch,
        controller = new AbortController()
      onCleanup(() => controller.abort())
      api = null
      setState({})
      setRevisions([])
      setRevision(null)
      setEdits([])
      setDirty(false)
      setIssues([])
      setError('')
      setNotice('')
      setSelected(null)
      fitted = false
      if (!s) return
      const client = createNetworkEditorApi(s, controller.signal)
      api = client
      setBusy(true)
      Promise.all([client.assets(), client.list()])
        .then(([assets, list]) => {
          if (generation === epoch) {
            setState(assets)
            setRevisions(list)
          }
        })
        .catch(e => {
          if (generation === epoch && !controller.signal.aborted) setError(e.message)
        })
        .finally(() => {
          if (generation === epoch) setBusy(false)
        })
    })
  )
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return
    const focused =
      e.target instanceof Element &&
      !!e.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
      )
    if (focused) return
    if (e.key === 'Escape') {
      cancelGeometry()
      setTool('select')
    }
    if (e.key === 'Delete' && deletableVertex()) {
      e.preventDefault()
      map.port()?.deleteSelectedGeometryVertex()
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'z' &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault()
      history(!e.shiftKey)
    }
  }
  window.addEventListener('keydown', onKey)
  onCleanup(() => window.removeEventListener('keydown', onKey))
  const leave = (e: BeforeUnloadEvent) => {
    if (dirty()) {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', leave)
  onCleanup(() => window.removeEventListener('beforeunload', leave))
  function commit(next: Edit[]) {
    if (!editable()) return
    setUndo(v => [...v.slice(-49), structuredClone(edits())])
    setRedo([])
    setEdits(next)
    setDirty(true)
    setIssues([])
    remember()
  }
  function history(back: boolean) {
    const source = back ? undo() : redo()
    if (!source.length || !editable()) return
    if (back) {
      setRedo(v => [...v, edits()])
      setUndo(source.slice(0, -1))
    } else {
      setUndo(v => [...v, edits()])
      setRedo(source.slice(0, -1))
    }
    setEdits(source.at(-1)!)
    setDirty(true)
    setIssues([])
    remember()
  }
  function fit(assets: Asset[]) {
    const box = extent(assets)
    if (box) map.port()?.fitToBbox(box, { padding: 70, maxZoom: 20 })
  }
  function focus(id: string) {
    setSelected(id)
    const a = visible()[id]?.asset ?? edits().find(e => (e.targetId ?? e.id) === id)?.before
    if (a) fit([a])
  }
  function nearestNode(point: Point, assets: State): string | null {
    let found: string | null = null,
      best = 1
    for (const [id, { asset: a }] of Object.entries(assets))
      if (a.kind === 'Node') {
        const p = a.geometry.coordinates[0]
        if (!p) continue
        const d =
          ((point[0] - p[0]) * 111320 * Math.cos((point[1] * Math.PI) / 180)) ** 2 +
          ((point[1] - p[1]) * 111320) ** 2
        if (d <= best) {
          best = d
          found = id
        }
      }
    return found
  }
  function draw(geometry: Geometry) {
    if (!editable()) return
    const id = newId(),
      kind: Kind = tool() === 'pipe' ? 'Pipe' : tool() === 'device' ? 'Device' : 'Node'
    if (geometry.type !== 'Point' && geometry.type !== 'LineString') return
    let next = edits()
    const positions = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates
    if (!positions.length || positions.some(p => p.length < 2 || !p.every(Number.isFinite))) return
    const coordinates: Point[] = positions.map(p => [p[0]!, p[1]!])
    const base: Asset = {
      draftAssetId: id,
      clientRef: id,
      kind,
      assetCode: `${kind === 'Pipe' ? 'P' : kind === 'Node' ? 'N' : 'D'}-${id.slice(0, 8)}`,
      geometry: { type: geometry.type, coordinates },
      attributes:
        kind === 'Pipe'
          ? { diameterMm: '100', material: 'HDPE' }
          : kind === 'Node'
            ? { nodeType: 'Junction' }
            : { deviceType: 'Valve' },
      fromRef: null,
      toRef: null,
      hostRef: null,
    }
    if (kind === 'Pipe') {
      const endpoints = [coordinates[0]!, coordinates.at(-1)!].map(point => {
        const found = nearestNode(point, visibleAssets(state(), next))
        if (found) return found
        const nodeId = newId()
        next = editAsset(state(), next, nodeId, {
          ...base,
          draftAssetId: nodeId,
          clientRef: nodeId,
          kind: 'Node',
          assetCode: `N-${nodeId.slice(0, 8)}`,
          geometry: { type: 'Point', coordinates: [point] },
          attributes: { nodeType: 'Junction' },
        })
        return nodeId
      })
      base.fromRef = endpoints[0]!
      base.toRef = endpoints[1]!
      const graph = visibleAssets(state(), next)
      coordinates[0] = graph[endpoints[0]!]!.asset.geometry.coordinates[0]!
      coordinates[coordinates.length - 1] = graph[endpoints[1]!]!.asset.geometry.coordinates[0]!
    }
    if (kind === 'Device' && selected() && visible()[selected()!]?.asset.kind !== 'Device')
      base.hostRef = selected()
    commit(editAsset(state(), next, id, base))
    setSelected(id)
    setTool('select')
    setNotice(
      kind === 'Pipe'
        ? 'Đã thêm ống và nút ở đầu ống chưa có kết nối. Kiểm tra đường kính, vật liệu trước khi lưu.'
        : 'Đã thêm đối tượng vào bản nháp. Kiểm tra thuộc tính bên phải.'
    )
  }
  function modify(event: GeometryEditComplete) {
    if (
      !editable() ||
      !geometryTarget ||
      targetContext !== context() ||
      event.gestureKey !== geometryTarget.gestureKey ||
      event.featureId !== selected()
    )
      return
    try {
      const geometry = event.geometry
      if (geometry.type !== 'Point' && geometry.type !== 'LineString')
        throw new Error('Hình học không hợp lệ.')
      const positions = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates
      if (positions.some(p => p.length !== 2 || !p.every(Number.isFinite)))
        throw new Error('Tọa độ không hợp lệ.')
      const next = modifyAssetGeometry(state(), edits(), event.featureId, {
        type: geometry.type,
        coordinates: positions.map(p => [p[0]!, p[1]!] as Point),
      })
      if (next !== edits()) commit(next)
    } catch (e) {
      setError((e as Error).message)
      cancelGeometry()
      setGeometryRefresh(v => v + 1)
    }
  }
  createEffect(() => {
    const port = map.port()
    if (!port) return
    port.setBasemap('osm')
    port.setDrawMeasure(true)
    const off = [
      port.onFeatureClick(id => {
        if (tool() === 'select') setSelected(id)
      }),
      port.onDrawComplete(draw),
      port.onGeometryEditComplete(modify),
      port.onGeometryVertexSelect(setVertex),
      port.onFeaturePointPick((id, p) => {
        if (tool() !== 'split' || !editable()) return
        try {
          commit(splitPipe(state(), edits(), id, [p.lon, p.lat]))
          setTool('select')
          setNotice('Đã tách ống và thêm nút chung. Rà soát các thay đổi trước khi lưu.')
        } catch (e) {
          setError((e as Error).message)
        }
      }),
    ]
    onCleanup(() => {
      cancelGeometry()
      off.forEach(fn => fn())
    })
  })
  createEffect(() => {
    const port = map.port()
    if (!port) return
    const active = editable() ? tool() : 'select'
    port.setDrawMode(
      active === 'pipe' ? 'LineString' : active === 'node' || active === 'device' ? 'Point' : null
    )
    port.setModifyMode(false)
    port.setFeaturePointMode(active === 'split')
    port.setSnapModes({ node: snap(), vertex: snap(), edge: false })
  })
  createEffect(() => {
    const port = map.port()
    if (!port) return
    geometryRefresh()
    const currentContext = context()
    if (currentContext !== targetContext) cancelGeometry()
    const displayedEdits = revision()?.status === 'Published' ? [] : edits()
    const changed = new Map(displayedEdits.map(e => [e.targetId ?? e.id, e.action]))
    const groups: Record<string, FeatureCollection> = {
      published: { type: 'FeatureCollection', features: [] },
      draft: { type: 'FeatureCollection', features: [] },
      removed: { type: 'FeatureCollection', features: [] },
    }
    const add = (id: string, a: Asset, layer: string, action?: string) =>
      groups[layer]!.features.push({
        type: 'Feature',
        id,
        properties: { kind: a.kind, action, code: a.assetCode },
        geometry:
          a.geometry.type === 'Point'
            ? { type: 'Point', coordinates: a.geometry.coordinates[0]! }
            : { type: 'LineString', coordinates: a.geometry.coordinates },
      })
    for (const [id, { asset: a }] of Object.entries(visible()))
      add(id, a, changed.has(id) || selected() === id ? 'draft' : 'published', changed.get(id))
    for (const e of displayedEdits)
      if (e.action === 'Delete' && e.before) add(e.targetId!, e.before, 'removed', 'Delete')
    for (const [layer, features] of Object.entries(groups))
      port.setFeatures(layer, features, p => {
        const color =
          p.action === 'Delete'
            ? '#c6423c'
            : p.action === 'Add'
              ? '#21854f'
              : p.action === 'Update'
                ? '#c87812'
                : '#237cb1'
        return {
          stroke: {
            color,
            width: p.__selected ? 5 : 3,
            dash: p.action === 'Delete' ? [6, 5] : undefined,
          },
          image: {
            shape: p.kind === 'Device' ? 'diamond' : 'circle',
            radius: p.__selected ? 7 : 4,
            color,
            stroke: '#fff',
            strokeWidth: 1.5,
          },
          halo: p.__selected ? { color: '#f8d557', width: 9 } : undefined,
        }
      })
    port.setSelection(selected())
    const a = visible()[selected() ?? '']?.asset
    if (editable() && a && (tool() === 'modify' || (tool() === 'segment' && a.kind === 'Pipe'))) {
      try {
        const locks = a.kind === 'Pipe' ? pipeEndpointLocks(state(), edits(), selected()!) : []
        if (!geometryTarget) {
          targetContext = currentContext
          geometryTarget = {
            featureId: selected()!,
            mode: tool() === 'segment' ? 'segment' : 'vertex',
            lockedEndpointIndices: locks,
            gestureKey: `${currentContext}:${toolGeneration}`,
          }
        }
        geometryTarget = { ...geometryTarget, lockedEndpointIndices: locks }
        port.setGeometryEditTarget(geometryTarget)
      } catch (e) {
        setError((e as Error).message)
        cancelGeometry()
      }
    }

    if (!fitted && Object.keys(state()).length) {
      fitted = true
      fit(Object.values(state()).map(x => x.asset))
    }
  })
  async function open(id: string) {
    if (
      dirty() &&
      !window.confirm(
        'Bản nháp có thay đổi chưa lưu. Chuyển hồ sơ? Bản phục hồi cục bộ vẫn được giữ.'
      )
    )
      return
    await run(async client => {
      const [r, latest] = await Promise.all([client.get(id), client.assets()])
      setState(latest)
      receive(r)
      setIssues([])
      setNotice('Đã mở bản nháp trên máy chủ.')
      try {
        const backup = JSON.parse(localStorage.getItem(backupKey()) ?? 'null')
        if (
          backup &&
          backup.version === r.version &&
          window.confirm('Có thay đổi chưa lưu từ lần trước. Khôi phục để tiếp tục chỉnh sửa?')
        ) {
          setEdits(backup.edits)
          setDirty(true)
          setNotice('Đã khôi phục thay đổi cục bộ; bấm Lưu nháp để lưu lên máy chủ.')
        } else if (backup && backup.version !== r.version)
          setNotice(
            'Có bản phục hồi cũ nhưng máy chủ đã có phiên bản mới. Bản cũ không được ghi đè tự động.'
          )
      } catch {
        /* invalid local recovery does not replace server data */
      }
      fit((r.operations ?? []).flatMap(e => (e.after ? [e.after] : e.before ? [e.before] : [])))
    })
  }
  async function save(client: EditorApi) {
    if (!revision()) return
    const result = await client.save(revision()!, edits())
    forget()
    setRevision(result)
    setEdits(result.operations ?? [])
    setDirty(false)
    setIssues(result.errors ?? [])
    setNotice('Đã lưu bản nháp trên máy chủ. Mạng chính thức chưa thay đổi.')
  }
  async function act(action: 'validate' | 'submit' | 'approve' | 'reject') {
    await run(async client => {
      if (!revision()) return
      if (dirty()) await save(client)
      const result = await client.action(revision()!.id, action, reason())
      setIssues(result.errors ?? [])
      setRevision(await client.get(revision()!.id))
      setRevisions(await client.list())
      setNotice(
        action === 'validate'
          ? result.isValid
            ? 'Không còn lỗi. Có thể gửi duyệt.'
            : 'Chọn từng lỗi bên phải để đến đối tượng cần sửa.'
          : action === 'submit'
            ? 'Đã gửi duyệt. Hồ sơ được khóa chỉnh sửa.'
            : action === 'approve'
              ? 'Đã duyệt. Bấm Kiểm tra kết quả để xác nhận mạng đã cập nhật.'
              : 'Đã trả lại hồ sơ để chỉnh sửa.'
      )
    })
  }
  function change(patch: Partial<Asset>) {
    const a = asset(),
      id = selected()
    if (a && id) commit(editAsset(state(), edits(), id, { ...a, ...patch }))
  }
  function connect(field: 'fromRef' | 'toRef', id: string) {
    const a = asset(),
      node = visible()[id]?.asset
    if (!a || !node) return
    const coords = a.geometry.coordinates.map(p => [...p] as Point)
    coords[field === 'fromRef' ? 0 : coords.length - 1] = node.geometry.coordinates[0]!
    change({ [field]: id, geometry: { ...a.geometry, coordinates: coords } })
  }
  const filtered = () =>
    Object.entries(visible())
      .filter(([id, { asset: a }]) =>
        `${id} ${a.assetCode} ${kinds[a.kind]}`.toLowerCase().includes(search().toLowerCase())
      )
      .slice(0, 100)
  return (
    <section class="network-editor">
      <div class="ne-header">
        <div>
          <h1>Biên tập mạng lưới</h1>
          <p>Chọn đối tượng trên bản đồ → chỉnh sửa → lưu nháp → gửi duyệt</p>
        </div>
        <div class="ne-actions">
          <select
            aria-label="Mở bản nháp biên tập"
            value={revision()?.id ?? ''}
            disabled={busy()}
            onChange={e => void open(e.currentTarget.value)}
          >
            <option value="" disabled>
              Chọn bản nháp đã lưu
            </option>
            <For each={revisions()}>
              {r => (
                <option value={r.id}>
                  {new Date(r.updatedAt).toLocaleString('vi-VN')} · {labels[r.status] ?? r.status} ·{' '}
                  {r.id.slice(-6)}
                </option>
              )}
            </For>
          </select>
          <button
            disabled={!canWrite() || busy()}
            onClick={() => {
              if (dirty() && !window.confirm('Tạo hồ sơ khác khi chưa lưu thay đổi?')) return
              void run(async client => {
                setState(await client.assets())
                const r = await client.create('Biên tập mạng ' + new Date().toLocaleString('vi-VN'))
                receive(r)
                setIssues([])
                setRevisions(await client.list())
                setNotice(
                  'Đã tạo bản nháp. Bây giờ bạn có thể thêm, sửa hoặc xóa đối tượng trên bản đồ.'
                )
              })
            }}
          >
            Tạo bản nháp mới
          </button>
        </div>
      </div>
      <Show when={error()}>
        <div class="ne-error" role="alert">
          {error()} <button onClick={() => setError('')}>Đóng</button>
        </div>
      </Show>
      <Show when={notice()}>
        <div class="ne-notice" role="status">
          {notice()}
        </div>
      </Show>
      <Show when={!revision()}>
        <div class="ne-notice">
          {busy()
            ? 'Đang tải mạng lưới…'
            : 'Mạng chính thức đang ở chế độ xem. Tạo hoặc mở bản nháp để biên tập. Nhập CAD nằm ở mục Import CAD riêng.'}
        </div>
      </Show>
      <div class="ne-toolbar" aria-label="Công cụ biên tập">
        <For
          each={
            [
              ['select', 'Chọn'],
              ['pipe', 'Vẽ ống'],
              ['node', 'Thêm nút'],
              ['device', 'Thêm thiết bị'],
              ['modify', 'Sửa đỉnh'],
              ['segment', 'Kéo đoạn'],
              ['split', 'Tách ống'],
            ] as [Tool, string][]
          }
        >
          {([id, title]) => (
            <button
              aria-pressed={tool() === id}
              disabled={
                id !== 'select' &&
                (!editable() ||
                  ((id === 'modify' || id === 'segment') &&
                    (!visible()[selected() ?? ''] ||
                      (id === 'segment' && asset()?.kind !== 'Pipe'))))
              }
              onClick={() => setTool(id)}
            >
              {title}
            </button>
          )}
        </For>
        <button
          disabled={!deletableVertex()}
          onClick={() => map.port()?.deleteSelectedGeometryVertex()}
        >
          Xóa đỉnh
        </button>
        <button disabled={!editable() || !undo().length} onClick={() => history(true)}>
          Hoàn tác
        </button>
        <button disabled={!editable() || !redo().length} onClick={() => history(false)}>
          Làm lại
        </button>
        <label>
          <input
            type="checkbox"
            checked={snap()}
            onChange={e => setSnap(e.currentTarget.checked)}
          />{' '}
          Bắt điểm nút
        </label>
        <button onClick={() => fit(Object.values(visible()).map(x => x.asset))}>Vừa mạng</button>
        <Show when={revision()}>
          <span class="ne-status">
            {dirty() ? 'Có thay đổi chưa lưu' : (labels[revision()!.status] ?? revision()!.status)}
          </span>
          <button class="ne-primary" disabled={!editable()} onClick={() => void run(save)}>
            Lưu nháp
          </button>
        </Show>
      </div>
      <div class="ne-layout">
        <div class="ne-map">
          <div ref={map.containerRef} class="ne-map-canvas" aria-label="Bản đồ biên tập mạng" />
          <div class="ne-map-zoom">
            <button
              aria-label="Phóng to"
              onClick={() => {
                const p = map.port()
                if (p) {
                  const v = p.getView()
                  p.setView({ ...v, zoom: v.zoom + 1 })
                }
              }}
            >
              +
            </button>
            <button
              aria-label="Thu nhỏ"
              onClick={() => {
                const p = map.port()
                if (p) {
                  const v = p.getView()
                  p.setView({ ...v, zoom: v.zoom - 1 })
                }
              }}
            >
              −
            </button>
          </div>
          <div class="ne-attribution">
            ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap contributors
            </a>
          </div>
          <div class="ne-map-legend">
            <span style={{ color: '#21854f' }}>● Thêm</span> ·{' '}
            <span style={{ color: '#c87812' }}>● Sửa</span> ·{' '}
            <span style={{ color: '#c6423c' }}>┄ Xóa</span> · EPSG:4326
          </div>
        </div>
        <aside class="ne-panel" aria-label="Thuộc tính và thay đổi">
          <p class="ne-hint">
            {tool() === 'pipe'
              ? 'Bấm từng đỉnh; bấm đúp để kết thúc ống. Đầu chưa có nút sẽ tạo nút mới.'
              : tool() === 'modify'
                ? 'Kéo đỉnh hoặc điểm giữa để thêm đỉnh. Đầu ống nối nút được khóa. Chọn đỉnh trong để Xóa đỉnh; Esc để hủy.'
                : tool() === 'segment'
                  ? 'Kéo giữa đoạn để di chuyển đoạn; hai đầu ngoài của ống giữ nguyên. Esc để hủy.'
                  : tool() === 'split'
                    ? 'Chọn ống trước, sau đó bấm vị trí giữa ống để tách.'
                    : tool() === 'node' || tool() === 'device'
                      ? 'Bấm lên bản đồ để đặt đối tượng mới.'
                      : 'Bấm vào ống, nút hoặc thiết bị để xem và sửa thuộc tính.'}
          </p>
          <label>
            Tìm đối tượng
            <input
              placeholder="Mã ống, nút, thiết bị…"
              value={search()}
              onInput={e => setSearch(e.currentTarget.value)}
            />
          </label>
          <select
            aria-label="Chọn đối tượng mạng"
            value={selected() ?? ''}
            onChange={e => focus(e.currentTarget.value)}
          >
            <option value="">Chọn đối tượng (100 kết quả đầu)</option>
            <For each={filtered()}>
              {([id, { asset: a }]) => (
                <option value={id}>
                  {kinds[a.kind]} · {a.assetCode}
                </option>
              )}
            </For>
          </select>
          <Show when={asset()}>
            {a => (
              <div>
                <h2>
                  {kinds[a().kind]} · {a().assetCode}
                </h2>
                <p class="ne-hint">
                  {selectedEdit()
                    ? actions[selectedEdit()!.action] + ' trong bản nháp'
                    : 'Đang dùng trên mạng chính thức'}
                </p>
                <fieldset disabled={!editable() || selectedEdit()?.action === 'Delete'}>
                  <label>
                    Mã đối tượng
                    <input
                      readOnly={!!state()[selected() ?? '']}
                      value={a().assetCode}
                      onChange={e => change({ assetCode: e.currentTarget.value })}
                    />
                  </label>
                  <Show when={a().kind === 'Node'}>
                    <label>
                      Loại nút
                      <select
                        value={a().attributes.nodeType}
                        onChange={e =>
                          change({
                            attributes: { ...a().attributes, nodeType: e.currentTarget.value },
                          })
                        }
                      >
                        <For each={['Junction', 'Reservoir', 'Tank', 'Hydrant', 'Other']}>
                          {t => (
                            <option value={t}>
                              {
                                {
                                  Junction: 'Nút nối',
                                  Reservoir: 'Nguồn / hồ',
                                  Tank: 'Bể chứa',
                                  Hydrant: 'Trụ cứu hỏa',
                                  Other: 'Khác',
                                }[t]
                              }
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                  </Show>
                  <Show when={a().kind === 'Pipe'}>
                    <label>
                      Đường kính (mm)
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={a().attributes.diameterMm}
                        onChange={e =>
                          change({
                            attributes: { ...a().attributes, diameterMm: e.currentTarget.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      Vật liệu
                      <select
                        value={a().attributes.material}
                        onChange={e =>
                          change({
                            attributes: { ...a().attributes, material: e.currentTarget.value },
                          })
                        }
                      >
                        <For each={['HDPE', 'PVC', 'DuctileIron', 'Steel', 'CastIron', 'Concrete']}>
                          {m => <option>{m}</option>}
                        </For>
                      </select>
                    </label>
                    <For each={['fromRef', 'toRef'] as const}>
                      {field => (
                        <label>
                          {field === 'fromRef' ? 'Nút đầu' : 'Nút cuối'}
                          <select
                            value={a()[field] ?? ''}
                            onChange={e => connect(field, e.currentTarget.value)}
                          >
                            <option value="" disabled selected={!a()[field]}>
                              Chọn nút kết nối
                            </option>
                            <For
                              each={Object.entries(visible()).filter(
                                ([, v]) => v.asset.kind === 'Node'
                              )}
                            >
                              {([id, v]) => (
                                <option value={id} selected={a()[field] === id}>
                                  {v.asset.assetCode}
                                </option>
                              )}
                            </For>
                          </select>
                        </label>
                      )}
                    </For>
                  </Show>
                  <Show when={a().kind === 'Device'}>
                    <label>
                      Loại thiết bị
                      <select
                        value={a().attributes.deviceType}
                        onChange={e =>
                          change({
                            attributes: { ...a().attributes, deviceType: e.currentTarget.value },
                          })
                        }
                      >
                        <For each={['Valve', 'Pump', 'FlowMeter', 'PressureSensor', 'Hydrant']}>
                          {t => <option>{t}</option>}
                        </For>
                      </select>
                    </label>
                    <label>
                      Gắn vào ống / nút
                      <select
                        value={a().hostRef ?? ''}
                        onChange={e => change({ hostRef: e.currentTarget.value })}
                      >
                        <option value="">Chọn đối tượng gắn</option>
                        <For
                          each={Object.entries(visible()).filter(
                            ([, v]) => v.asset.kind !== 'Device'
                          )}
                        >
                          {([id, v]) => (
                            <option value={id}>
                              {kinds[v.asset.kind]} · {v.asset.assetCode}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                  </Show>
                  <div class="ne-actions">
                    <button onClick={() => setTool('modify')}>Sửa trên bản đồ</button>
                    <button
                      class="ne-delete"
                      onClick={() => {
                        commit(editAsset(state(), edits(), selected()!, null))
                        setTool('select')
                      }}
                    >
                      Đánh dấu xóa
                    </button>
                  </div>
                </fieldset>
                <Show when={selectedEdit()?.before}>
                  <details>
                    <summary>Thông tin trước khi sửa</summary>
                    <p>Mã: {selectedEdit()!.before!.assetCode}</p>
                    <For each={Object.entries(selectedEdit()!.before!.attributes)}>
                      {([k, v]) => (
                        <p>
                          {k}: {v}
                        </p>
                      )}
                    </For>
                    <p>{selectedEdit()!.before!.geometry.coordinates.length} điểm tọa độ</p>
                  </details>
                </Show>
              </div>
            )}
          </Show>
          <details open>
            <summary>Thay đổi trong bản nháp ({edits().length})</summary>
            <For each={edits()}>
              {e => (
                <div class="ne-change">
                  <button onClick={() => focus(e.targetId ?? e.id)}>
                    {actions[e.action]} · {e.after?.assetCode ?? e.before?.assetCode}
                  </button>
                  <button
                    disabled={!editable()}
                    aria-label={'Bỏ thay đổi ' + (e.after?.assetCode ?? e.before?.assetCode)}
                    onClick={() => commit(edits().filter(x => x.id !== e.id))}
                  >
                    ↶
                  </button>
                </div>
              )}
            </For>
            <Show when={!edits().length}>
              <p class="ne-hint">Chưa có thay đổi.</p>
            </Show>
          </details>
          <Show when={revision()}>
            <h2>Kiểm tra & gửi duyệt</h2>
            <div class="ne-actions">
              <button disabled={!editable()} onClick={() => void act('validate')}>
                Kiểm tra dữ liệu
              </button>
              <button
                class="ne-primary"
                disabled={!canWrite() || busy() || dirty() || revision()?.status !== 'Validated'}
                onClick={() => void act('submit')}
              >
                Gửi duyệt
              </button>
            </div>
            <For each={issues()}>
              {issue => (
                <button
                  class="ne-issue"
                  onClick={() => {
                    const e = edits().find(x => x.id === (issue.operationId ?? issue.draftAssetId))
                    if (e) focus(e.targetId ?? e.id)
                  }}
                >
                  {issue.message}
                </button>
              )}
            </For>
            <Show when={revision()?.status === 'Submitted' && canApprove()}>
              <label>
                Ý kiến duyệt / lý do trả lại
                <textarea value={reason()} onInput={e => setReason(e.currentTarget.value)} />
              </label>
              <div class="ne-actions">
                <button disabled={busy()} onClick={() => void act('approve')}>
                  Duyệt cập nhật mạng
                </button>
                <button disabled={busy() || !reason().trim()} onClick={() => void act('reject')}>
                  Trả lại để sửa
                </button>
              </div>
            </Show>
            <Show
              when={['Approved', 'Published', 'PartiallyPublished'].includes(revision()!.status)}
            >
              <button
                disabled={busy()}
                onClick={() =>
                  void run(async client => {
                    const r = await client.get(revision()!.id)
                    setRevision(r)
                    if (r.status === 'Published') {
                      setState(await client.assets())
                      setNotice('Đã cập nhật thành công mạng chính thức.')
                    } else if (r.status === 'PartiallyPublished') {
                      const results = await client.results(r.id)
                      setError(
                        results
                          .map(x => x.reason)
                          .filter(Boolean)
                          .join('\n') ||
                          'Không áp dụng thay đổi do xung đột. Tạo bản nháp mới từ mạng hiện tại.'
                      )
                    } else setNotice('Máy chủ đang xử lý. Kiểm tra lại sau.')
                  })
                }
              >
                Kiểm tra kết quả
              </button>
            </Show>
          </Show>
        </aside>
      </div>
      <details class="ne-guide">
        <summary>Hướng dẫn thao tác</summary>
        <ol>
          <li>
            Tạo bản nháp mới hoặc mở bản đã lưu. Mạng chính thức vẫn giữ nguyên trong khi chỉnh sửa.
          </li>
          <li>
            Chọn đối tượng để đổi thuộc tính; dùng Vẽ ống, Thêm nút, Thêm thiết bị để bổ sung.
          </li>
          <li>
            Sửa đỉnh hoặc Kéo đoạn để kéo hình học. Khi di chuyển nút, các đầu ống liên quan cùng
            được điều chỉnh trong bản nháp.
          </li>
          <li>
            Đánh dấu xóa có thể hoàn tác. Nếu còn liên kết, phần kiểm tra sẽ chỉ rõ ống hoặc thiết
            bị cần xử lý.
          </li>
          <li>
            Lưu nháp kể cả khi còn lỗi. Kiểm tra dữ liệu, bấm từng lỗi để đến vị trí cần sửa; hết
            lỗi thì Gửi duyệt.
          </li>
          <li>
            Người có quyền duyệt xem danh sách thay đổi, duyệt hoặc trả lại. Kiểm tra kết quả để xác
            nhận đã cập nhật mạng.
          </li>
        </ol>
      </details>
    </section>
  )
}
