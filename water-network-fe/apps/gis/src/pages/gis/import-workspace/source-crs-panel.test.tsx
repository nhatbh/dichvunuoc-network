import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceCrsPanel } from './source-crs-panel'
import {
  canSubmitJob,
  reviewForJob,
  reviewSchema,
  validateReview,
  type FeaturePage,
  type ImportJob,
  type ReviewConfig,
} from './types'
import { vn2000Localities } from './vn2000-catalog'
import type { createImportWorkspace } from './workspace'

const job: ImportJob = {
  id: 'source-job',
  name: 'Source CRS',
  state: 'needs_review',
  version: 1,
  files: [],
  createdAt: '',
  updatedAt: '',
}
const page: FeaturePage = {
  type: 'FeatureCollection',
  features: [],
  coordinateSpace: 'EPSG:4326',
  version: 1,
  total: 0,
  offset: 0,
  hasMore: false,
}
const place = vn2000Localities.find(item => item.provinceLabel === 'Vĩnh Phúc')!
afterEach(cleanup)
function harness(initial: Partial<ReviewConfig> = {}) {
  const [config, setConfig] = createSignal<ReviewConfig>({ ...reviewForJob(job), ...initial })
  const [dirty, setDirty] = createSignal(false)
  const [preview, setPreview] = createSignal<FeaturePage | null>(null)
  const [locked, setLocked] = createSignal(false)
  const requests: ReviewConfig[] = []
  const save = vi.fn(async () => {
    requests.push(structuredClone(config()))
    setDirty(false)
  })
  const setView = vi.fn()
  const w = {
    config,
    dirty,
    preview,
    locked,
    job: () => job,
    error: () => '',
    save,
    setView,
    edit: (fn: (c: ReviewConfig) => ReviewConfig) => {
      if (!locked()) {
        setConfig(fn)
        setDirty(true)
      }
    },
  } as unknown as ReturnType<typeof createImportWorkspace>
  render(() => <SourceCrsPanel workspace={w} />)
  return { config, setConfig, requests, save, setPreview, setLocked, setView }
}
function selectPreset(projection = 'TM3') {
  fireEvent.change(screen.getByLabelText('Địa bàn VN-2000'), { target: { value: place.id } })
  fireEvent.change(screen.getByLabelText('Phép chiếu VN-2000'), { target: { value: projection } })
}

describe('declared source CRS workbench', () => {
  it('starts without a guessed preset and distinguishes historical TM3 from UTM', () => {
    const h = harness()
    expect(screen.getByLabelText('Địa bàn VN-2000')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Xem trên bản đồ' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Địa bàn VN-2000'), { target: { value: place.id } })
    expect(h.config().sourceCrs).toBeNull()
    expect(screen.getByLabelText('Phép chiếu VN-2000')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Phép chiếu VN-2000'), { target: { value: 'TM3' } })
    expect(h.config()).toMatchObject({
      sourceCrs: 'EPSG:5897',
      sourceCrsPresetId: `${place.id}:TM3`,
    })
    expect(screen.getByText('0.9999')).toBeInTheDocument()
    expect(screen.getByText('105°')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Phép chiếu VN-2000'), { target: { value: 'UTM48N' } })
    expect(h.config().sourceCrs).toBe('EPSG:3405')
    expect(screen.getByText('0.9996')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Phép chiếu VN-2000'), { target: { value: 'UTM49N' } })
    expect(h.config().sourceCrs).toBe('EPSG:3406')
    expect(screen.getByText('111°')).toBeInTheDocument()
  })
  it('clears stale evidence for a changed axis, unit or preset and saves unconfirmed preview settings', async () => {
    const h = harness({
      sourceCrs: 'EPSG:5897',
      crsEvidence: 'Earlier verification',
      sourceCrsPresetId: `${place.id}:TM3`,
    })
    fireEvent.change(screen.getByLabelText('Thứ tự trục CAD'), { target: { value: 'yx' } })
    fireEvent.change(screen.getByLabelText('Đơn vị tọa độ CAD'), { target: { value: 'mm' } })
    expect(h.config()).toMatchObject({ sourceAxisOrder: 'yx', sourceUnits: 'mm', crsEvidence: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Xem trên bản đồ' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce())
    expect(h.requests[0]).toMatchObject({
      sourceCrs: 'EPSG:5897',
      sourceAxisOrder: 'yx',
      sourceUnits: 'mm',
      crsEvidence: '',
    })
    expect(validateReview(h.requests[0]!)).toBeNull()
    expect(canSubmitJob({ ...job, state: 'ready', reviewConfig: h.requests[0] }, false)).toBe(false)
    expect(h.setView).toHaveBeenCalledWith('clean')
  })
  it('records evidence only after a current geographic preview and explicit confirmation', async () => {
    const h = harness({ sourceCrs: 'EPSG:5897' })
    expect(screen.queryByLabelText('Căn cứ xác nhận hệ tọa độ')).not.toBeInTheDocument()
    h.setPreview(page)
    const confirm = screen.getByRole('button', { name: 'Lưu căn cứ xác nhận' })
    fireEvent.input(screen.getByLabelText('Căn cứ xác nhận hệ tọa độ'), {
      target: { value: 'Measured benchmarks verified 2026-09-15' },
    })
    expect(h.config().crsEvidence).toBe('')
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Tôi đã đối chiếu vị trí/))
    fireEvent.click(confirm)
    await waitFor(() => expect(h.requests).toHaveLength(1))
    expect(h.requests[0]?.crsEvidence).toBe('Measured benchmarks verified 2026-09-15')
    h.setPreview({ ...page, version: 0 })
    expect(screen.queryByRole('button', { name: 'Lưu căn cứ xác nhận' })).not.toBeInTheDocument()
  })
  it('keeps pairs intact until an explicit mode conversion and allows restoration through config discard', () => {
    const pair = {
      source: [12, 34] as [number, number],
      target: [105, 21] as [number, number],
      checkOnly: false,
    }
    const h = harness({
      controlPoints: [pair],
      controlPointTargetCrs: 'EPSG:4326',
      crsEvidence: 'Point evidence',
    })
    const before = structuredClone(h.config())
    selectPreset()
    fireEvent.change(screen.getByLabelText('Thứ tự trục CAD'), { target: { value: 'yx' } })
    expect(h.config()).toEqual(before)
    expect(screen.getByRole('button', { name: 'Xem trên bản đồ' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang hệ tọa độ đã chọn' }))
    expect(h.config()).toMatchObject({
      sourceCrs: 'EPSG:5897',
      sourceAxisOrder: 'yx',
      controlPoints: [],
      controlPointTargetCrs: null,
      fileCrs: [],
      crsEvidence: '',
    })
    h.setConfig(before)
    expect(h.config().controlPoints).toEqual([pair])
    expect(screen.getByRole('button', { name: 'Xem trên bản đồ' })).toBeDisabled()
  })
  it('supports explicit manual CRS and keeps locked sessions read-only', () => {
    const h = harness()
    fireEvent.input(screen.getByLabelText('Hệ tọa độ nguồn tùy chỉnh'), {
      target: { value: 'EPSG:3405' },
    })
    expect(h.config()).toMatchObject({ sourceCrs: 'EPSG:3405', sourceCrsPresetId: null })
    h.setLocked(true)
    expect(screen.getByLabelText('Hệ tọa độ nguồn tùy chỉnh')).toBeDisabled()
    expect(screen.getByLabelText('Thứ tự trục CAD')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Xem trên bản đồ' })).toBeDisabled()
  })
  it('round trips normalization metadata and rejects ambiguous normalization in paired-point mode', () => {
    const parsed = reviewSchema.parse({
      ...reviewForJob(job),
      sourceCrs: 'EPSG:5897',
      sourceAxisOrder: 'yx',
      sourceUnits: 'mm',
      sourceCrsPresetId: `${place.id}:TM3`,
    })
    expect(parsed.sourceAxisOrder).toBe('yx')
    expect(parsed.sourceUnits).toBe('mm')
    expect(validateReview(parsed)).toBeNull()
    expect(
      validateReview({ ...parsed, sourceCrs: null, controlPointTargetCrs: 'EPSG:4326' })
    ).toMatch(/tọa độ CAD gốc/)
    expect(reviewSchema.safeParse({ ...parsed, sourceAxisOrder: 'guess' }).success).toBe(false)
  })
})
