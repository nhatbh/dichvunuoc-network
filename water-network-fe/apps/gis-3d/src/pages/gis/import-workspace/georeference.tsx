import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import { createMapInstance, type Map3DPort } from '@wn/map-runtime-3d'
import { isProcessing, type CadFeature, type ControlPoint } from './types'
import { SourceCrsPanel } from './source-crs-panel'
import type { createImportWorkspace } from './workspace'
import { importButton as button, importField as field } from './ui'
import {
  authoritativeOverlay,
  controlPointFeatures,
  controlPointId,
  geographicExtent,
  inspectControlPoints,
  isGeographicPair,
  type CoordinatePair,
} from './georeference-model'

export interface GeoreferenceWorkbenchProps {
  workspace: ReturnType<typeof createImportWorkspace>
  pendingCadPoint: CoordinatePair | null
  onRequestCadPoint: () => void
  onClearCadPoint: () => void
  onCancelCadPoint?: () => void
  cancelPickToken?: number
  onActiveControlPointChange?: (index: number | null) => void
  features?: CadFeature[]
  geographicFeatures?: CadFeature[]
  fileId?: string
}

function CoordinateFields(props: {
  value: CoordinatePair | null
  label: string
  geographic?: boolean
  disabled: boolean
  onChange: (value: CoordinatePair | null) => void
}) {
  const [first, setFirst] = createSignal('')
  const [second, setSecond] = createSignal('')
  const coordinateKey = createMemo(() => props.value?.join(',') ?? '')
  createEffect(
    on(coordinateKey, () => {
      const pair = props.value
      setFirst(pair ? String(pair[0]) : '')
      setSecond(pair ? String(pair[1]) : '')
    })
  )
  const update = () => {
    if (!first().trim() || !second().trim()) {
      props.onChange(null)
      return
    }
    const pair: CoordinatePair = [Number(first()), Number(second())]
    if (pair.every(Number.isFinite)) props.onChange(pair)
  }
  return (
    <div class="grid min-w-0 grid-cols-2 gap-1">
      <input
        aria-label={`${props.label} ${props.geographic ? 'kinh độ' : 'X'}`}
        class={`${field} min-w-0 !px-2 !py-1 font-mono !text-[11px]`}
        type="number"
        step="any"
        disabled={props.disabled}
        value={first()}
        onInput={e => setFirst(e.currentTarget.value)}
        onChange={update}
        placeholder={props.geographic ? 'Kinh độ' : 'X'}
      />
      <input
        aria-label={`${props.label} ${props.geographic ? 'vĩ độ' : 'Y'}`}
        class={`${field} min-w-0 !px-2 !py-1 font-mono !text-[11px]`}
        type="number"
        step="any"
        disabled={props.disabled}
        value={second()}
        onInput={e => setSecond(e.currentTarget.value)}
        onChange={update}
        placeholder={props.geographic ? 'Vĩ độ' : 'Y'}
      />
    </div>
  )
}

export function GeoreferenceWorkbench(props: GeoreferenceWorkbenchProps) {
  const w = props.workspace
  const [mode, setMode] = createSignal<'source' | 'points'>(
    w.config()?.controlPoints?.length ? 'points' : 'source'
  )
  const [port, setPort] = createSignal<Map3DPort | null>(null)
  const [mapError, setMapError] = createSignal('')
  const [active, setActive] = createSignal<number | null>(null)
  const [waitingCad, setWaitingCad] = createSignal(false)
  const [pickingGis, setPickingGis] = createSignal(false)
  const [basemap, setBasemap] = createSignal('osm')
  const [searchLon, setSearchLon] = createSignal('')
  const [searchLat, setSearchLat] = createSignal('')
  const [locationError, setLocationError] = createSignal('')
  const [evidenceConfirmed, setEvidenceConfirmed] = createSignal(false)
  const [evidenceDraft, setEvidenceDraft] = createSignal(w.config()?.crsEvidence ?? '')
  let container: HTMLDivElement | undefined
  let disposed = false
  let ignoreFeatureClickUntil = 0
  let releaseDraw: (() => void) | undefined
  let releaseClick: (() => void) | undefined
  const points = createMemo(() => w.config()?.controlPoints ?? [])
  const inspection = createMemo(() => inspectControlPoints(points()))
  const legacyMode = createMemo(
    () => !!points().length && w.config()?.controlPointTargetCrs !== 'EPSG:4326'
  )
  const pointModeConflict = createMemo(
    () =>
      legacyMode() ||
      !!w.config()?.sourceCrs?.trim() ||
      !!w.config()?.fileCrs?.length ||
      (w.config()?.sourceAxisOrder ?? 'xy') !== 'xy' ||
      (w.config()?.sourceUnits ?? 'm') !== 'm'
  )
  const geographicDiagnostics = createMemo(() => w.job()?.georeference)
  const currentResult = createMemo(() =>
    !w.dirty() && !isProcessing(w.job()) && geographicDiagnostics()?.targetCrs === 'EPSG:4326'
      ? geographicDiagnostics()
      : null
  )
  const overlay = createMemo(() =>
    authoritativeOverlay(
      w.preview()?.drawing?.features ?? props.geographicFeatures ?? w.preview()?.features ?? [],
      w.preview()?.drawing?.coordinateSpace ??
        (props.geographicFeatures ? 'EPSG:4326' : (w.preview()?.coordinateSpace ?? 'cad')),
      !w.dirty() &&
        !isProcessing(w.job()) &&
        w.preview()?.version === w.job()?.version &&
        (w.config()?.controlPointTargetCrs === 'EPSG:4326' || !!points().length
          ? currentResult()?.status === 'valid'
          : !!w.config()?.sourceCrs?.trim())
    )
  )
  const overlayExtent = createMemo<[number, number, number, number] | null>(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const feature of overlay().features) {
      const geometry = feature.geometry
      const coordinates =
        geometry.type === 'Point'
          ? [geometry.coordinates]
          : geometry.type === 'LineString'
            ? geometry.coordinates
            : []
      for (const point of coordinates)
        if (isGeographicPair(point)) {
          minX = Math.min(minX, point[0])
          minY = Math.min(minY, point[1])
          maxX = Math.max(maxX, point[0])
          maxY = Math.max(maxY, point[1])
        }
    }
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
  })
  createEffect(() => {
    const instance = port(),
      extent = overlayExtent()
    if (instance && extent) instance.fitToBbox(extent, { padding: 50, maxZoom: 19 })
  })
  const chooseRow = (index: number | null) => {
    setActive(index)
    props.onActiveControlPointChange?.(index)
  }
  const patchPoint = (index: number, patch: Partial<ControlPoint>) => {
    if (w.locked() || legacyMode()) return
    setEvidenceConfirmed(false)
    w.edit(config => ({
      ...config,
      crsEvidence: '',
      controlPoints: (config.controlPoints ?? []).map((point, i) =>
        i === index ? { ...point, ...patch } : point
      ),
    }))
  }
  const cancelPicks = () => {
    setWaitingCad(false)
    setPickingGis(false)
    props.onCancelCadPoint?.()
    props.onClearCadPoint()
  }
  createEffect(on(() => props.cancelPickToken ?? 0, cancelPicks, { defer: true }))
  const requestCad = (index: number) => {
    chooseRow(index)
    setWaitingCad(true)
    setPickingGis(false)
    props.onClearCadPoint()
    props.onRequestCadPoint()
  }
  const requestGis = (index: number) => {
    chooseRow(index)
    setWaitingCad(false)
    props.onCancelCadPoint?.()
    props.onClearCadPoint()
    setPickingGis(true)
  }
  const addPoint = () => {
    if (w.locked() || points().length >= 100 || pointModeConflict()) return
    const index = points().length
    w.edit(config => ({
      ...config,
      sourceCrs: null,
      sourceAxisOrder: 'xy',
      sourceUnits: 'm',
      sourceCrsPresetId: null,
      fileCrs: [],
      controlPointTargetCrs: 'EPSG:4326',
      crsEvidence: '',
      controlPoints: [
        ...(config.controlPoints ?? []),
        { source: null, target: null, checkOnly: index >= 3 },
      ],
    }))
    setEvidenceConfirmed(false)
    requestCad(index)
  }
  createEffect(
    on(
      () => props.pendingCadPoint,
      pair => {
        const index = active()
        if (!waitingCad() || !pair || index === null || !points()[index]) return
        patchPoint(index, { source: [pair[0], pair[1]] })
        setWaitingCad(false)
        props.onClearCadPoint()
        requestGis(index)
      }
    )
  )
  const jobKey = createMemo(() => w.job()?.id)
  createEffect(
    on(jobKey, () => {
      chooseRow(null)
      setWaitingCad(false)
      setPickingGis(false)
      setEvidenceConfirmed(false)
      setMode(w.config()?.controlPoints?.length ? 'points' : 'source')
      setEvidenceDraft(w.config()?.crsEvidence ?? '')
      setSearchLon('')
      setSearchLat('')
      setLocationError('')
    })
  )
  onMount(async () => {
    try {
      // Initial view is a country overview, never an inferred drawing position.
      const instance = await createMapInstance({
        center: { lon: 106, lat: 16 },
        zoom: 5,
        minZoom: 2,
        maxZoom: 22,
      })
      if (disposed) {
        instance.destroy()
        return
      }
      if (container) instance.mount(container)
      instance.setSnapModes({ node: false, vertex: false, edge: false })
      releaseDraw = instance.onDrawComplete(geometry => {
        if (!pickingGis() || geometry.type !== 'Point' || active() === null || w.locked()) return
        const pair: CoordinatePair = [geometry.coordinates[0]!, geometry.coordinates[1]!]
        if (!isGeographicPair(pair)) {
          setLocationError('Điểm GIS nằm ngoài giới hạn tọa độ hợp lệ.')
          return
        }
        ignoreFeatureClickUntil = Date.now() + 400
        patchPoint(active()!, { target: pair })
        setPickingGis(false)
      })
      releaseClick = instance.onFeatureClick(id => {
        if (pickingGis() || Date.now() < ignoreFeatureClickUntil) return
        const index = points().findIndex((_, i) => controlPointId(i) === id)
        if (index >= 0) chooseRow(index)
      })
      setPort(instance)
      const extent = geographicExtent(
        points().flatMap(point => (point.target ? [point.target] : []))
      )
      if (extent && !legacyMode()) instance.fitToBbox(extent, { padding: 50, maxZoom: 18 })
    } catch {
      if (!disposed)
        setMapError(
          'Chưa tải được bản đồ nền. Có thể nhập kinh độ / vĩ độ bên dưới hoặc mở lại bước định vị.'
        )
    }
  })
  onCleanup(() => {
    disposed = true
    releaseDraw?.()
    releaseClick?.()
    port()?.destroy()
  })
  createEffect(() => {
    port()?.setBasemap(basemap())
  })
  createEffect(() => {
    port()?.setDrawMode(pickingGis() && !w.locked() ? 'Point' : null)
  })
  createEffect(() => {
    const instance = port()
    if (!instance) return
    instance.setFeatures('georeferenced-cad', overlay(), () => ({
      stroke: { color: '#0369a1', width: 2 },
      image: { shape: 'circle', radius: 4, color: '#0369a1' },
    }))
    instance.setFeatures(
      'control-points',
      controlPointFeatures(legacyMode() ? [] : points(), active()),
      properties => ({
        text: {
          value: String(properties.index),
          color: '#fff',
          font: '600 11px sans-serif',
          offsetY: 0,
        },
        image: {
          shape: properties.checkOnly ? 'diamond' : 'circle',
          radius: properties.active ? 9 : 7,
          color: properties.checkOnly ? '#b45309' : '#0369a1',
          stroke: '#fff',
          strokeWidth: 2,
        },
      })
    )
  })
  const zoom = (delta: number) => {
    const instance = port()
    if (!instance) return
    const view = instance.getView()
    instance.setView({ ...view, zoom: Math.max(2, Math.min(22, view.zoom + delta)) })
  }
  const fitPoints = () => {
    const extent = geographicExtent(points().flatMap(point => (point.target ? [point.target] : [])))
    if (extent && !legacyMode()) port()?.fitToBbox(extent, { padding: 60, maxZoom: 19 })
  }
  const goTo = () => {
    const pair: CoordinatePair = [Number(searchLon()), Number(searchLat())]
    if (!searchLon().trim() || !searchLat().trim() || !isGeographicPair(pair)) {
      setLocationError('Nhập kinh độ và vĩ độ hợp lệ để đến vị trí.')
      return
    }
    setLocationError('')
    port()?.setView({ center: { lon: pair[0], lat: pair[1] }, zoom: 18 })
  }
  const switchMode = (next: 'source' | 'points') => {
    cancelPicks()
    setMode(next)
  }
  const resetForPoints = () => {
    if (w.locked()) return
    cancelPicks()
    chooseRow(null)
    setEvidenceConfirmed(false)
    w.edit(config => ({
      ...config,
      sourceCrs: null,
      sourceAxisOrder: 'xy',
      sourceUnits: 'm',
      sourceCrsPresetId: null,
      fileCrs: [],
      controlPoints: [],
      controlPointTargetCrs: 'EPSG:4326',
      crsEvidence: '',
    }))
  }
  const savePoints = async () => {
    if (w.locked() || legacyMode()) return
    await w.save()
    if (!w.error()) w.setView('clean')
  }
  const canAnalyze = () =>
    !w.locked() &&
    !legacyMode() &&
    !inspection().error &&
    !!w.config()?.crsEvidence.trim() &&
    evidenceConfirmed()

  return (
    <section
      aria-label="Định vị bản vẽ bằng điểm GIS"
      class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--surface)]"
    >
      <div
        role="tablist"
        aria-label="Cách định vị bản vẽ"
        class="flex flex-wrap gap-1 border-b border-line p-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode() === 'source'}
          class={`${button} flex-1 !px-2 !py-1.5`}
          classList={{ 'bg-sky-50': mode() === 'source' }}
          onClick={() => switchMode('source')}
        >
          VN-2000 / Hệ tọa độ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode() === 'points'}
          class={`${button} flex-1 !px-2 !py-1.5`}
          classList={{ 'bg-sky-50': mode() === 'points' }}
          onClick={() => switchMode('points')}
        >
          Ghép điểm CAD–GIS
        </button>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div>
          <h3 class="text-xs font-semibold">Bản đồ thực địa</h3>
          <p class="mt-0.5 text-[10px] text-[color:var(--muted)]">
            {mode() === 'points'
              ? 'Ghép CAD → GIS · 3 điểm ghép + 1 điểm kiểm tra'
              : 'Xem vị trí trước khi xác nhận tọa độ'}
          </p>
        </div>
        <select
          aria-label="Nền bản đồ định vị"
          class={`${field} !w-auto !py-1`}
          value={basemap()}
          onChange={e => setBasemap(e.currentTarget.value)}
        >
          <option value="osm">Đường phố</option>
          <option value="satellite">Ảnh vệ tinh</option>
        </select>
      </div>
      <p class="border-b border-line px-3 py-1.5 text-[10px] leading-4 text-[color:var(--muted)]">
        Cấu hình định vị áp dụng cho toàn bộ bản vẽ trong hồ sơ. Bản vẽ khác gốc tọa độ cần hồ sơ
        riêng.
      </p>
      <Show when={!w.dirty() && !isProcessing(w.job()) && w.preview()?.drawing?.error}>
        <p role="alert" class="import-error">
          {w.preview()?.drawing?.error}
        </p>
      </Show>
      <Show when={w.preview()?.drawing?.coordinateSpace === 'EPSG:4326'}>
        <p class="px-3 py-1 text-xs text-[color:var(--muted)]">
          Vị trí CAD theo cấu hình tọa độ đã chọn · chưa đồng nghĩa mạng đạt Ready.
          <Show when={w.preview()?.drawing?.hasMore}> Hiển thị tối đa 10.000 đối tượng.</Show>
        </p>
      </Show>
      <Show when={mode() === 'points' && pointModeConflict()}>
        <p role="alert" class="border-b border-line px-3 py-2 text-xs text-amber-800">
          Hồ sơ đang có cấu hình tọa độ khác. Việc chuyển sang ghép điểm sẽ bỏ CRS, trục, đơn vị và
          các điểm cũ khỏi bản nháp; có thể bỏ thay đổi trước khi lưu.
          <button
            type="button"
            class={`${button} mt-2`}
            disabled={w.locked()}
            onClick={resetForPoints}
          >
            Chuyển sang ghép điểm
          </button>
        </p>
      </Show>
      <div class="relative min-h-[230px] flex-1 overflow-hidden bg-[var(--surface2)]">
        <div
          ref={container}
          role="region"
          aria-label="Bản đồ chọn điểm GIS"
          tabIndex={0}
          class="absolute inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
        />
        <div class="absolute left-2 top-2 z-10 flex max-w-[calc(100%-4rem)] flex-wrap gap-1 rounded-lg border border-line bg-[var(--surface)] p-1 shadow-sm">
          <input
            aria-label="Đến kinh độ"
            class={`${field} !w-[100px] !px-2 !py-1`}
            value={searchLon()}
            onInput={e => setSearchLon(e.currentTarget.value)}
            placeholder="Kinh độ"
            inputmode="decimal"
          />
          <input
            aria-label="Đến vĩ độ"
            class={`${field} !w-[100px] !px-2 !py-1`}
            value={searchLat()}
            onInput={e => setSearchLat(e.currentTarget.value)}
            placeholder="Vĩ độ"
            inputmode="decimal"
          />
          <button type="button" class={`${button} !px-2 !py-1`} disabled={!port()} onClick={goTo}>
            Đến
          </button>
        </div>
        <div class="absolute right-2 top-2 z-10 flex flex-col gap-1 rounded-lg bg-[var(--surface)] p-1 shadow-sm">
          <button
            type="button"
            aria-label="Phóng to bản đồ GIS"
            class={`${button} !px-2 !py-1`}
            disabled={!port()}
            onClick={() => zoom(1)}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Thu nhỏ bản đồ GIS"
            class={`${button} !px-2 !py-1`}
            disabled={!port()}
            onClick={() => zoom(-1)}
          >
            −
          </button>
          <button
            type="button"
            class={`${button} !px-2 !py-1`}
            disabled={!port() || !points().some(p => p.target) || legacyMode()}
            onClick={fitPoints}
          >
            Vừa điểm
          </button>
          <button
            type="button"
            class={`${button} !px-2 !py-1`}
            disabled={!port() || !overlayExtent()}
            onClick={() => {
              const extent = overlayExtent()
              if (extent) port()?.fitToBbox(extent, { padding: 50, maxZoom: 19 })
            }}
          >
            Vừa bản vẽ
          </button>
        </div>
        <Show when={pickingGis()}>
          <div
            role="status"
            class="absolute bottom-8 left-2 right-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900"
          >
            Chọn vị trí GIS tương ứng cho điểm {(active() ?? 0) + 1}.
            <button type="button" class="ml-2 underline" onClick={cancelPicks}>
              Hủy chọn
            </button>
          </div>
        </Show>
        <Show when={mapError() || locationError()}>
          <p
            role="alert"
            class="absolute bottom-8 left-2 right-2 rounded-lg bg-[var(--surface)] p-3 text-xs text-red-700"
          >
            {mapError() || locationError()}
          </p>
        </Show>
        <div class="absolute bottom-0 right-0 z-10 max-w-full bg-white/90 px-2 py-1 text-[10px] text-slate-700">
          <Show
            when={basemap() === 'osm'}
            fallback={
              <span>
                Tiles ©{' '}
                <a href="https://www.esri.com/" target="_blank" rel="noreferrer" class="underline">
                  Esri
                </a>{' '}
                · Maxar · Earthstar Geographics
              </span>
            }
          >
            ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              class="underline"
            >
              OpenStreetMap contributors
            </a>
          </Show>
        </div>
      </div>
      <div class="max-h-[48%] shrink-0 overflow-y-auto border-t border-line">
        <Show
          when={mode() === 'source'}
          fallback={
            <>
              <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span class="text-xs font-semibold">
                  {inspection().fitCount} điểm ghép · {inspection().checkCount} điểm kiểm tra
                </span>
                <button
                  type="button"
                  class={`${button} !py-1`}
                  disabled={w.locked() || pointModeConflict() || points().length >= 100}
                  onClick={addPoint}
                >
                  + Thêm cặp điểm
                </button>
              </div>
              <Show when={!points().length}>
                <p class="px-3 pb-3 text-xs leading-5 text-[color:var(--muted)]">
                  Thêm một cặp, chọn mốc dễ nhận biết trên CAD rồi chọn đúng mốc đó trên bản đồ.
                  Dùng mốc đo đạc để kiểm chứng; ảnh nền có thể lệch.
                </p>
              </Show>
              <div class="space-y-2 px-3 pb-2">
                <Index each={points()}>
                  {(point, index) => (
                    <div
                      class={`rounded-lg border p-2 ${active() === index ? 'border-sky-600 bg-sky-50/40' : 'border-line'}`}
                    >
                      <div class="mb-1.5 flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          class="font-semibold underline decoration-dotted"
                          onClick={() => chooseRow(index)}
                        >
                          Điểm {index + 1}
                        </button>
                        <label class="flex items-center gap-1">
                          <input
                            type="checkbox"
                            aria-label={`Điểm ${index + 1} chỉ kiểm tra`}
                            checked={point().checkOnly}
                            disabled={w.locked() || legacyMode()}
                            onChange={e =>
                              patchPoint(index, { checkOnly: e.currentTarget.checked })
                            }
                          />
                          Chỉ kiểm tra
                        </label>
                        <span class="ml-auto font-mono text-[color:var(--muted)]">
                          {currentResult()
                            ?.residuals.find(r => r.index === index)
                            ?.errorM.toFixed(3) ?? '—'}{' '}
                          m
                        </span>
                        <button
                          type="button"
                          aria-label={`Xóa cặp điểm ${index + 1}`}
                          class="text-red-700 underline"
                          disabled={w.locked() || legacyMode()}
                          onClick={() => {
                            w.edit(config => ({
                              ...config,
                              controlPoints: config.controlPoints?.filter((_, i) => i !== index),
                              crsEvidence: '',
                            }))
                            chooseRow(null)
                            cancelPicks()
                            setEvidenceConfirmed(false)
                          }}
                        >
                          Xóa
                        </button>
                      </div>
                      <div class="grid min-w-0 gap-2 sm:grid-cols-2">
                        <div>
                          <button
                            type="button"
                            class="mb-1 text-[10px] font-medium text-sky-700 underline"
                            disabled={w.locked() || legacyMode()}
                            onClick={() => requestCad(index)}
                          >
                            Chọn CAD {index + 1}
                            {waitingCad() && active() === index ? ' · đang chọn' : ''}
                          </button>
                          <CoordinateFields
                            value={point().source}
                            label={`CAD điểm ${index + 1}`}
                            disabled={w.locked() || legacyMode()}
                            onChange={value => patchPoint(index, { source: value })}
                          />
                        </div>
                        <div>
                          <button
                            type="button"
                            class="mb-1 text-[10px] font-medium text-sky-700 underline"
                            disabled={w.locked() || legacyMode() || !port()}
                            onClick={() => requestGis(index)}
                          >
                            Chọn GIS {index + 1}
                          </button>
                          <CoordinateFields
                            value={point().target}
                            label={`GIS điểm ${index + 1}`}
                            geographic
                            disabled={w.locked() || legacyMode()}
                            onChange={value => patchPoint(index, { target: value })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </Index>
              </div>
              <Show when={points().length}>
                <div class="space-y-2 border-t border-line p-3">
                  <Show when={inspection().error}>
                    <p class="text-xs leading-5 text-amber-800">
                      {inspection().error} Có thể lưu để ghép tiếp.
                    </p>
                  </Show>
                  <label class="flex items-center gap-2 text-xs">
                    Sai số tối đa (m)
                    <input
                      aria-label="Sai số điểm khống chế tối đa"
                      type="number"
                      min="0.001"
                      max="10"
                      step="0.01"
                      class={`${field} !w-24 !py-1`}
                      value={w.config()?.controlPointMaxErrorM ?? 0.2}
                      disabled={w.locked() || legacyMode()}
                      onChange={e => {
                        setEvidenceConfirmed(false)
                        w.edit(config => ({
                          ...config,
                          controlPointMaxErrorM: Number(e.currentTarget.value),
                          crsEvidence: '',
                        }))
                      }}
                    />
                  </label>
                  <label class="block text-xs">
                    Căn cứ xác nhận các điểm ghép
                    <textarea
                      aria-label="Căn cứ điểm khống chế"
                      class={`${field} mt-1`}
                      rows={2}
                      maxlength={4000}
                      placeholder="Mốc đo, đơn vị khảo sát, ngày đo và nguồn tọa độ kiểm tra"
                      value={evidenceDraft()}
                      disabled={w.locked() || legacyMode()}
                      onInput={e => {
                        setEvidenceConfirmed(false)
                        setEvidenceDraft(e.currentTarget.value)
                        w.edit(config => ({ ...config, crsEvidence: '' }))
                      }}
                    />
                  </label>
                  <label class="flex items-start gap-2 text-[11px] leading-5">
                    <input
                      class="mt-1"
                      type="checkbox"
                      checked={evidenceConfirmed()}
                      disabled={w.locked() || !!inspection().error || !evidenceDraft().trim()}
                      onChange={e => {
                        setEvidenceConfirmed(e.currentTarget.checked)
                        w.edit(config => ({
                          ...config,
                          crsEvidence: e.currentTarget.checked ? evidenceDraft().trim() : '',
                        }))
                      }}
                    />
                    Tôi đã đối chiếu các mốc và chọn riêng điểm kiểm tra, không dùng để tính phép
                    khớp.
                  </label>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class={button}
                      disabled={w.locked() || !w.dirty() || legacyMode()}
                      onClick={() => void w.save()}
                    >
                      Lưu điểm đang ghép
                    </button>
                    <button
                      type="button"
                      class={`${button} bg-sky-700 text-white hover:!bg-sky-800`}
                      disabled={!canAnalyze()}
                      onClick={() => void savePoints()}
                    >
                      Kiểm tra và xem trên bản đồ
                    </button>
                  </div>
                  <Show when={currentResult()}>
                    {result => (
                      <div
                        role="status"
                        class={`rounded-lg p-2 text-xs leading-5 ${result().status === 'valid' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}
                      >
                        {result().status === 'valid'
                          ? `Đạt kiểm tra điểm · sai số lớn nhất ${(result().maxErrorM ?? 0).toFixed(3)} m · RMSE ${(result().rmseM ?? 0).toFixed(3)} m.`
                          : (result().error ?? 'Chưa đủ điều kiện xác nhận định vị.')}
                        <Show when={result().status === 'valid'}>
                          <br />
                          Hiển thị {overlay().features.length.toLocaleString('vi-VN')} đối tượng đã
                          tải và được máy chủ định vị. Việc duyệt tài sản vẫn theo báo cáo chất
                          lượng.
                        </Show>
                      </div>
                    )}
                  </Show>
                  <Show when={w.dirty()}>
                    <p class="text-[10px] leading-4 text-[color:var(--muted)]">
                      Điểm đã thay đổi; bản khớp cũ được ẩn. Máy chủ sẽ tính và kiểm tra sai số sau
                      khi lưu.
                    </p>
                  </Show>
                </div>
              </Show>
            </>
          }
        >
          <SourceCrsPanel workspace={w} />
        </Show>
      </div>
    </section>
  )
}
