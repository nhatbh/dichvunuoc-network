import { For, Show, createEffect, createMemo, createSignal, type Accessor } from 'solid-js'
import { edProj, type Pt } from '../editor/model'
import { importButton as button, importField as field } from './ui'
import type { CadFeature, LineEdit, ReviewConfig } from './types'
import type { createImportWorkspace } from './workspace'

export function overlayLineEdits(
  features: CadFeature[],
  config: ReviewConfig | null
): CadFeature[] {
  const edits = new Map((config?.lineEdits ?? []).map(edit => [edit.id, edit]))
  const seen = new Set(features.map(feature => feature.id))
  return [
    ...features.map(feature => {
      const edit = edits.get(feature.id)
      return edit
        ? {
            ...feature,
            geometry: { type: 'LineString' as const, coordinates: edit.coordinates },
            properties: {
              ...feature.properties,
              diameterMm: edit.diameterMm,
              material: edit.material,
              manualEdit: true,
            },
          }
        : feature
    }),
    ...[...edits.values()]
      .filter(edit => !seen.has(edit.id))
      .map(edit => ({
        type: 'Feature' as const,
        id: edit.id,
        geometry: { type: 'LineString' as const, coordinates: edit.coordinates },
        properties: {
          fileId: edit.fileId,
          layer: edit.layer,
          entityType: 'LINE',
          manualEdit: true,
          diameterMm: edit.diameterMm,
          material: edit.material,
        },
      })),
  ]
}

export function splitLineAt(coordinates: Pt[], point: Pt): [Pt[], Pt[]] | null {
  let best: { index: number; point: Pt; distance: number } | undefined
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]!,
      b = coordinates[i]!
    const projected = edProj(point[0], point[1], a[0], a[1], b[0], b[1])
    if (!best || projected.d < best.distance)
      best = { index: i, point: [projected.x, projected.y], distance: projected.d }
  }
  if (!best) return null
  const dedup = (points: Pt[]) =>
    points.filter((p, i) => !i || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1])
  const first = dedup([...coordinates.slice(0, best.index), best.point])
  const second = dedup([best.point, ...coordinates.slice(best.index)])
  return first.length >= 2 && second.length >= 2 ? [first, second] : null
}

type Tool = 'select' | 'draw' | 'move' | 'insert' | 'split'
export function createDraftEditor(
  w: ReturnType<typeof createImportWorkspace>,
  selected: Accessor<CadFeature | undefined>,
  select: (id: string) => void,
  activate: () => void
) {
  const activeFiles = () =>
    w.job()?.files.filter(f => !w.config()?.excludedFileIds?.includes(f.id)) ?? []
  const [tool, setTool] = createSignal<Tool>('select')
  const [points, setPoints] = createSignal<Pt[]>([])
  const [vertex, setVertex] = createSignal(0)
  const [fileId, setFileId] = createSignal('')
  const [diameter, setDiameter] = createSignal('')
  const [material, setMaterial] = createSignal('')
  const [message, setMessage] = createSignal('')
  const editable = createMemo(() => {
    const f = selected()
    return f?.geometry.type === 'LineString' &&
      !f.properties.isXref &&
      !f.properties.isBlockGeometry &&
      !w.config()?.excludeFeatureIds.includes(f.id)
      ? f
      : undefined
  })
  createEffect(() => {
    const f = editable(),
      config = w.config()
    const rule = config?.layerRules.find(
      rule => rule.fileId === f?.properties.fileId && rule.layer === f?.properties.layer
    )
    setDiameter(
      String(f?.properties.manualEdit ? (f.properties.diameterMm ?? '') : (rule?.diameterMm ?? ''))
    )
    setMaterial(
      String(f?.properties.manualEdit ? (f.properties.material ?? '') : (rule?.material ?? ''))
    )
    setVertex(0)
  })
  createEffect(() => {
    if (w.locked()) {
      setTool('select')
      setPoints([])
    }
  })
  function cancel() {
    setTool('select')
    setPoints([])
    setMessage('')
  }
  function attrs() {
    const dn = diameter().trim() ? Number(diameter()) : undefined
    if (dn !== undefined && (!Number.isInteger(dn) || dn <= 0 || dn > 5000)) {
      setMessage('Đường kính phải là số nguyên từ 1 đến 5000, hoặc để trống.')
      return null
    }
    return { diameterMm: dn, material: material().trim() || undefined }
  }
  function record(f: CadFeature, coordinates: Pt[]): LineEdit | null {
    const a = attrs()
    if (!a || !f.properties.fileId) return null
    const existing = w.config()?.lineEdits?.find(edit => edit.id === f.id)
    return {
      id: f.id,
      sourceFeatureId: existing?.sourceFeatureId ?? (f.id.startsWith('draft-') ? null : f.id),
      fileId: f.properties.fileId,
      layer: f.properties.layer ?? 'Biên tập',
      action: 'pipe',
      coordinates,
      ...a,
    }
  }
  function commit(edits: LineEdit[], excluded?: string) {
    if (w.locked()) return
    w.edit(config => ({
      ...config,
      lineEdits: [
        ...(config.lineEdits ?? []).filter(edit => !edits.some(next => next.id === edit.id)),
        ...edits,
      ],
      excludeFeatureIds: excluded
        ? [...new Set([...config.excludeFeatureIds, excluded])]
        : config.excludeFeatureIds,
      acceptWarningCodes: [],
    }))
    setTool('select')
    setPoints([])
    setMessage(
      'Đã áp dụng vào bản nháp đang sửa. Bấm Lưu bản nháp để lưu lên máy chủ và kiểm tra lại.'
    )
  }
  function start(next: Tool) {
    if (w.locked()) return
    activate()
    setTool(next)
    setPoints([])
    setMessage('')
    if (next === 'draw') setFileId(editable()?.properties.fileId ?? activeFiles()[0]?.id ?? '')
  }
  function finish() {
    const a = attrs()
    if (!a || points().length < 2 || !activeFiles().some(f => f.id === fileId())) return
    const id = `draft-${crypto.randomUUID()}`
    commit([
      {
        id,
        fileId: fileId(),
        layer: 'Biên tập bổ sung',
        action: 'pipe',
        coordinates: points(),
        ...a,
      },
    ])
    select(id)
  }
  function pick(point: Pt) {
    if (w.locked()) return
    if (tool() === 'draw') {
      setPoints(list => [...list, point])
      return
    }
    const f = editable()
    if (!f || f.geometry.type !== 'LineString') return
    const coordinates = f.geometry.coordinates.map(p => [p[0]!, p[1]!] as Pt)
    if (tool() === 'move') {
      coordinates[vertex()] = point
      const edit = record(f, coordinates)
      if (edit) commit([edit])
    } else {
      const parts = splitLineAt(coordinates, point)
      if (!parts) {
        setMessage('Chọn vị trí bên trong tuyến, không chọn đầu mút.')
        return
      }
      const edit = record(f, [...parts[0], ...parts[1].slice(1)])
      if (!edit) return
      if (tool() === 'insert') commit([edit])
      else {
        const source = edit.sourceFeatureId ?? null
        const split = parts.map(coordinates => ({
          ...edit,
          id: `draft-${crypto.randomUUID()}`,
          sourceFeatureId: source,
          coordinates,
        }))
        commit(split, f.id)
        select(split[0]!.id)
      }
    }
  }
  const Toolbar = () => (
    <section
      class="space-y-2 border-b border-line p-3 text-xs"
      aria-label="Công cụ biên tập bản nháp"
    >
      <div class="flex flex-wrap gap-2">
        <button
          class={button}
          disabled={w.locked() || !activeFiles().length}
          aria-pressed={tool() === 'draw'}
          onClick={() => start('draw')}
        >
          Vẽ tuyến nối
        </button>
        <button class={button} disabled={w.locked() || !editable()} onClick={() => start('move')}>
          Sửa đỉnh / nối đầu mút
        </button>
        <button class={button} disabled={w.locked() || !editable()} onClick={() => start('insert')}>
          Chèn đỉnh
        </button>
        <button class={button} disabled={w.locked() || !editable()} onClick={() => start('split')}>
          Tách tuyến
        </button>
        <button
          class={button}
          disabled={w.locked() || !editable()}
          onClick={() => {
            const id = editable()!.id
            w.edit(c => ({
              ...c,
              connectEndpointFeatureIds: [...new Set([...(c.connectEndpointFeatureIds ?? []), id])],
              acceptWarningCodes: [],
            }))
            setMessage(
              'Đã ghi nhận đấu nối đầu tuyến. Lưu bản nháp để máy chủ tách ống chủ và kiểm tra khoảng cách đấu nối.'
            )
          }}
        >
          Xác nhận đấu nối đầu tuyến
        </button>
        <button
          class={button}
          disabled={w.locked() || !selected()}
          onClick={() => {
            const id = selected()!.id
            w.edit(c => ({
              ...c,
              excludeFeatureIds: c.excludeFeatureIds.includes(id)
                ? c.excludeFeatureIds.filter(x => x !== id)
                : [...c.excludeFeatureIds, id],
              acceptWarningCodes: [],
            }))
            cancel()
          }}
        >
          {w.config()?.excludeFeatureIds.includes(selected()?.id ?? '')
            ? 'Khôi phục tuyến'
            : 'Loại tuyến'}
        </button>
        <button
          class={button}
          disabled={w.locked() || !w.canUndo()}
          onClick={() => {
            cancel()
            w.undo()
          }}
        >
          Hoàn tác
        </button>
        <button
          class={button}
          disabled={w.locked() || !w.canRedo()}
          onClick={() => {
            cancel()
            w.redo()
          }}
        >
          Làm lại
        </button>
      </div>
      <Show when={tool() !== 'select' || editable()}>
        <div class="flex flex-wrap items-end gap-2">
          <Show when={tool() === 'draw'}>
            <label>
              Tệp nguồn
              <select
                class={field}
                aria-label="Tệp nguồn tuyến mới"
                value={fileId()}
                onChange={e => setFileId(e.currentTarget.value)}
              >
                <For each={activeFiles()}>{f => <option value={f.id}>{f.name}</option>}</For>
              </select>
            </label>
          </Show>
          <label>
            DN (mm)
            <input
              class={field}
              aria-label="Đường kính tuyến biên tập"
              value={diameter()}
              onInput={e => setDiameter(e.currentTarget.value)}
            />
          </label>
          <label>
            Vật liệu
            <select
              class={field}
              aria-label="Vật liệu tuyến biên tập"
              value={material()}
              onChange={e => setMaterial(e.currentTarget.value)}
            >
              <option value="">Chưa xác nhận</option>
              <For each={['HDPE', 'PVC', 'DuctileIron', 'Steel', 'CastIron', 'Concrete']}>
                {m => <option value={m}>{m}</option>}
              </For>
            </select>
          </label>
          <Show when={tool() === 'select' && editable()}>
            <button
              class={button}
              disabled={w.locked()}
              onClick={() => {
                const f = editable()!
                if (f.geometry.type === 'LineString') {
                  const e = record(
                    f,
                    f.geometry.coordinates.map(p => [p[0]!, p[1]!])
                  )
                  if (e) commit([e])
                }
              }}
            >
              Áp dụng thuộc tính tuyến
            </button>
          </Show>
          <Show when={tool() === 'move'}>
            <label>
              Đỉnh cần chuyển
              <select
                class={field}
                aria-label="Đỉnh cần chuyển"
                value={vertex()}
                onChange={e => setVertex(Number(e.currentTarget.value))}
              >
                <For each={editable()?.geometry.coordinates}>
                  {(_, i) => <option value={i()}>{i() + 1}</option>}
                </For>
              </select>
            </label>
          </Show>
          <Show when={tool() !== 'select'}>
            <button class={button} onClick={cancel}>
              Hủy thao tác
            </button>
          </Show>
          <Show when={tool() === 'draw'}>
            <button
              class={button}
              disabled={!points().length}
              onClick={() => setPoints(p => p.slice(0, -1))}
            >
              Bỏ điểm cuối
            </button>
            <button class={button} disabled={points().length < 2} onClick={finish}>
              Hoàn tất tuyến ({points().length} điểm)
            </button>
          </Show>
        </div>
      </Show>
      <p role="status">
        {message() ||
          (tool() === 'draw'
            ? 'Bấm các điểm trên CAD rồi Hoàn tất tuyến. Bắt dính đỉnh/thân ống trong phạm vi 8 px; đấu vào thân ống cần Xác nhận đấu nối đầu tuyến.'
            : tool() === 'move'
              ? 'Chọn số đỉnh rồi bấm vị trí mới. Bắt vào đầu mút tuyến khác để nối chính xác.'
              : tool() === 'split' || tool() === 'insert'
                ? 'Bấm vị trí trên tuyến đang chọn; điểm được chiếu lên đoạn gần nhất.'
                : 'Chọn tuyến trên CAD để sửa. Tệp gốc được giữ nguyên; lưu bản nháp để cập nhật bản đồ GIS. Hoàn tác/làm lại áp dụng cho các thay đổi chưa lưu.')}
      </p>
    </section>
  )
  return { Toolbar, pick, cancel, points, active: () => tool() !== 'select' }
}
