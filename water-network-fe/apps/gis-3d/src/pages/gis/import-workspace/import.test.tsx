import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { createSignal, type Accessor, type Setter } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMapInstance } from '@wn/map-runtime-3d'
import { createFakePort } from '@wn/map-runtime-3d/testing'
import type { AuthSessionData } from '@/shared/lib/client-auth'
import { createImportApi, ImportApiError } from './api'
import { reviewForJob, type ImportJob, type ReviewConfig } from './types'
import { ImportScreen } from '../screens/import'

vi.mock('@wn/map-runtime-3d', () => ({ createMapInstance: vi.fn() }))

let session: Accessor<AuthSessionData | null>
let setSession: Setter<AuthSessionData | null>
vi.mock('@/entities/session/api/use-session', () => ({
  useSession: () => ({ data: () => session(), isLoading: () => false }),
}))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: {
    getSession: () => Promise.resolve(session()),
    getAccessToken: () => Promise.resolve('test-token'),
  },
}))

const identity = (tenantId: string): AuthSessionData => ({
  user: {
    id: 'reviewer',
    tenantId,
    permissions: ['network-design:read', 'network-design:write', 'network-gis:read'],
  },
  session: { token: 'test-token' },
})
const caps = { formats: ['dwg', 'dxf'], dwgAvailable: true, maxFileBytes: 50_000_000, maxFiles: 10 }
function jobFixture(): ImportJob {
  return {
    id: 'job-1',
    name: 'Vĩnh Thịnh',
    state: 'needs_review',
    version: 1,
    files: [{ id: 'file-1', name: 'Vinh Thinh.dwg', sha256: 'abc', format: 'dwg', bytes: 2048 }],
    inventory: {
      layers: [
        {
          fileId: 'file-1',
          name: 'ONG',
          count: 2,
          lineCount: 2,
          textCount: 0,
          suggestedAction: 'pipe',
        },
      ],
      files: [{ id: 'file-1', units: 6, bounds: [0, 0, 100, 100], entityCount: 2 }],
      issues: [{ code: 'CRS_REQUIRED', severity: 'error', message: 'Cần xác nhận tọa độ' }],
    },
    createdAt: '2026-09-14T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
  }
}
const page = (version: number) => ({
  type: 'FeatureCollection',
  version,
  total: 2,
  offset: 0,
  hasMore: false,
  coordinateSpace: 'cad',
  features: [
    {
      type: 'Feature',
      id: 'line-1',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [100, 100],
        ],
      },
      properties: { fileId: 'file-1', layer: 'ONG', entityType: 'LINE' },
    },
  ],
})
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let current: ImportJob
let requestLog: { url: string; init: RequestInit }[]
let reviewBody: (ReviewConfig & { expectedVersion: number }) | undefined
let handleRequest: (url: string, init: RequestInit) => Promise<Response>

beforeEach(() => {
  vi.mocked(createMapInstance).mockResolvedValue(createFakePort())
  ;[session, setSession] = createSignal<AuthSessionData | null>(identity('shw'))
  current = jobFixture()
  requestLog = []
  reviewBody = undefined
  handleRequest = async (url, init) => {
    if (url.endsWith('/capabilities')) return response(caps)
    if (url.endsWith('/imports/'))
      return init.method === 'POST'
        ? response({ ...current, id: 'new-job', name: 'Mạng mới', state: 'queued' })
        : response({ items: [current] })
    if (url.includes('/features?')) return response(page(current.version))
    if (url.endsWith('/review')) {
      reviewBody = JSON.parse(String(init.body))
      current = { ...current, version: current.version + 1, reviewConfig: reviewBody }
      return response(current)
    }
    return response(current)
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      requestLog.push({ url, init })
      return handleRequest(url, init)
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function ready() {
  render(() => <ImportScreen />)
  await screen.findByRole('application')
}

describe('CAD import workspace', () => {
  it('undoes and redoes a per-pipe edit and saves its durable geometry', async () => {
    await ready()
    fireEvent.change(screen.getByLabelText('Chọn đối tượng'), { target: { value: 'line-1' } })
    fireEvent.input(screen.getByLabelText('Đường kính tuyến biên tập'), {
      target: { value: '160' },
    })
    fireEvent.change(screen.getByLabelText('Vật liệu tuyến biên tập'), {
      target: { value: 'HDPE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng thuộc tính tuyến' }))
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    expect(screen.getByRole('button', { name: 'Làm lại' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Làm lại' }))
    expect(screen.getByLabelText('Đường kính tuyến biên tập')).toHaveValue('160')
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    await waitFor(() => expect(reviewBody?.lineEdits).toHaveLength(1))
    expect(reviewBody?.lineEdits?.[0]).toMatchObject({
      id: 'line-1',
      diameterMm: 160,
      material: 'HDPE',
      coordinates: [
        [0, 0],
        [100, 100],
      ],
    })
  })

  it('filters and pages all issues beyond the former 200 issue limit', async () => {
    current.issues = Array.from({ length: 225 }, (_, i) => ({
      code: 'CLOSED_PIPE',
      severity: 'error' as const,
      message: `Tuyến lỗi ${i + 1}`,
      featureId: `pipe-${i + 1}`,
    }))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))
    expect(screen.getByText(/225 vấn đề phù hợp/)).toBeInTheDocument()
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }))
    expect(screen.getByText('Tuyến lỗi 225')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trang sau' })).toBeDisabled()
    fireEvent.input(screen.getByLabelText('Tìm vấn đề'), { target: { value: 'pipe-225' } })
    expect(screen.getByText(/1 vấn đề phù hợp/)).toBeInTheDocument()
    expect(screen.getByText('Tuyến lỗi 225')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mức độ vấn đề'), { target: { value: 'warning' } })
    expect(screen.getByText('Không có vấn đề phù hợp bộ lọc.')).toBeInTheDocument()
  })

  it('opens the saved draft map in the GIS alignment view without submitting it', async () => {
    render(() => <ImportScreen draftMap />)
    await screen.findByRole('application')
    expect(screen.getByRole('heading', { name: 'Bản đồ bản nháp' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Về chỉnh sửa bản vẽ' })).toBeInTheDocument()
    expect(requestLog.some(request => request.url.endsWith('/submit'))).toBe(false)
  })

  it('saves and reopens an incomplete draft while keeping Ready submission blocked', async () => {
    const first = render(() => <ImportScreen />)
    await screen.findByRole('application')
    expect(screen.getByRole('button', { name: 'Lưu bản nháp' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Chọn đối tượng'), { target: { value: 'line-1' } })
    fireEvent.input(screen.getByLabelText('Vật liệu lớp đang chọn'), { target: { value: 'HDPE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    await waitFor(() => expect(current.version).toBe(2))
    expect(current.reviewConfig?.sourceCrs).toBeNull()
    expect(current.state).toBe('needs_review')
    expect(screen.getByRole('button', { name: 'Gửi duyệt bản Ready' })).toBeDisabled()
    first.unmount()
    await ready()
    fireEvent.change(screen.getByLabelText('Chọn đối tượng'), { target: { value: 'line-1' } })
    expect(screen.getByLabelText('Vật liệu lớp đang chọn')).toHaveValue('HDPE')
    expect(screen.getByText('Bản nháp · cần rà soát')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Lưu bản nháp' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Gửi duyệt bản Ready' })).toBeDisabled()
    expect(requestLog.some(request => request.url.endsWith('/submit'))).toBe(false)
  })

  it('starts with the CAD map and contextual inspector, keeping table controls behind a panel', async () => {
    await ready()
    expect(screen.getByRole('application')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Căn vị trí trên GIS' })).toBeEnabled()
    expect(screen.queryByLabelText('Vật liệu ONG file-1')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Chọn đối tượng'), { target: { value: 'line-1' } })
    expect(screen.getByLabelText('Phân loại lớp đang chọn')).toBeInTheDocument()
    fireEvent.input(screen.getByLabelText('Vật liệu lớp đang chọn'), { target: { value: 'HDPE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    await waitFor(() => expect(reviewBody).toBeDefined())
    expect(reviewBody?.layerRules[0]?.material).toBe('HDPE')
    await waitFor(() => expect(screen.getByLabelText('Vật liệu lớp đang chọn')).toHaveValue('HDPE'))
  })

  it('keeps alignment on raw CAD, cancels point picking with Escape or mode exit, and preserves the panel after saving', async () => {
    const originalHandler = handleRequest
    handleRequest = async (url, init) => {
      if (url.includes('/features?') && url.includes('view=clean')) {
        const cleaned = page(current.version)
        return response({
          ...cleaned,
          coordinateSpace: 'EPSG:4326',
          features: cleaned.features.map(feature => ({
            ...feature,
            geometry: {
              type: 'LineString',
              coordinates: [
                [105, 21],
                [105.001, 21.001],
              ],
            },
          })),
        })
      }
      return originalHandler(url, init)
    }
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Mạng đã làm sạch' }))
    await screen.findByText('EPSG:4326 · kinh độ / vĩ độ')
    fireEvent.click(screen.getByRole('button', { name: 'Căn vị trí trên GIS' }))
    expect(await screen.findByText('Tọa độ bản vẽ · chưa định vị GIS')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mạng đã làm sạch' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Ghép điểm CAD–GIS' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm cặp điểm' }))
    expect(screen.getByText(/Bấm vào vị trí rõ nét trên CAD/)).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('application'), { key: 'Escape' })
    expect(screen.queryByText(/Bấm vào vị trí rõ nét trên CAD/)).not.toBeInTheDocument()
    expect(screen.getByRole('application')).toHaveAccessibleName(/^Bản xem trước CAD/)

    fireEvent.click(screen.getByRole('button', { name: /^Chọn CAD 1/ }))
    expect(screen.getByText(/Bấm vào vị trí rõ nét trên CAD/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Về chỉnh sửa bản vẽ' }))
    fireEvent.click(screen.getByRole('button', { name: 'Căn vị trí trên GIS' }))
    expect(screen.queryByText(/Bấm vào vị trí rõ nét trên CAD/)).not.toBeInTheDocument()
    expect(screen.getByRole('application')).toHaveAccessibleName(/^Bản xem trước CAD/)

    fireEvent.click(screen.getByRole('button', { name: /^Chọn CAD 1/ }))
    fireEvent.keyDown(screen.getByRole('application'), { key: 'Enter' })
    expect(screen.queryByText(/Bấm vào vị trí rõ nét trên CAD/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lưu điểm đang ghép' }))
    await waitFor(() => expect(reviewBody?.controlPoints).toHaveLength(1))
    expect(reviewBody).toMatchObject({
      sourceCrs: null,
      controlPointTargetCrs: 'EPSG:4326',
      controlPoints: [{ source: [50, 50], target: null, checkOnly: false }],
    })
    await waitFor(() => expect(screen.getByText(/Phiên bản 2/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Về chỉnh sửa bản vẽ' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByLabelText('Căn vị trí trên bản đồ GIS')).toBeInTheDocument()
    expect(await screen.findByText('Tọa độ bản vẽ · chưa định vị GIS')).toBeInTheDocument()
    expect(screen.getByLabelText('CAD điểm 1 X')).toHaveValue(50)
  })

  it('reopens the saved geographic result without resaving and keeps CAD markers out of the clean coordinate space', async () => {
    const port = createFakePort()
    vi.mocked(createMapInstance).mockResolvedValue(port)
    const savedConfig: ReviewConfig = {
      ...reviewForJob(current),
      controlPointTargetCrs: 'EPSG:4326',
      crsEvidence: 'Các mốc khảo sát đã được đối chiếu độc lập.',
      controlPoints: [
        { source: [0, 0], target: [105, 21], checkOnly: false },
        { source: [100, 0], target: [105.001, 21], checkOnly: false },
        { source: [0, 100], target: [105, 21.001], checkOnly: false },
        { source: [40, 40], target: [105.0004, 21.0004], checkOnly: true },
      ],
    }
    current = {
      ...current,
      version: 7,
      reviewConfig: savedConfig,
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
    }
    const originalHandler = handleRequest
    const geographicCoordinates = [
      [105, 21],
      [105.001, 21.001],
    ]
    handleRequest = async (url, init) => {
      if (url.includes('/features?') && url.includes('view=clean')) {
        const cleaned = page(current.version)
        return response({
          ...cleaned,
          coordinateSpace: 'EPSG:4326',
          features: cleaned.features.map(feature => ({
            ...feature,
            geometry: { type: 'LineString', coordinates: geographicCoordinates },
          })),
        })
      }
      return originalHandler(url, init)
    }

    await ready()
    expect(screen.getAllByRole('button', { name: /Điểm đối chiếu CAD/ })).toHaveLength(4)
    expect(requestLog.some(request => request.url.includes('view=clean'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Căn vị trí trên GIS' }))
    await waitFor(() => {
      const overlay = vi
        .mocked(port.setFeatures)
        .mock.calls.filter(call => call[0] === 'georeferenced-cad')
        .at(-1)?.[1]
      expect(overlay?.features[0]?.geometry).toEqual({
        type: 'LineString',
        coordinates: geographicCoordinates,
      })
    })
    expect(requestLog.some(request => request.url.includes('view=clean'))).toBe(true)
    expect(requestLog.some(request => request.url.endsWith('/review'))).toBe(false)
    expect(await screen.findByText('Tọa độ bản vẽ · chưa định vị GIS')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Điểm đối chiếu CAD/ })).toHaveLength(4)
    expect(screen.getByLabelText('CAD điểm 2 X')).toHaveValue(100)
    expect(screen.getByLabelText('GIS điểm 2 kinh độ')).toHaveValue(105.001)
    expect(current.version).toBe(7)
    expect(current.reviewConfig).toEqual(savedConfig)

    fireEvent.click(screen.getByRole('button', { name: 'Về chỉnh sửa bản vẽ' }))
    expect(await screen.findByRole('button', { name: 'Vẽ tuyến nối' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bản CAD đang sửa' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.queryByRole('button', { name: /Điểm đối chiếu CAD/ })).not.toBeInTheDocument()
  })

  it('reopens a saved VN2000 preview with raw CAD and no evidence or extra save', async () => {
    const port = createFakePort()
    vi.mocked(createMapInstance).mockResolvedValue(port)
    current.reviewConfig = {
      ...reviewForJob(current),
      sourceCrs: 'EPSG:5897',
      sourceCrsPresetId: 'tt26-2024-vinh-phuc:TM3',
      sourceAxisOrder: 'xy',
      sourceUnits: 'm',
      crsEvidence: '',
    }
    const original = handleRequest
    handleRequest = async (url, init) => {
      if (url.includes('/features?') && url.includes('view=clean'))
        return response({
          ...page(current.version),
          coordinateSpace: 'EPSG:4326',
          features: [
            {
              ...page(current.version).features[0],
              geometry: {
                type: 'LineString',
                coordinates: [
                  [105.5, 21.1],
                  [105.501, 21.101],
                ],
              },
            },
          ],
        })
      return original(url, init)
    }
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Căn vị trí trên GIS' }))
    await waitFor(() =>
      expect(
        vi
          .mocked(port.setFeatures)
          .mock.calls.filter(call => call[0] === 'georeferenced-cad')
          .at(-1)?.[1].features
      ).toHaveLength(1)
    )
    expect(screen.getByRole('tab', { name: 'VN-2000 / Hệ tọa độ' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByLabelText('Địa bàn VN-2000')).toHaveValue('tt26-2024-vinh-phuc')
    expect(await screen.findByText('Tọa độ bản vẽ · chưa định vị GIS')).toBeInTheDocument()
    expect(requestLog.some(request => request.url.endsWith('/review'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Gửi duyệt bản Ready' })).toBeDisabled()
  })

  it('explains legacy tenant sessions without making unauthorized import requests', async () => {
    const legacy = identity('tnt_hawaco')
    legacy.user.tenantContextSource = 'legacy-tenant-id'
    setSession(legacy)
    render(() => <ImportScreen />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Import DWG cần phiên đăng nhập theo đơn vị đã được cấu hình. Liên hệ quản trị để chọn đơn vị.'
    )
    expect(screen.getByLabelText('Bản vẽ DWG / DXF')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeDisabled()
    await Promise.resolve()
    expect(requestLog).toHaveLength(0)
    await expect(
      createImportApi('reviewer:tnt_hawaco', new AbortController().signal).list()
    ).rejects.toMatchObject({ status: 409 })
    expect(requestLog).toHaveLength(0)

    setSession({ ...legacy, user: { ...legacy.user, tenantContextSource: 'organization' } })
    await screen.findByRole('application')
    fireEvent.click(screen.getByRole('button', { name: 'Tạo hồ sơ mới' }))
    expect(screen.getByLabelText('Bản vẽ DWG / DXF')).toBeEnabled()
    expect(screen.queryByText(/Liên hệ quản trị để chọn đơn vị/)).not.toBeInTheDocument()
  })

  it('removes and restores a saved CAD file with explicit draft persistence', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Xóa Vinh Thinh.dwg' }))
    expect(screen.queryByRole('button', { name: 'Xóa Vinh Thinh.dwg' })).not.toBeInTheDocument()
    expect(screen.getByText(/Chưa có tệp CAD đang dùng/)).toBeInTheDocument()
    expect(screen.getByText('Tệp đã xóa (1)').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: '+ Thêm CAD vào hồ sơ này' })).toBeDisabled()
    expect(requestLog.some(r => r.url.endsWith('/review'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi tệp và bản nháp' }))
    await waitFor(() => expect(reviewBody?.excludedFileIds).toEqual(['file-1']))
    fireEvent.click(await screen.findByText('Tệp đã xóa (1)'))
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục Vinh Thinh.dwg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi tệp và bản nháp' }))
    await waitFor(() => expect(reviewBody?.excludedFileIds).toEqual([]))
  })

  it('clears the selected editor when refresh finds the job deleted on the server', async () => {
    await ready()
    const previous = handleRequest
    handleRequest = (url, init) =>
      url.endsWith('/imports/') ? Promise.resolve(response({ items: [] })) : previous(url, init)
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }))
    await waitFor(() =>
      expect(screen.queryByLabelText('Không gian rà soát bản vẽ')).not.toBeInTheDocument()
    )
    expect(screen.queryByLabelText('Hồ sơ bản vẽ')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bản vẽ DWG / DXF')).toBeInTheDocument()
  })

  it('reopens an empty saved job as upload, without the editor or active job picker', async () => {
    current.reviewConfig = { ...reviewForJob(current), excludedFileIds: ['file-1'] }
    render(() => <ImportScreen />)
    await screen.findByText('Tệp đã xóa (1)')
    expect(screen.queryByLabelText('Hồ sơ bản vẽ')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Không gian rà soát bản vẽ')).not.toBeInTheDocument()
    expect(screen.queryByRole('application')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bản vẽ DWG / DXF')).toBeInTheDocument()
  })

  it('appends selected CAD files to the same job and allows removing pending selections', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '+ Thêm CAD vào hồ sơ này' }))
    expect(screen.queryByLabelText('Tên hồ sơ')).not.toBeInTheDocument()
    const input = screen.getByLabelText('Bản vẽ DWG / DXF')
    fireEvent.change(input, {
      target: { files: [new File(['a'], 'first.dxf'), new File(['b'], 'second.dxf')] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ tệp đã chọn first.dxf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tệp và phân tích' }))
    await waitFor(() => expect(requestLog.some(r => r.url.endsWith('/files'))).toBe(true))
    const request = requestLog.find(r => r.url.endsWith('/files'))!
    expect(request.url).toContain('/' + current.id + '/files')
    const body = request.init.body as FormData
    expect(body.get('expectedVersion')).toBe('1')
    expect((body.getAll('files') as File[]).map(f => f.name)).toEqual(['second.dxf'])
    expect(body.has('tenantId')).toBe(false)
  })

  it('uploads multiple original files in multipart with bearer auth and no tenant override', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Tạo hồ sơ mới' }))
    expect(screen.getByRole('button', { name: 'Gửi duyệt bản Ready' })).toBeDisabled()
    const files = [new File(['AC1021'], 'distribution.dwg'), new File(['AC1032'], 'services.dwg')]
    fireEvent.change(screen.getByLabelText('Bản vẽ DWG / DXF'), { target: { files } })
    fireEvent.input(screen.getByLabelText('Tên hồ sơ'), { target: { value: 'Mạng mới' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tải lên và phân tích' }))
    await waitFor(() =>
      expect(requestLog.some(request => request.init.method === 'POST')).toBe(true)
    )
    const upload = requestLog.find(request => request.init.method === 'POST')!
    const body = upload.init.body as FormData
    expect(body.getAll('files')).toHaveLength(2)
    expect(body.get('name')).toBe('Mạng mới')
    expect(body.has('tenantId')).toBe(false)
    expect(new Headers(upload.init.headers).get('Authorization')).toBe('Bearer test-token')
    expect(new Headers(upload.init.headers).has('Content-Type')).toBe(false)
  })

  it('keeps editable inputs focused, saves mapping and a reversible feature exclusion against the reviewed version', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Lớp dữ liệu' }))
    const material = screen.getByLabelText('Vật liệu ONG file-1')
    material.focus()
    fireEvent.input(material, { target: { value: 'H' } })
    fireEvent.input(material, { target: { value: 'HDPE' } })
    expect(screen.getByLabelText('Vật liệu ONG file-1')).toBe(material)
    expect(document.activeElement).toBe(material)
    fireEvent.input(screen.getByLabelText('Đường kính ONG file-1'), { target: { value: '110' } })
    fireEvent.click(screen.getByRole('button', { name: 'Đối tượng' }))
    fireEvent.change(screen.getByLabelText('Chọn đối tượng'), { target: { value: 'line-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Loại đối tượng này khỏi mạng' }))
    expect(screen.getByRole('button', { name: 'Khôi phục đối tượng' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục đối tượng' }))
    fireEvent.click(screen.getByRole('button', { name: 'Loại đối tượng này khỏi mạng' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    await waitFor(() => expect(reviewBody).toBeDefined())
    expect(reviewBody).toMatchObject({
      expectedVersion: 1,
      sourceCrs: null,
      excludeFeatureIds: ['line-1'],
      layerRules: [
        { fileId: 'file-1', layer: 'ONG', action: 'pipe', diameterMm: 110, material: 'HDPE' },
      ],
    })
  })

  it('rejects unsupported material values without silently changing a CAD hint', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Lớp dữ liệu' }))
    fireEvent.input(screen.getByLabelText('Vật liệu ONG file-1'), { target: { value: 'UPVC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Vật liệu chưa được hỗ trợ')
    expect(screen.getByLabelText('Vật liệu ONG file-1')).toHaveValue('UPVC')
    expect(requestLog.some(request => request.url.endsWith('/review'))).toBe(false)
  })

  it('saves an unconfirmed source CRS for geographic preview while submission stays blocked', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))
    fireEvent.click(screen.getByText('Tọa độ có sẵn và hồ sơ'))
    fireEvent.input(screen.getByLabelText(/Hệ tọa độ nguồn/), { target: { value: 'EPSG:4326' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    await waitFor(() =>
      expect(reviewBody).toMatchObject({ sourceCrs: 'EPSG:4326', crsEvidence: '' })
    )
    expect(screen.getByRole('button', { name: 'Gửi duyệt bản Ready' })).toBeDisabled()
  })

  it('clears the previous tenant and ignores a late preview response after tenant changes', async () => {
    let resolveOldPreview!: (response: Response) => void
    const oldHandler = handleRequest
    handleRequest = async (url, init) => {
      if (url.includes('/features?') && session()?.user.tenantId === 'shw')
        return new Promise(resolve => {
          resolveOldPreview = resolve
        })
      if (url.endsWith('/imports/') && session()?.user.tenantId === 'other')
        return response({ items: [] })
      return oldHandler(url, init)
    }
    render(() => <ImportScreen />)
    await waitFor(() => expect(resolveOldPreview).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Tạo hồ sơ mới' }))
    fireEvent.input(screen.getByLabelText('Tên hồ sơ'), { target: { value: 'private SHW input' } })
    const previousSignals = requestLog.map(request => request.init.signal)
    setSession(identity('other'))
    await waitFor(() => expect(screen.queryByText('Vĩnh Thịnh')).not.toBeInTheDocument())
    resolveOldPreview(response(page(1)))
    await waitFor(() => expect(screen.queryByRole('application')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Tên hồ sơ')).toHaveValue('')
    expect(previousSignals.every(signal => signal?.aborted)).toBe(true)
    expect(await screen.findByText(/Chưa có hồ sơ import của đơn vị/)).toBeInTheDocument()
  })

  it('shows a service error without substituting sample jobs', async () => {
    handleRequest = async () => response({ message: 'not configured' }, 503)
    render(() => <ImportScreen />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Dịch vụ import CAD chưa sẵn sàng')
    expect(screen.queryByText('Vĩnh Thịnh')).not.toBeInTheDocument()
  })

  it('refreshes the server job after a stale review and discards unsaved edits', async () => {
    const original = handleRequest
    handleRequest = async (url, init) => {
      if (url.endsWith('/review')) {
        current = { ...current, version: 7, name: 'Phiên bản mới' }
        return response({ message: 'stale' }, 409)
      }
      return original(url, init)
    }
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Lớp dữ liệu' }))
    fireEvent.input(screen.getByLabelText('Vật liệu ONG file-1'), { target: { value: 'HDPE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Hồ sơ đã thay đổi'))
    await waitFor(() => expect(screen.getByLabelText('Vật liệu ONG file-1')).toHaveValue(''))
    expect(screen.getByText(/Phiên bản 7/)).toBeInTheDocument()
  })

  it('hydrates the source CRS draft atomically after a conflict and previews the recovered settings', async () => {
    current.reviewConfig = {
      ...reviewForJob(current),
      sourceCrs: 'EPSG:5897',
      sourceCrsPresetId: 'tt26-2024-vinh-phuc:TM3',
      sourceAxisOrder: 'xy',
      sourceUnits: 'm',
    }
    const recoveredSettings = {
      sourceCrs: 'EPSG:3406',
      sourceCrsPresetId: 'tt26-2024-dak-lak:UTM49N',
      sourceAxisOrder: 'yx' as const,
      sourceUnits: 'mm' as const,
    }
    const original = handleRequest
    let rejected = false
    handleRequest = async (url, init) => {
      if (url.endsWith('/review') && !rejected) {
        rejected = true
        current = {
          ...current,
          version: 7,
          reviewConfig: {
            ...current.reviewConfig!,
            ...recoveredSettings,
            crsEvidence: 'Hồ sơ mới đã xác nhận thứ tự trục và đơn vị.',
          },
        }
        return response({ message: 'stale' }, 409)
      }
      return original(url, init)
    }

    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Căn vị trí trên GIS' }))
    expect(screen.getByLabelText('Địa bàn VN-2000')).toHaveValue('tt26-2024-vinh-phuc')
    fireEvent.click(screen.getByRole('button', { name: 'Xem trên bản đồ' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Hồ sơ đã thay đổi'))
    expect(await screen.findByText(/Phiên bản 7/)).toBeInTheDocument()
    expect(screen.getByLabelText('Địa bàn VN-2000')).toHaveValue('tt26-2024-dak-lak')
    expect(screen.getByLabelText('Phép chiếu VN-2000')).toHaveValue('UTM49N')
    expect(screen.getByLabelText('Hệ tọa độ nguồn tùy chỉnh')).toHaveValue('EPSG:3406')
    expect(screen.getByLabelText('Thứ tự trục CAD')).toHaveValue('yx')
    expect(screen.getByLabelText('Đơn vị tọa độ CAD')).toHaveValue('mm')
    expect(requestLog.filter(request => request.url.endsWith('/review'))).toHaveLength(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Xem trên bản đồ' })).toBeEnabled()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Xem trên bản đồ' }))
    await waitFor(() =>
      expect(reviewBody).toMatchObject({
        ...recoveredSettings,
        expectedVersion: 7,
        crsEvidence: '',
      })
    )
  })
})

describe('CAD blocks and Design approval', () => {
  it('requires explicit device type and host and saves the original feature IDs', async () => {
    current.inventory!.blocks = [
      {
        fileId: 'file-1',
        name: 'VAN',
        count: 1,
        isXref: false,
        sampleFeatureIds: ['valve-1'],
        suggestedAction: 'review',
      },
    ]
    const original = handleRequest
    handleRequest = async (url, init) => {
      if (url.includes('/features?'))
        return response({
          ...page(current.version),
          features: [
            ...page(current.version).features,
            {
              type: 'Feature',
              id: 'valve-1',
              geometry: { type: 'Point', coordinates: [0, 0] },
              properties: {
                fileId: 'file-1',
                layer: 'ONG',
                entityType: 'INSERT',
                blockName: 'VAN',
                parentId: null,
              },
            },
          ],
        })
      return original(url, init)
    }
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Ký hiệu' }))
    fireEvent.change(screen.getByLabelText('Phân loại ký hiệu VAN file-1'), {
      target: { value: 'device' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Chọn loại nút hoặc thiết bị')
    fireEvent.change(screen.getByLabelText('Loại thiết bị VAN'), { target: { value: 'Valve' } })
    fireEvent.input(screen.getByLabelText('Đối tượng chứa valve-1'), {
      target: { value: 'line-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }))
    await waitFor(() =>
      expect(reviewBody?.deviceHosts).toEqual([{ featureId: 'valve-1', hostFeatureId: 'line-1' }])
    )
    expect(reviewBody?.blockRules).toEqual([
      { fileId: 'file-1', blockName: 'VAN', action: 'device', deviceType: 'Valve' },
    ])
  })

  it('collects lifecycle evidence at approval and gates publishing by permission and evidence', async () => {
    current.reviewConfig = {
      ...reviewForJob(current),
      sourceCrs: 'EPSG:4326',
      crsEvidence: 'Survey report',
    }
    current.state = 'submitted'
    current.submission = { revisionId: 'revision-1', status: 'Submitted' }
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))
    expect(screen.queryByRole('button', { name: 'Xuất bản sau duyệt' })).not.toBeInTheDocument()
    setSession({
      ...identity('shw'),
      user: {
        ...identity('shw').user,
        permissions: [
          'network-design:approve',
          'network-design:read',
          'network-design:write',
          'network-gis:read',
        ],
      },
    })
    expect(screen.getByRole('button', { name: 'Xuất bản sau duyệt' })).toBeDisabled()
    fireEvent.input(screen.getByLabelText('Lý do phê duyệt và xuất bản'), {
      target: { value: 'Đã đối soát' },
    })
    expect(screen.getByRole('button', { name: 'Xuất bản sau duyệt' })).toBeDisabled()
    fireEvent.input(screen.getByLabelText('Căn cứ hiện trạng để xuất bản'), {
      target: { value: 'Biên bản hoàn công đã ký' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản sau duyệt' }))
    await waitFor(() =>
      expect(requestLog.some(request => request.url.endsWith('/publish'))).toBe(true)
    )
    expect(
      JSON.parse(String(requestLog.find(request => request.url.endsWith('/publish'))!.init.body))
    ).toEqual({
      expectedVersion: 1,
      reason: 'Đã đối soát',
      lifecycleEvidence: 'Biên bản hoàn công đã ký',
    })
  })

  it('refreshes an ambiguous submission response and retries the persisted revision', async () => {
    current.reviewConfig = {
      ...reviewForJob(current),
      sourceCrs: 'EPSG:4326',
      crsEvidence: 'Survey report',
    }
    current.state = 'ready'
    const original = handleRequest
    handleRequest = async (url, init) => {
      if (url.endsWith('/submit')) {
        current = {
          ...current,
          state: 'submitted',
          submission: { revisionId: 'revision-1', status: 'RetryRequired' },
        }
        return response({ detail: 'Validation gateway unavailable' }, 502)
      }
      return original(url, init)
    }
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt bản Ready' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))
    expect(await screen.findByRole('button', { name: 'Thử lại gửi duyệt' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Validation gateway unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại gửi duyệt' }))
    await waitFor(() =>
      expect(requestLog.filter(request => request.url.endsWith('/submit'))).toHaveLength(2)
    )
    expect(
      requestLog
        .filter(request => request.url.endsWith('/submit'))
        .map(request => JSON.parse(String(request.init.body)).expectedVersion)
    ).toEqual([1, 1])
  })
})

describe('import API boundary', () => {
  it('normalizes nullable optional CAD attributes without inventing values', async () => {
    const raw = {
      ...jobFixture(),
      reviewConfig: {
        ...reviewForJob(jobFixture()),
        layerRules: [
          { fileId: 'file-1', layer: 'ONG', action: 'pipe', diameterMm: null, material: null },
        ],
        blockRules: [
          {
            fileId: 'file-1',
            blockName: 'VAN',
            action: 'review',
            nodeType: null,
            deviceType: null,
          },
        ],
      },
    }
    handleRequest = async () => response(raw)
    const result = await createImportApi('reviewer:shw', new AbortController().signal).get('job-1')
    expect(result.reviewConfig?.layerRules[0]?.material).toBeUndefined()
    expect(result.reviewConfig?.blockRules?.[0]?.nodeType).toBeUndefined()
  })

  it('rejects malformed server data', async () => {
    handleRequest = async () => response({ items: [{ id: 'missing-fields' }] })
    await expect(
      createImportApi('reviewer:shw', new AbortController().signal).list()
    ).rejects.toBeInstanceOf(ImportApiError)
  })
  it('rejects requests captured for a different tenant before dispatching', async () => {
    setSession(identity('other'))
    await expect(
      createImportApi('reviewer:shw', new AbortController().signal).list()
    ).rejects.toMatchObject({ status: 409 })
    expect(requestLog).toHaveLength(0)
  })
  it('does not send a request after its workspace has been aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(createImportApi('reviewer:shw', controller.signal).list()).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(requestLog).toHaveLength(0)
  })
})
