import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import { edProj } from '../editor/model'
import type { CadFeature, LayerRule } from './types'

type Point = [number, number]
type Bounds = [number, number, number, number]
type ViewportMatrix = { a: number; b: number; c: number; d: number; e: number; f: number }
const CENTER: Point = [500, 300]
const SNAP_DISTANCE_PX = 8

function finitePoint(coordinate: number[]): coordinate is Point {
  return Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])
}

export function featureBounds(features: CadFeature[]): Bounds | null {
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const feature of features) {
    if (feature.properties.isXref === true) continue
    const coordinates =
      feature.geometry.type === 'Point'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates
    for (const coordinate of coordinates) {
      if (!finitePoint(coordinate)) continue
      const [x, y] = coordinate
      box[0] = Math.min(box[0], x)
      box[1] = Math.min(box[1], y)
      box[2] = Math.max(box[2], x)
      box[3] = Math.max(box[3], y)
    }
  }
  return Number.isFinite(box[0]) ? box : null
}

/** SVG's screen matrix includes its xMidYMid meet letterboxing and CSS transforms. */
function viewportMatrix(svg: SVGSVGElement): ViewportMatrix | null {
  const matrix = svg.getScreenCTM?.()
  if (
    matrix &&
    [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) &&
    Number.isFinite(matrix.a * matrix.d - matrix.b * matrix.c) &&
    matrix.a * matrix.d - matrix.b * matrix.c !== 0
  )
    return matrix
  const rect = svg.getBoundingClientRect()
  const scale = Math.min(rect.width / 1000, rect.height / 600)
  if (!Number.isFinite(scale) || scale <= 0) return null
  return {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: rect.left + (rect.width - 1000 * scale) / 2,
    f: rect.top + (rect.height - 600 * scale) / 2,
  }
}

function toViewPoint(matrix: ViewportMatrix, x: number, y: number): Point | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  const point: Point = [
    (matrix.d * (x - matrix.e) - matrix.c * (y - matrix.f)) / determinant,
    (-matrix.b * (x - matrix.e) + matrix.a * (y - matrix.f)) / determinant,
  ]
  return finitePoint(point) ? point : null
}

const control =
  'min-h-9 min-w-9 rounded-md border border-line bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-40'

export interface CadPreviewProps {
  features: CadFeature[]
  highlightedIds?: string[]
  selectedId: string
  onSelect: (id: string) => void
  excludeFeatureIds: string[]
  layerRules: LayerRule[]
  coordinateSpace: string
  resetKey: string
  snapLines?: boolean
  sketch?: Point[]
  onCancelPick?: () => void
  pickPoint?: boolean
  onPickPoint?: (point: Point) => void
  controlPoints?: Array<{ id: string; coordinate: Point }>
  activeControlPointId?: string
  fill?: boolean
  focusKey?: string
}

export function CadPreview(props: CadPreviewProps): JSX.Element {
  let svg!: SVGSVGElement
  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [markerScale, setMarkerScale] = createSignal(1)
  const [dragging, setDragging] = createSignal(false)
  const bounds = createMemo(() => featureBounds(props.features))
  const frame = createMemo(() => {
    const b = bounds() ?? [0, 0, 1, 1]
    // Halving first also keeps a finite frame for very large finite CAD coordinates.
    const scale = Math.min(
      460 / Math.max(b[2] / 2 - b[0] / 2, 0.0000005),
      260 / Math.max(b[3] / 2 - b[1] / 2, 0.0000005)
    )
    return { cx: b[0] / 2 + b[2] / 2, cy: b[1] / 2 + b[3] / 2, scale }
  })
  function project(coordinate: Point): Point {
    const f = frame()
    return [500 + (coordinate[0] - f.cx) * f.scale, 300 - (coordinate[1] - f.cy) * f.scale]
  }
  function transform(point: Point): Point {
    return [500 + pan().x + (point[0] - 500) * zoom(), 300 + pan().y + (point[1] - 300) * zoom()]
  }
  function unproject(point: Point): Point | null {
    const f = frame()
    const coordinate: Point = [
      f.cx + (point[0] - 500 - pan().x) / zoom() / f.scale,
      f.cy - (point[1] - 300 - pan().y) / zoom() / f.scale,
    ]
    return finitePoint(coordinate) ? coordinate : null
  }
  const paths = createMemo(() =>
    props.features.flatMap(feature => {
      let path = ''
      if (feature.geometry.type === 'Point') {
        if (finitePoint(feature.geometry.coordinates)) {
          const point = project(feature.geometry.coordinates)
          if (finitePoint(point)) {
            const [x, y] = point
            path = `M${x - 2},${y}h4M${x},${y - 2}v4`
          }
        }
      } else {
        let connected = false
        for (const coordinate of feature.geometry.coordinates) {
          const point = finitePoint(coordinate) ? project(coordinate) : null
          if (!point || !finitePoint(point)) {
            connected = false
            continue
          }
          path += `${connected ? 'L' : 'M'}${point.join(',')} `
          connected = true
        }
      }
      return path ? [{ feature, path }] : []
    })
  )
  const vertices = createMemo(() =>
    props.features.flatMap(feature => {
      if (feature.properties.isXref === true) return []
      const coordinates =
        feature.geometry.type === 'Point'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates
      return coordinates.filter(finitePoint).map(coordinate => ({
        coordinate: [coordinate[0], coordinate[1]] as Point,
        point: project(coordinate),
      }))
    })
  )
  const markers = createMemo(() =>
    (props.controlPoints ?? []).flatMap((point, index) => {
      if (!finitePoint(point.coordinate)) return []
      const position = transform(project(point.coordinate))
      const rowNumber = /^cp-([1-9]\d*)$/.exec(point.id)?.[1]
      return finitePoint(position) ? [{ ...point, number: rowNumber ?? index + 1, position }] : []
    })
  )
  const excluded = createMemo(() => new Set(props.excludeFeatureIds))
  const rules = createMemo(
    () =>
      new Map(
        props.layerRules.map(rule => [JSON.stringify([rule.fileId, rule.layer]), rule.action])
      )
  )
  const highlighted = createMemo(() => new Set(props.highlightedIds ?? []))
  const color = (feature: CadFeature) => {
    if (feature.id === props.selectedId) return '#d946ef'
    if (highlighted().has(feature.id)) return '#a855f7'
    if (excluded().has(feature.id)) return '#dc2626'
    const action = rules().get(
      JSON.stringify([feature.properties.fileId, feature.properties.layer])
    )
    if (action === 'exclude' || feature.properties.disposition === 'excluded') return '#9ca3af'
    if (action === 'review') return '#d97706'
    if (action === 'reference' || feature.geometry.type === 'Point') return '#94a3b8'
    return '#0284c7'
  }
  function fit() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  createEffect(on(() => props.resetKey, fit))
  function changeZoom(factor: number, anchor: Point = CENTER) {
    const previous = zoom()
    const next = Math.min(2000, Math.max(0.2, previous * factor))
    const ratio = next / previous
    setPan(p => ({
      x: anchor[0] - 500 - (anchor[0] - 500 - p.x) * ratio,
      y: anchor[1] - 300 - (anchor[1] - 300 - p.y) * ratio,
    }))
    setZoom(next)
  }
  function focusSelected() {
    const feature = props.features.find(item => item.id === props.selectedId)
    const b =
      feature &&
      featureBounds([
        feature,
        ...props.features.filter(item => item.properties.parentId === feature.id),
      ])
    if (!b) return
    const center = project([b[0] / 2 + b[2] / 2, b[1] / 2 + b[3] / 2])
    const scale = frame().scale
    const nextZoom = Math.min(
      500,
      Math.max(
        1,
        Math.min(
          400 / Math.max((b[2] / 2 - b[0] / 2) * scale, 1),
          200 / Math.max((b[3] / 2 - b[1] / 2) * scale, 1)
        )
      )
    )
    if (!finitePoint(center) || !Number.isFinite(nextZoom)) return
    setZoom(nextZoom)
    setPan({ x: (500 - center[0]) * nextZoom, y: (300 - center[1]) * nextZoom })
  }
  createEffect(
    on(
      () => props.focusKey,
      key => {
        if (key) focusSelected()
      }
    )
  )

  function pickAt(viewPoint: Point, clientPoint?: Point, matrix?: ViewportMatrix) {
    if (!bounds()) return
    let coordinate = unproject(viewPoint)
    if (clientPoint && matrix) {
      let nearest = SNAP_DISTANCE_PX ** 2
      if (props.snapLines) {
        for (const feature of props.features) {
          if (
            feature.geometry.type !== 'LineString' ||
            excluded().has(feature.id) ||
            (!feature.properties.manualEdit &&
              rules().get(JSON.stringify([feature.properties.fileId, feature.properties.layer])) !==
                'pipe')
          )
            continue
          for (let i = 1; i < feature.geometry.coordinates.length; i++) {
            const a = feature.geometry.coordinates[i - 1]!,
              b = feature.geometry.coordinates[i]!
            if (!finitePoint(a) || !finitePoint(b)) continue
            const av = transform(project(a)),
              bv = transform(project(b))
            const screen = (p: Point): Point => [
              matrix.a * p[0] + matrix.c * p[1] + matrix.e,
              matrix.b * p[0] + matrix.d * p[1] + matrix.f,
            ]
            const sa = screen(av),
              sb = screen(bv),
              hit = edProj(clientPoint[0], clientPoint[1], sa[0], sa[1], sb[0], sb[1])
            if (hit.d * hit.d <= nearest) {
              nearest = hit.d * hit.d
              coordinate = [a[0] + hit.t * (b[0] - a[0]), a[1] + hit.t * (b[1] - a[1])]
            }
          }
        }
      }
      for (const vertex of vertices()) {
        const [x, y] = transform(vertex.point)
        const dx = matrix.a * x + matrix.c * y + matrix.e - clientPoint[0]
        const dy = matrix.b * x + matrix.d * y + matrix.f - clientPoint[1]
        const distance = dx * dx + dy * dy
        if (distance <= nearest) {
          nearest = distance
          coordinate = vertex.coordinate
        }
      }
    }
    if (coordinate) props.onPickPoint?.(coordinate)
  }

  let drag: {
    pointerId: number
    x: number
    y: number
    point: Point
    startX: number
    startY: number
    moved: boolean
    id: string
    controlPointId: string
  } | null = null
  const pointerDown: JSX.EventHandler<SVGSVGElement, PointerEvent> = event => {
    if (event.button !== 0 || event.isPrimary === false || drag) return
    const matrix = viewportMatrix(event.currentTarget)
    const point = matrix && toViewPoint(matrix, event.clientX, event.clientY)
    if (!point) return
    const id =
      (event.target as Element).closest('[data-feature-id]')?.getAttribute('data-feature-id') ?? ''
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      point,
      startX: pan().x,
      startY: pan().y,
      moved: false,
      id,
      controlPointId:
        (event.target as Element)
          .closest('[data-control-point-id]')
          ?.getAttribute('data-control-point-id') ?? '',
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const pointerMove: JSX.EventHandler<SVGSVGElement, PointerEvent> = event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const matrix = viewportMatrix(event.currentTarget)
    const point = matrix && toViewPoint(matrix, event.clientX, event.clientY)
    if (!point) return
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true
    if (drag.moved) {
      setDragging(true)
      setPan({
        x: drag.startX + point[0] - drag.point[0],
        y: drag.startY + point[1] - drag.point[1],
      })
    }
  }
  const pointerUp: JSX.EventHandler<SVGSVGElement, PointerEvent> = event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const gesture = drag
    drag = null
    setDragging(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (gesture.moved || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4)
      return
    if (gesture.controlPointId) {
      const point = props.controlPoints?.find(point => point.id === gesture.controlPointId)
      if (props.pickPoint && point && finitePoint(point.coordinate))
        props.onPickPoint?.([...point.coordinate])
      return
    }
    if (props.pickPoint) {
      const matrix = viewportMatrix(event.currentTarget)
      const point = matrix && toViewPoint(matrix, event.clientX, event.clientY)
      if (point && matrix) pickAt(point, [event.clientX, event.clientY], matrix)
    } else props.onSelect(gesture.id)
  }
  function cancelDrag() {
    drag = null
    setDragging(false)
  }
  const wheel: JSX.EventHandler<SVGSVGElement, WheelEvent> = event => {
    event.preventDefault()
    const matrix = viewportMatrix(event.currentTarget)
    const point = matrix && toViewPoint(matrix, event.clientX, event.clientY)
    if (!point || !Number.isFinite(event.deltaY)) return
    cancelDrag()
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1)
    changeZoom(Math.exp(Math.max(-1, Math.min(1, -delta * 0.002))), point)
  }
  const keyDown: JSX.EventHandler<SVGSVGElement, KeyboardEvent> = event => {
    if (event.target !== event.currentTarget) return
    if (
      [
        '+',
        '=',
        '-',
        'Home',
        'Escape',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Enter',
      ].includes(event.key)
    )
      event.preventDefault()
    if (event.key === '+' || event.key === '=') changeZoom(1.4)
    if (event.key === '-') changeZoom(1 / 1.4)
    if (event.key === 'Home') fit()
    if (event.key === 'Escape') {
      cancelDrag()
      props.onCancelPick?.()
      props.onSelect('')
    }
    if (event.key === 'Enter' && props.pickPoint) pickAt(CENTER)
    if (event.key.startsWith('Arrow'))
      setPan(p => ({
        x: p.x + (event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0),
        y: p.y + (event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0),
      }))
  }
  onMount(() => {
    const resize = () => {
      const matrix = viewportMatrix(svg)
      if (matrix) setMarkerScale(Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)))
    }
    resize()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(resize)
      observer.observe(svg)
      onCleanup(() => observer.disconnect())
    }
  })

  return (
    <div class={props.fill ? 'flex h-full min-h-0 flex-col' : undefined}>
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" class={control} onClick={() => changeZoom(1.5)} aria-label="Phóng to">
          +
        </button>
        <button
          type="button"
          class={control}
          onClick={() => changeZoom(1 / 1.5)}
          aria-label="Thu nhỏ"
        >
          −
        </button>
        <button type="button" class={control} onClick={fit}>
          Vừa khung
        </button>
        <button type="button" class={control} onClick={focusSelected} disabled={!props.selectedId}>
          Đến đối tượng
        </button>
        <span class="ml-auto text-[11px] text-[color:var(--muted)]">
          {props.coordinateSpace === 'cad'
            ? 'Tọa độ bản vẽ · chưa định vị GIS'
            : 'EPSG:4326 · kinh độ / vĩ độ'}
        </span>
      </div>
      <div
        class={`relative overflow-hidden bg-[var(--surface2)] ${props.fill ? 'min-h-0 flex-1' : ''}`}
      >
        <svg
          ref={svg}
          class={`block w-full touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${props.fill ? 'absolute inset-0 h-full' : ''} ${dragging() ? 'cursor-grabbing' : props.pickPoint ? 'cursor-crosshair' : 'cursor-grab'}`}
          style={props.fill ? undefined : { 'aspect-ratio': '5 / 3' }}
          viewBox="0 0 1000 600"
          preserveAspectRatio="xMidYMid meet"
          role="application"
          aria-label={
            props.pickPoint
              ? 'Chọn điểm đối chiếu CAD. Kéo để di chuyển, phím cộng trừ thu phóng, Enter chọn tâm khung, Home vừa khung.'
              : 'Bản xem trước CAD. Kéo để di chuyển, phím cộng trừ để thu phóng, Home để vừa khung. Chọn đối tượng bằng bảng thuộc tính.'
          }
          tabindex={0}
          onKeyDown={keyDown}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          on:wheel={{ handleEvent: wheel, passive: false }}
        >
          <g
            data-cad-geometry
            transform={`translate(${pan().x} ${pan().y}) translate(500 300) scale(${zoom()}) translate(-500 -300)`}
          >
            <Show when={props.sketch?.length}>
              <path
                d={(props.sketch ?? [])
                  .map((point, i) => `${i ? 'L' : 'M'}${project(point).join(',')}`)
                  .join(' ')}
                fill="none"
                stroke="#d946ef"
                stroke-width="3"
                stroke-dasharray="5 4"
                vector-effect="non-scaling-stroke"
                style={{ 'pointer-events': 'none' }}
              />
            </Show>
            <For each={paths()}>
              {entry => (
                <>
                  <path
                    d={entry.path}
                    data-feature-id={entry.feature.id}
                    fill="none"
                    stroke={color(entry.feature)}
                    stroke-width={entry.feature.id === props.selectedId ? 4 : 2}
                    stroke-opacity={excluded().has(entry.feature.id) ? 0.6 : 0.95}
                    stroke-dasharray={excluded().has(entry.feature.id) ? '5 4' : undefined}
                    vector-effect="non-scaling-stroke"
                    style={{ 'pointer-events': 'none' }}
                  />
                  <path
                    d={entry.path}
                    data-feature-id={entry.feature.id}
                    data-cad-hit-area
                    fill="none"
                    stroke="transparent"
                    stroke-width="14"
                    vector-effect="non-scaling-stroke"
                    style={{ 'pointer-events': 'stroke' }}
                  >
                    <title>
                      {entry.feature.properties.layer} · {entry.feature.id}
                    </title>
                  </path>
                </>
              )}
            </For>
          </g>
          <For each={markers()}>
            {point => (
              <g
                role="button"
                tabindex={props.pickPoint && props.onPickPoint ? 0 : -1}
                aria-label={`Điểm đối chiếu CAD ${point.number}`}
                aria-pressed={point.id === props.activeControlPointId}
                aria-disabled={!props.pickPoint || !props.onPickPoint}
                transform={`translate(${point.position[0]} ${point.position[1]}) scale(${1 / markerScale()})`}
                class="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
                data-control-point-id={point.id}
                onClick={event => {
                  event.stopPropagation()
                  // Pointer activation is handled on pointerup so dragging a marker pans
                  // without picking. Keep synthetic/assistive clicks keyboard-accessible.
                  if (event.detail === 0 && props.pickPoint)
                    props.onPickPoint?.([...point.coordinate])
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    if (props.pickPoint) props.onPickPoint?.([...point.coordinate])
                  }
                }}
              >
                <circle r="19" fill="transparent" />
                <circle
                  r={point.id === props.activeControlPointId ? 15 : 12}
                  fill={point.id === props.activeControlPointId ? '#0369a1' : '#ffffff'}
                  stroke="#0369a1"
                  stroke-width="2"
                />
                <text
                  text-anchor="middle"
                  dominant-baseline="central"
                  font-size="12"
                  font-weight="700"
                  fill={point.id === props.activeControlPointId ? '#ffffff' : '#0369a1'}
                  style={{ 'pointer-events': 'none', 'user-select': 'none' }}
                >
                  {point.number}
                </text>
              </g>
            )}
          </For>
          <Show when={props.pickPoint}>
            <g
              transform="translate(500 300)"
              style={{ 'pointer-events': 'none' }}
              aria-hidden="true"
            >
              <path
                d="M-8 0H8M0-8V8"
                stroke="#0369a1"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            </g>
          </Show>
        </svg>
        <Show when={!props.features.length}>
          <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[color:var(--muted)]">
            Chưa có đối tượng trong bộ lọc đang chọn.
          </div>
        </Show>
      </div>
      <div class="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-[color:var(--muted)]">
        <span class="text-sky-600">● Tuyến ống</span>
        <span class="text-amber-600">● Cần phân loại</span>
        <span>● Tham chiếu / đã lọc</span>
        <span class="text-red-600">┄ Loại thủ công</span>
        <span class="text-fuchsia-600">● Đang chọn</span>
        <span class="ml-auto">
          {props.pickPoint
            ? 'Chọn điểm · Bắt đỉnh trong 8 px · Enter chọn tâm'
            : 'Kéo để di chuyển · + / − thu phóng · Home vừa khung'}
        </span>
      </div>
    </div>
  )
}
