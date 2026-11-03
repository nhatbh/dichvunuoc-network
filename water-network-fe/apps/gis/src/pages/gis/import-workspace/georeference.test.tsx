import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakePort } from '@wn/map-runtime/testing'
import { createMapInstance } from '@wn/map-runtime'
import { GeoreferenceWorkbench } from './georeference'
import {
  reviewForJob,
  type ControlPoint,
  type FeaturePage,
  type ImportJob,
  type ReviewConfig,
} from './types'
import type { createImportWorkspace } from './workspace'

vi.mock('@wn/map-runtime', () => ({ createMapInstance: vi.fn() }))
const fixture: ImportJob = {
  id: 'job',
  name: 'Survey',
  state: 'needs_review',
  version: 1,
  files: [],
  createdAt: '',
  updatedAt: '',
}
const points: ControlPoint[] = [
  { source: [0, 0], target: [105, 21], checkOnly: false },
  { source: [100, 0], target: [105.001, 21], checkOnly: false },
  { source: [0, 100], target: [105, 21.001], checkOnly: false },
  { source: [40, 40], target: [105.0004, 21.0004], checkOnly: true },
]
let port: ReturnType<typeof createFakePort>
beforeEach(() => {
  port = createFakePort()
  vi.mocked(createMapInstance).mockResolvedValue(port)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function harness(initial: Partial<ReviewConfig> = {}) {
  const [job, setJob] = createSignal<ImportJob>(fixture)
  const [config, setConfig] = createSignal<ReviewConfig>({ ...reviewForJob(fixture), ...initial })
  const [dirty, setDirty] = createSignal(false)
  const [locked, setLocked] = createSignal(false)
  const [pending, setPending] = createSignal<[number, number] | null>(null)
  const [preview, setPreview] = createSignal<FeaturePage | null>(null)
  const [parentPickingCad, setParentPickingCad] = createSignal(false)
  const [cancelPickToken, setCancelPickToken] = createSignal(0)
  const onRequestCadPoint = vi.fn(() => setParentPickingCad(true))
  const onCancelCadPoint = vi.fn(() => {
    setParentPickingCad(false)
    setPending(null)
  })
  const cancel = () => {
    onCancelCadPoint()
    setCancelPickToken(value => value + 1)
  }
  const save = vi.fn(async () => {
    setDirty(false)
  })
  const setView = vi.fn()
  const w = {
    job,
    config,
    dirty,
    locked,
    preview,
    error: () => '',
    edit: (fn: (value: ReviewConfig) => ReviewConfig) => {
      if (!locked()) {
        setConfig(fn)
        setDirty(true)
      }
    },
    save,
    setView,
  } as unknown as ReturnType<typeof createImportWorkspace>
  const result = render(() => (
    <GeoreferenceWorkbench
      workspace={w}
      pendingCadPoint={pending()}
      onRequestCadPoint={onRequestCadPoint}
      onClearCadPoint={() => setPending(null)}
      onCancelCadPoint={onCancelCadPoint}
      cancelPickToken={cancelPickToken()}
    />
  ))
  return {
    ...result,
    config,
    setConfig,
    setJob,
    setPreview,
    setDirty,
    setLocked,
    setPending,
    onRequestCadPoint,
    onCancelCadPoint,
    parentPickingCad,
    cancel,
    save,
    setView,
  }
}

async function mounted() {
  await waitFor(() => expect(port.mount).toHaveBeenCalledOnce())
}

describe('map control-point workbench', () => {
  it('defaults to direct CRS, preserves config on tab changes, and explicitly resets conflicts before pairing', async () => {
    const h = harness({
      sourceCrs: 'EPSG:5897',
      sourceAxisOrder: 'yx',
      sourceUnits: 'mm',
      crsEvidence: 'Survey evidence',
    })
    await mounted()
    const before = structuredClone(h.config())
    expect(screen.getByRole('tab', { name: 'VN-2000 / Hệ tọa độ' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Ghép điểm CAD–GIS' }))
    expect(h.config()).toEqual(before)
    expect(screen.getByRole('button', { name: '+ Thêm cặp điểm' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'VN-2000 / Hệ tọa độ' }))
    expect(h.config()).toEqual(before)
    fireEvent.click(screen.getByRole('tab', { name: 'Ghép điểm CAD–GIS' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang ghép điểm' }))
    expect(h.config()).toMatchObject({
      sourceCrs: null,
      sourceAxisOrder: 'xy',
      sourceUnits: 'm',
      sourceCrsPresetId: null,
      crsEvidence: '',
      controlPoints: [],
      controlPointTargetCrs: 'EPSG:4326',
    })
    expect(screen.getByRole('button', { name: '+ Thêm cặp điểm' })).toBeEnabled()
  })
  it('shows and fits a current direct-CRS overlay without requiring affine diagnostics', async () => {
    const h = harness({ sourceCrs: 'EPSG:5897' })
    await mounted()
    h.setPreview({
      type: 'FeatureCollection',
      coordinateSpace: 'EPSG:4326',
      features: [
        {
          type: 'Feature',
          id: 'line',
          geometry: {
            type: 'LineString',
            coordinates: [
              [105, 21],
              [105.001, 21.001],
            ],
          },
          properties: {},
        },
      ],
      total: 1,
      hasMore: false,
      offset: 0,
      version: 1,
    })
    await waitFor(() =>
      expect(
        vi
          .mocked(port.setFeatures)
          .mock.calls.filter(call => call[0] === 'georeferenced-cad')
          .at(-1)?.[1].features
      ).toHaveLength(1)
    )
    expect(port.fitToBbox).toHaveBeenCalledWith([105, 21, 105.001, 21.001], {
      padding: 50,
      maxZoom: 19,
    })
    expect(screen.getByRole('button', { name: 'Vừa bản vẽ' })).toBeEnabled()
    h.setDirty(true)
    await waitFor(() =>
      expect(
        vi
          .mocked(port.setFeatures)
          .mock.calls.filter(call => call[0] === 'georeferenced-cad')
          .at(-1)?.[1].features
      ).toHaveLength(0)
    )
  })
  it('fits the server-projected CAD even when the clean network is empty', async () => {
    const h = harness({ sourceCrs: 'EPSG:5897' })
    await mounted()
    h.setPreview({
      type: 'FeatureCollection',
      coordinateSpace: 'cad',
      features: [],
      total: 0,
      hasMore: false,
      offset: 0,
      version: 1,
      drawing: {
        coordinateSpace: 'EPSG:4326',
        total: 1,
        hasMore: false,
        features: [
          {
            type: 'Feature',
            id: 'unmapped-cad',
            geometry: {
              type: 'LineString',
              coordinates: [
                [105, 21],
                [105.001, 21.001],
              ],
            },
            properties: { disposition: 'review' },
          },
        ],
      },
    })
    await waitFor(() =>
      expect(port.fitToBbox).toHaveBeenCalledWith([105, 21, 105.001, 21.001], {
        padding: 50,
        maxZoom: 19,
      })
    )
    expect(
      vi
        .mocked(port.setFeatures)
        .mock.calls.filter(c => c[0] === 'georeferenced-cad')
        .at(-1)?.[1].features
    ).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Vừa bản vẽ' })).toBeEnabled()
    h.setDirty(true)
    await waitFor(() =>
      expect(
        vi
          .mocked(port.setFeatures)
          .mock.calls.filter(c => c[0] === 'georeferenced-cad')
          .at(-1)?.[1].features
      ).toHaveLength(0)
    )
  })

  it('pairs an actual CAD pick with a GIS draw in WGS84 and preserves incomplete drafts', async () => {
    const h = harness()
    await mounted()
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright'
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Ghép điểm CAD–GIS' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm cặp điểm' }))
    expect(h.onRequestCadPoint).toHaveBeenCalledOnce()
    expect(h.config().controlPoints).toEqual([{ source: null, target: null, checkOnly: false }])
    expect(h.config().sourceCrs).toBeNull()
    expect(h.config().controlPointTargetCrs).toBe('EPSG:4326')
    h.setPending([1234, 5678])
    await waitFor(() => expect(port.setDrawMode).toHaveBeenLastCalledWith('Point'))
    expect(h.config().controlPoints?.[0]?.source).toEqual([1234, 5678])
    port.emitDraw({ type: 'Point', coordinates: [105.12345, 21.12345] })
    expect(h.config().controlPoints?.[0]?.target).toEqual([105.12345, 21.12345])
    await waitFor(() => expect(port.setDrawMode).toHaveBeenLastCalledWith(null))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điểm đang ghép' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Kiểm tra và xem trên bản đồ' })).toBeDisabled()
  })
  it('cancels the parent CAD picker when switching to GIS or deleting a row', async () => {
    const h = harness({ controlPoints: points, controlPointTargetCrs: 'EPSG:4326' })
    await mounted()
    fireEvent.click(screen.getByRole('button', { name: /^Chọn CAD 1/ }))
    expect(h.parentPickingCad()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Chọn GIS 1' }))
    expect(h.parentPickingCad()).toBe(false)
    expect(h.onCancelCadPoint).toHaveBeenCalledOnce()
    h.setPending([900, 900])
    expect(h.config().controlPoints?.[0]?.source).toEqual([0, 0])
    fireEvent.click(screen.getByRole('button', { name: 'Hủy chọn' }))
    await waitFor(() => expect(port.setDrawMode).toHaveBeenLastCalledWith(null))
    fireEvent.click(screen.getByRole('button', { name: /^Chọn CAD 2/ }))
    expect(h.parentPickingCad()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Xóa cặp điểm 2' }))
    expect(h.parentPickingCad()).toBe(false)
    h.setPending([800, 800])
    expect(h.config().controlPoints?.[1]?.source).toEqual([0, 100])
  })
  it('cancels both point modes through the shared Escape token and ignores late picks', async () => {
    const h = harness({ controlPoints: points, controlPointTargetCrs: 'EPSG:4326' })
    await mounted()
    fireEvent.click(screen.getByRole('button', { name: /^Chọn CAD 1/ }))
    h.cancel()
    h.setPending([700, 700])
    expect(h.config().controlPoints?.[0]?.source).toEqual([0, 0])
    fireEvent.click(screen.getByRole('button', { name: 'Chọn GIS 1' }))
    await waitFor(() => expect(port.setDrawMode).toHaveBeenLastCalledWith('Point'))
    h.cancel()
    await waitFor(() => expect(port.setDrawMode).toHaveBeenLastCalledWith(null))
    expect(screen.queryByRole('button', { name: 'Hủy chọn' })).not.toBeInTheDocument()
    port.emitDraw({ type: 'Point', coordinates: [106, 22] })
    expect(h.config().controlPoints?.[0]?.target).toEqual([105, 21])
    expect(h.parentPickingCad()).toBe(false)
  })
  it('keeps the intended pair active when a GIS pick hits another control marker', async () => {
    const h = harness({ controlPoints: points, controlPointTargetCrs: 'EPSG:4326' })
    await mounted()
    fireEvent.click(screen.getByRole('button', { name: 'Chọn GIS 1' }))
    port.emitClick('cp-2')
    port.emitDraw({ type: 'Point', coordinates: [105.002, 21.002] })
    expect(h.config().controlPoints?.[0]?.target).toEqual([105.002, 21.002])
    expect(h.config().controlPoints?.[1]?.target).toEqual(points[1]?.target)
  })
  it('does not silently turn a half-entered coordinate into a zero coordinate', async () => {
    const h = harness()
    await mounted()
    fireEvent.click(screen.getByRole('tab', { name: 'Ghép điểm CAD–GIS' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm cặp điểm' }))
    const x = screen.getByLabelText('CAD điểm 1 X')
    const y = screen.getByLabelText('CAD điểm 1 Y')
    fireEvent.input(x, { target: { value: '12' } })
    fireEvent.change(x)
    expect(h.config().controlPoints?.[0]?.source).toBeNull()
    fireEvent.input(y, { target: { value: '34' } })
    fireEvent.change(y)
    expect(h.config().controlPoints?.[0]?.source).toEqual([12, 34])
  })
  it('requires complete independent pairs plus evidence and confirmation before authoritative preview', async () => {
    const h = harness({ controlPoints: points, controlPointTargetCrs: 'EPSG:4326' })
    await mounted()
    const analyze = screen.getByRole('button', { name: 'Kiểm tra và xem trên bản đồ' })
    expect(analyze).toBeDisabled()
    fireEvent.input(screen.getByLabelText('Căn cứ điểm khống chế'), {
      target: { value: 'Survey benchmarks from field verification' },
    })
    expect(analyze).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Tôi đã đối chiếu/))
    expect(analyze).toBeEnabled()
    fireEvent.click(analyze)
    await waitFor(() => expect(h.setView).toHaveBeenCalledWith('clean'))
    expect(h.config().sourceCrs).toBeNull()
    fireEvent.click(screen.getByLabelText('Điểm 4 chỉ kiểm tra'))
    expect(analyze).toBeDisabled()
    expect(screen.getByLabelText(/Tôi đã đối chiếu/)).not.toBeChecked()
    expect(h.config().crsEvidence).toBe('')
    expect(screen.getByLabelText('Căn cứ điểm khống chế')).toHaveValue(
      'Survey benchmarks from field verification'
    )
  })
  it('removes pairs reversibly through unsaved config and locks all geometry changes during processing', async () => {
    const h = harness({ controlPoints: points, controlPointTargetCrs: 'EPSG:4326' })
    await mounted()
    fireEvent.click(screen.getByRole('button', { name: 'Xóa cặp điểm 2' }))
    expect(h.config().controlPoints).toHaveLength(3)
    expect(h.config().controlPoints?.[1]?.source).toEqual([0, 100])
    h.setLocked(true)
    expect(screen.getByRole('button', { name: '+ Thêm cặp điểm' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Xóa cặp điểm 1' })).toBeDisabled()
    expect(screen.getByLabelText('CAD điểm 1 X')).toBeDisabled()
  })
  it('renders only authoritative WGS84 geometry and clears old overlay on edits', async () => {
    const h = harness({ controlPoints: points, controlPointTargetCrs: 'EPSG:4326' })
    await mounted()
    h.setJob({
      ...fixture,
      georeference: {
        status: 'valid',
        targetCrs: 'EPSG:4326',
        fitPointCount: 3,
        checkPointCount: 1,
        thresholdM: 0.2,
        maxErrorM: 0.025,
        rmseM: 0.02,
        residuals: [{ index: 3, checkOnly: true, errorM: 0.025 }],
        workingCrs: '+proj=aeqd',
        error: null,
      },
    })
    h.setPreview({
      type: 'FeatureCollection',
      coordinateSpace: 'EPSG:4326',
      features: [
        {
          type: 'Feature',
          id: 'pipe',
          geometry: {
            type: 'LineString',
            coordinates: [
              [105, 21],
              [105.001, 21.001],
            ],
          },
          properties: {},
        },
      ],
      total: 1,
      hasMore: false,
      offset: 0,
      version: 1,
    })
    await waitFor(() =>
      expect(
        vi
          .mocked(port.setFeatures)
          .mock.calls.filter(call => call[0] === 'georeferenced-cad')
          .at(-1)?.[1].features
      ).toHaveLength(1)
    )
    expect(screen.getByText(/sai số lớn nhất 0.025 m/)).toBeInTheDocument()
    h.setDirty(true)
    await waitFor(() =>
      expect(
        vi
          .mocked(port.setFeatures)
          .mock.calls.filter(call => call[0] === 'georeferenced-cad')
          .at(-1)?.[1].features
      ).toHaveLength(0)
    )
    expect(screen.queryByText(/sai số lớn nhất 0.025 m/)).not.toBeInTheDocument()
    h.setJob({
      ...fixture,
      state: 'analyzing',
      georeference: {
        status: 'valid',
        targetCrs: 'EPSG:4326',
        fitPointCount: 3,
        checkPointCount: 1,
        thresholdM: 0.2,
        maxErrorM: 0.025,
        rmseM: 0.02,
        residuals: [],
        workingCrs: '+proj=aeqd',
        error: null,
      },
    })
    h.setDirty(false)
    await waitFor(() =>
      expect(
        vi
          .mocked(port.setFeatures)
          .mock.calls.filter(call => call[0] === 'georeferenced-cad')
          .at(-1)?.[1].features
      ).toHaveLength(0)
    )
    expect(screen.queryByText(/sai số lớn nhất 0.025 m/)).not.toBeInTheDocument()
  })
  it('keeps legacy projected coordinates intact and offers manual entry when the map fails', async () => {
    vi.mocked(createMapInstance).mockRejectedValueOnce(new Error('map-load'))
    const h = harness({
      controlPoints: [{ source: [0, 0], target: [500000, 2300000], checkOnly: false }],
      sourceCrs: 'EPSG:3405',
      controlPointTargetCrs: null,
    })
    await screen.findByText(/Chưa tải được bản đồ nền/)
    expect(screen.getByRole('button', { name: '+ Thêm cặp điểm' })).toBeDisabled()
    expect(h.config().controlPoints?.[0]?.target).toEqual([500000, 2300000])
    expect(h.config().sourceCrs).toBe('EPSG:3405')
  })
  it('destroys an asynchronously created map after the panel has already unmounted', async () => {
    let resolve!: (value: typeof port) => void
    vi.mocked(createMapInstance).mockReturnValueOnce(
      new Promise(done => {
        resolve = done
      })
    )
    const h = harness()
    h.unmount()
    resolve(port)
    await waitFor(() => expect(port.destroy).toHaveBeenCalledOnce())
    expect(port.mount).not.toHaveBeenCalled()
  })
})
