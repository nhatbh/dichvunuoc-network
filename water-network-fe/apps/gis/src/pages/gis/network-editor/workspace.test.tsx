import { createSignal } from 'solid-js'
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Geometry } from 'geojson'
import type {
  GeometryEditTarget,
  GeometryEditComplete,
  GeometryVertexSelection,
} from '@wn/map-runtime'
import type { Edit, Revision } from './model'
const mocks = vi.hoisted(() => ({
  draw: null as ((g: Geometry) => void) | null,
  saved: null as Revision | null,
  fail: false,
  target: null as GeometryEditTarget | null,
  complete: null as ((e: GeometryEditComplete) => void) | null,
  vertex: null as ((e: GeometryVertexSelection | null) => void) | null,
  removeVertex: vi.fn(),
  features: {} as Record<string, any>,
  setSession: null as ((tenantId: string, write: boolean) => void) | null,
}))
vi.mock('@/shared/lib/client-auth', () => ({ authClient: {} }))
vi.mock('@/entities/session/api/use-session', () => ({
  useSession: () => {
    const [data, setData] = createSignal({
      user: {
        id: 'u',
        tenantId: 'shw',
        permissions: ['network-design:read', 'network-design:write'],
      },
      session: {},
    })
    mocks.setSession = (tenantId, write) =>
      setData({
        user: {
          id: 'u',
          tenantId,
          permissions: write
            ? ['network-design:read', 'network-design:write']
            : ['network-design:read'],
        },
        session: {},
      })
    return { data }
  },
}))
const port = {
  setGeometryEditTarget: (target: GeometryEditTarget | null) => {
    mocks.target = target
  },
  onGeometryEditComplete: (fn: (e: GeometryEditComplete) => void) => {
    mocks.complete = fn
    return () => {}
  },
  onGeometryVertexSelect: (fn: (e: GeometryVertexSelection | null) => void) => {
    mocks.vertex = fn
    return () => {}
  },
  deleteSelectedGeometryVertex: mocks.removeVertex,
}
vi.mock('@wn/map-runtime/solid', () => ({
  createMapRuntime: () => ({
    containerRef: () => {},
    port: () => stablePort,
  }),
}))
const stablePort = {
  ...port,
  setBasemap: vi.fn(),
  setDrawMeasure: vi.fn(),
  setFeatures: (layer: string, data: any) => {
    mocks.features[layer] = data
  },
  setSelection: vi.fn(),
  fitToBbox: vi.fn(),
  setDrawMode: vi.fn(),
  setModifyMode: vi.fn(),
  setFeaturePointMode: vi.fn(),
  setSnapModes: vi.fn(),
  onFeatureClick: () => () => {},
  onDrawComplete: (fn: (g: Geometry) => void) => {
    mocks.draw = fn
    return () => {}
  },
  onModifyComplete: () => () => {},
  onFeaturePointPick: () => () => {},
}
vi.mock('./api', () => ({
  createNetworkEditorApi: () => ({
    assets: async () => ({}),
    list: async () =>
      mocks.saved ? [{ ...mocks.saved, updatedAt: new Date().toISOString() }] : [],
    create: async () => {
      mocks.saved = { id: 'r1', version: 1, status: 'Draft', operations: [] }
      return mocks.saved
    },
    get: async () => mocks.saved,
    save: async (r: Revision, operations: Edit[]) => {
      if (mocks.fail) throw new Error('Mất kết nối')
      mocks.saved = { ...r, version: r.version + 1, operations: structuredClone(operations) }
      return { ...mocks.saved, errors: [] }
    },
  }),
}))
import { NetworkEditor } from './workspace'
const saved = (): Revision | null => mocks.saved
it('draws a pipe with endpoint nodes, persists it, and keeps unsaved changes on failure', async () => {
  mocks.saved = null
  mocks.fail = false
  render(() => <NetworkEditor />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Tạo bản nháp mới' })).not.toBeDisabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Tạo bản nháp mới' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vẽ ống' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ ống' }))
  mocks.draw!({
    type: 'LineString',
    coordinates: [
      [105, 21],
      [105.001, 21],
    ],
  })
  expect(screen.getByText('Thay đổi trong bản nháp (3)')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }))
  await waitFor(() => expect(saved()?.operations).toHaveLength(3))
  expect(saved()?.operations?.filter(x => x.kind === 'Node')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Gửi duyệt' })).toBeDisabled()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thêm nút' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Thêm nút' }))
  mocks.draw!({ type: 'Point', coordinates: [105.002, 21] })
  mocks.fail = true
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }))
  expect(await screen.findByText('Mất kết nối')).toBeInTheDocument()
  expect(screen.getByText('Thay đổi trong bản nháp (4)')).toBeInTheDocument()
  expect(saved()?.operations).toHaveLength(3)
})

beforeEach(() => {
  mocks.saved = null
  mocks.fail = false
  mocks.target = null
  mocks.features = {}
  mocks.removeVertex.mockClear()
  localStorage.clear()
})
async function pipeEditor() {
  render(() => <NetworkEditor />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Tạo bản nháp mới' })).not.toBeDisabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Tạo bản nháp mới' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vẽ ống' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ ống' }))
  mocks.draw!({
    type: 'LineString',
    coordinates: [
      [105, 21],
      [105.0005, 21],
      [105.001, 21],
    ],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sửa đỉnh' }))
  return { ...mocks.target! }
}
const changedLine: Geometry = {
  type: 'LineString',
  coordinates: [
    [105, 21],
    [105.0005, 21.0002],
    [105.001, 21],
  ],
}
function finish(target: GeometryEditTarget, geometry = changedLine) {
  mocks.complete!({ featureId: target.featureId, gestureKey: target.gestureKey, geometry })
}
function pipeCoordinates() {
  return mocks.features.draft.features.find((f: any) => f.geometry.type === 'LineString').geometry
    .coordinates
}
it('one_drag_one_undo', async () => {
  const target = await pipeEditor()
  finish(target)
  expect(pipeCoordinates()).toEqual((changedLine as any).coordinates)
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
  expect(pipeCoordinates()[1]).toEqual([105.0005, 21])
  expect(screen.getByText('Thay đổi trong bản nháp (3)')).toBeInTheDocument()
})
it('redo_restores_geometry', async () => {
  finish(await pipeEditor())
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
  fireEvent.click(screen.getByRole('button', { name: 'Làm lại' }))
  expect(pipeCoordinates()).toEqual((changedLine as any).coordinates)
})
it('invalid_edit_keeps_history', async () => {
  finish(await pipeEditor(), {
    type: 'LineString',
    coordinates: [
      [106, 21],
      [105.001, 21],
    ],
  })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
  expect(screen.getByText('Thay đổi trong bản nháp (0)')).toBeInTheDocument()
})
it('tool_change_rejects_old_completion', async () => {
  const old = await pipeEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Chọn' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sửa đỉnh' }))
  finish(old)
  expect(pipeCoordinates()[1]).toEqual([105.0005, 21])
})
it('busy_save_cancels_drag', async () => {
  const old = await pipeEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }))
  expect(mocks.target).toBeNull()
  finish(old)
  await waitFor(() => expect(saved()?.version).toBe(2))
  expect(pipeCoordinates()[1]).toEqual([105.0005, 21])
})
it.each(['delete_in_input_does_not_edit', 'ime_composition_does_not_delete'])('%s', async name => {
  const target = await pipeEditor()
  mocks.vertex!({ featureId: target.featureId, vertexIndex: 1 })
  fireEvent.keyDown(
    name === 'delete_in_input_does_not_edit'
      ? screen.getByPlaceholderText('Mã ống, nút, thiết bị…')
      : window,
    { key: 'Delete', isComposing: name.startsWith('ime') }
  )
  expect(mocks.removeVertex).not.toHaveBeenCalled()
})
it('save_keeps_revision_payload', async () => {
  finish(await pipeEditor())
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }))
  await waitFor(() => expect(saved()?.version).toBe(2))
  expect(saved()?.id).toBe('r1')
  expect(saved()?.operations).toHaveLength(3)
  expect(saved()?.operations?.find(e => e.kind === 'Pipe')?.after?.geometry.coordinates).toEqual(
    (changedLine as any).coordinates
  )
})

it('submitted_revision_disables_edit', async () => {
  mocks.saved = { id: 'r1', version: 3, status: 'Submitted', operations: [] }
  render(() => <NetworkEditor />)
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Mở bản nháp biên tập' })).not.toBeDisabled()
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Mở bản nháp biên tập' }), {
    target: { value: 'r1' },
  })
  await screen.findByText('Đã mở bản nháp trên máy chủ.')
  expect(screen.getByRole('button', { name: 'Sửa đỉnh' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Kéo đoạn' })).toBeDisabled()
  expect(mocks.target).toBeNull()
})
it('revision_switch_cancels_drag', async () => {
  const old = await pipeEditor()
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValue(false)
  fireEvent.change(screen.getByRole('combobox', { name: 'Mở bản nháp biên tập' }), {
    target: { value: 'r1' },
  })
  expect(mocks.target).toBeNull()
  finish(old)
  await screen.findByText('Đã mở bản nháp trên máy chủ.')
  expect(screen.getByText('Thay đổi trong bản nháp (0)')).toBeInTheDocument()
  vi.restoreAllMocks()
})
it('node_move_one_undo_restores_all_pipes', async () => {
  await pipeEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ ống' }))
  mocks.draw!({
    type: 'LineString',
    coordinates: [
      [105, 21],
      [104.999, 21],
    ],
  })
  const node = mocks.features.draft.features.find(
    (f: any) => f.geometry.type === 'Point' && f.geometry.coordinates[0] === 105
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Chọn đối tượng mạng' }), {
    target: { value: node.id },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sửa đỉnh' }))
  expect(mocks.target?.featureId).toBe(node.id)
  finish(mocks.target!, { type: 'Point', coordinates: [105, 21.0001] })
  const lines = () =>
    mocks.features.draft.features.filter((f: any) => f.geometry.type === 'LineString')
  expect(lines()).toHaveLength(2)
  expect(lines().every((f: any) => f.geometry.coordinates[0][1] === 21.0001)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
  expect(lines().every((f: any) => f.geometry.coordinates[0][1] === 21)).toBe(true)
})
it('segment_tool_is_scoped_and_noop_does_not_add_history', async () => {
  const target = await pipeEditor()
  finish(target, { type: 'LineString', coordinates: pipeCoordinates() })
  fireEvent.click(screen.getByRole('button', { name: 'Kéo đoạn' }))
  expect(mocks.target?.mode).toBe('segment')
  expect(mocks.target?.lockedEndpointIndices).toEqual([0, 2])
  expect(screen.getByRole('button', { name: 'Xóa đỉnh' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
  expect(screen.getByText('Thay đổi trong bản nháp (0)')).toBeInTheDocument()
})
it('delete_only_dispatches_for_interior_vertex_and_escape_cancels', async () => {
  const target = await pipeEditor()
  mocks.vertex!({ featureId: target.featureId, vertexIndex: 0 })
  expect(screen.getByRole('button', { name: 'Xóa đỉnh' })).toBeDisabled()
  mocks.vertex!({ featureId: target.featureId, vertexIndex: 1 })
  fireEvent.keyDown(window, { key: 'Delete' })
  expect(mocks.removeVertex).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(mocks.target).toBeNull()
  finish(target)
  expect(pipeCoordinates()[1]).toEqual([105.0005, 21])
})

it('scope_change_rejects_old_completion', async () => {
  const old = await pipeEditor()
  mocks.setSession!('another-tenant', true)
  expect(mocks.target).toBeNull()
  finish(old)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Tạo bản nháp mới' })).not.toBeDisabled()
  )
  expect(screen.getByText('Thay đổi trong bản nháp (0)')).toBeInTheDocument()
})
it('permission_loss_cancels_drag', async () => {
  const old = await pipeEditor()
  mocks.setSession!('shw', false)
  expect(mocks.target).toBeNull()
  finish(old)
  expect(pipeCoordinates()[1]).toEqual([105.0005, 21])
  expect(screen.getByRole('button', { name: 'Sửa đỉnh' })).toBeDisabled()
})

it('shows distinct endpoint refs when dynamic node options load and a saved revision reopens', async () => {
  await pipeEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }))
  await waitFor(() => expect(saved()?.version).toBe(2))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu nháp' })).not.toBeDisabled())
  const revision = structuredClone(saved()!)
  const pipeEdit = revision.operations!.find(e => e.kind === 'Pipe')!
  const refs = pipeEdit.after!
  expect(refs.fromRef).not.toBe(refs.toRef)
  expect(screen.getByRole('combobox', { name: 'Nút đầu' })).toHaveValue(refs.fromRef)
  expect(screen.getByRole('combobox', { name: 'Nút cuối' })).toHaveValue(refs.toRef)
  fireEvent.change(screen.getByRole('combobox', { name: 'Mở bản nháp biên tập' }), {
    target: { value: 'r1' },
  })
  await screen.findByText('Đã mở bản nháp trên máy chủ.')
  fireEvent.change(screen.getByRole('combobox', { name: 'Chọn đối tượng mạng' }), {
    target: { value: pipeEdit.id },
  })
  expect(screen.getByRole('combobox', { name: 'Nút đầu' })).toHaveValue(refs.fromRef)
  expect(screen.getByRole('combobox', { name: 'Nút cuối' })).toHaveValue(refs.toRef)
  expect(saved()?.operations).toEqual(revision.operations)
})
