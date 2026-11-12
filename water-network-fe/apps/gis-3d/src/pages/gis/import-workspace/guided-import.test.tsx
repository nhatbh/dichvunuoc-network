import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { createMapInstance } from '@wn/map-runtime-3d'
import { createFakePort } from '@wn/map-runtime-3d/testing'
import { createSignal, type Accessor } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSessionData } from '@/shared/lib/client-auth'
import {
  choiceFromPreset,
  choicePatch,
  evidenceFor,
  jobSuggestion,
  type CrsSuggestion,
} from './crs-suggestion'
import { currentStep } from './guided-import'
import type { ImportJob, ReviewConfig } from './types'
import { ImportScreen } from '../screens/import'

vi.mock('@wn/map-runtime-3d', () => ({ createMapInstance: vi.fn() }))
let session: Accessor<AuthSessionData | null>
vi.mock('@/entities/session/api/use-session', () => ({
  useSession: () => ({ data: () => session(), isLoading: () => false }),
}))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: {
    getSession: () => Promise.resolve(session()),
    getAccessToken: () => Promise.resolve('test-token'),
  },
}))

const footprint: Array<[number, number]> = [
  [105.48, 21.16],
  [105.51, 21.16],
  [105.51, 21.2],
  [105.48, 21.2],
  [105.48, 21.16],
]
const vinhPhuc: CrsSuggestion = {
  status: 'detected',
  crs: 'EPSG:5897',
  presetId: 'tt26-2024-vinh-phuc:TM3',
  units: 'm',
  axisOrder: 'xy',
  confidence: 'medium',
  evidence: [
    { kind: 'extents', text: 'Tọa độ E 551,142 / N 2,342,767 — VN-2000 phẳng, mét' },
    {
      kind: 'locality',
      text: 'nhà máy nước sạch sông hồng cấp cho khu vực phía nam tỉnh vĩnh phúc',
    },
  ],
  candidates: [
    {
      presetId: 'tt26-2024-vinh-phuc:TM3',
      label: 'Vĩnh Phúc',
      crs: 'EPSG:5897',
      consistent: true,
      distanceKm: 18,
      footprint,
    },
  ],
  checks: [{ code: 'NEAR_LOCALITY', ok: true, message: 'Cách trung tâm Vĩnh Phúc 18 km' }],
  footprint,
}
const unknown: CrsSuggestion = {
  ...vinhPhuc,
  status: 'unknown',
  crs: null,
  presetId: null,
  evidence: [{ kind: 'extents', text: 'Tọa độ E 551,142 / N 2,342,767 — VN-2000 phẳng, mét' }],
  candidates: [],
  checks: [],
  footprint: null,
}

const caps = { formats: ['dwg', 'dxf'], dwgAvailable: true, maxFileBytes: 50_000_000, maxFiles: 10 }
const baseConfig = (): ReviewConfig => ({
  sourceCrs: null,
  sourceAxisOrder: 'xy',
  sourceUnits: 'm',
  sourceCrsPresetId: null,
  crsEvidence: '',
  lifecycleEvidence: '',
  controlPoints: [],
  controlPointTargetCrs: null,
  controlPointMaxErrorM: 0.2,
  fileCrs: [],
  excludeFeatureIds: [],
  acceptWarningCodes: [],
  snapToleranceM: 0.05,
  simplifyToleranceM: 0,
  minLengthM: 0.1,
  hostToleranceM: 0.5,
  deviceHosts: [],
  blockRules: [],
  layerRules: [
    { fileId: 'file-1', layer: 'ONG', action: 'pipe' },
    { fileId: 'file-1', layer: 'KHUNG TEN', action: 'review' },
  ],
})
function job(suggestion: CrsSuggestion | null, change: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    name: '1.MB-PP-Vinh Thinh - Dot 3',
    state: 'needs_review',
    version: 1,
    files: [{ id: 'file-1', name: 'Vinh Thinh.dwg', sha256: 'abc', format: 'dwg', bytes: 2048 }],
    inventory: {
      layers: [
        {
          fileId: 'file-1',
          name: 'ONG',
          count: 12,
          lineCount: 12,
          textCount: 0,
          suggestedAction: 'pipe',
        },
        {
          fileId: 'file-1',
          name: 'KHUNG TEN',
          count: 40,
          lineCount: 30,
          textCount: 10,
          suggestedAction: 'review',
        },
      ],
      files: [
        {
          id: 'file-1',
          units: 6,
          bounds: [549412, 2340860, 552486, 2344742],
          entityCount: 52,
          ...(suggestion ? { crsSuggestion: suggestion } : {}),
        },
      ],
      issues: [],
    },
    issues: [{ code: 'CRS_REQUIRED', severity: 'error', message: 'Cần xác nhận tọa độ' }],
    summary: {
      rawFeatures: 52,
      keptPipes: 12,
      excluded: 0,
      duplicates: 0,
      nodes: 13,
      devices: 0,
      totalLengthM: 1834.4,
      errors: 1,
      warnings: 0,
    },
    reviewConfig: baseConfig(),
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    ...change,
  }
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const emptyPage = (version: number) => ({
  type: 'FeatureCollection',
  version,
  total: 0,
  offset: 0,
  hasMore: false,
  coordinateSpace: 'cad',
  features: [],
})

let jobs: ImportJob[]
let requests: { url: string; init: RequestInit }[]
let reviewBody: (ReviewConfig & { expectedVersion: number }) | undefined
let port: ReturnType<typeof createFakePort>

beforeEach(() => {
  localStorage.removeItem('wn.import.mode')
  port = createFakePort()
  vi.mocked(createMapInstance).mockResolvedValue(port)
  ;[session] = createSignal<AuthSessionData | null>({
    user: {
      id: 'u1',
      name: 'Nguyễn Văn A',
      tenantId: 'tnt_hawaco',
      permissions: ['network-design:read', 'network-design:write', 'network-gis:read'],
    },
    session: { token: 'test-token' },
  })
  jobs = [job(vinhPhuc)]
  requests = []
  reviewBody = undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      requests.push({ url, init })
      const current = jobs[0]
      if (url.endsWith('/capabilities')) return response(caps)
      if (url.endsWith('/imports/'))
        return init.method === 'POST'
          ? response(job(vinhPhuc, { id: 'new-job', state: 'queued' }))
          : response({ items: jobs })
      if (url.includes('/features?')) return response(emptyPage(current?.version ?? 1))
      if (url.endsWith('/review') && current) {
        reviewBody = JSON.parse(String(init.body))
        jobs = [{ ...current, version: current.version + 1, reviewConfig: reviewBody }]
        return response(jobs[0])
      }
      if (url.endsWith('/submit') && current) {
        jobs = [{ ...current, state: 'submitted', submission: { status: 'Submitted' } }]
        return response(jobs[0])
      }
      return response(current)
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem('wn.import.mode')
})

describe('guided CAD import', () => {
  it('starts with an upload drop zone and names the job from the file', async () => {
    jobs = []
    render(() => <ImportScreen />)
    const input = await screen.findByLabelText('Chọn bản vẽ DWG / DXF')
    const file = new File(['x'], '1.MB-PP-Vinh Thinh - Dot 3.dwg')
    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getByLabelText('Tên hồ sơ')).toHaveValue('1.MB-PP-Vinh Thinh - Dot 3')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tạo hồ sơ và phân tích' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tạo hồ sơ và phân tích' }))
    await waitFor(() =>
      expect(requests.some(r => r.url.endsWith('/imports/') && r.init.method === 'POST')).toBe(true)
    )
  })

  it('fills in the detected coordinates, shows the drawing on the map and records evidence on confirm', async () => {
    render(() => <ImportScreen />)
    expect(await screen.findByText('Đã tự nhận vị trí từ bản vẽ')).toBeInTheDocument()
    expect(screen.getByText(/Vĩnh Phúc · TM-3 KTT 105°00' · EPSG:5897 · mét/)).toBeInTheDocument()
    expect(screen.getByText(/phía nam tỉnh vĩnh phúc/)).toBeInTheDocument()
    await waitFor(() => {
      const call = [...vi.mocked(port.setFeatures).mock.calls]
        .reverse()
        .find(([id]) => id === 'drawing-extent')
      expect(call?.[1].features).toHaveLength(1)
    })
    expect(port.fitToBbox).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Đúng vị trí, tiếp tục' }))
    await waitFor(() => expect(reviewBody).toBeDefined())
    expect(reviewBody).toMatchObject({
      sourceCrs: 'EPSG:5897',
      sourceCrsPresetId: 'tt26-2024-vinh-phuc:TM3',
      sourceUnits: 'm',
      sourceAxisOrder: 'xy',
    })
    expect(reviewBody!.crsEvidence).toContain('Đề xuất tự động từ bản vẽ')
    expect(reviewBody!.crsEvidence).toContain('tỉnh vĩnh phúc')
    expect(reviewBody!.crsEvidence).toContain('Nguyễn Văn A')
    // located: the flow moves on to the network check
    expect(await screen.findByText('Lớp chưa phân loại (1 / 1)')).toBeInTheDocument()
  })

  it('lets the user choose when nothing is detected, previewing before recording evidence', async () => {
    jobs = [job(unknown)]
    render(() => <ImportScreen />)
    expect(await screen.findByText('Chưa tự xác định được vị trí')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Địa bàn VN-2000'), {
      target: { value: 'tt26-2024-ha-noi' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Xem trên bản đồ' }))
    await waitFor(() => expect(reviewBody?.sourceCrs).toBe('EPSG:5897'))
    expect(reviewBody!.crsEvidence).toBe('')
    expect(reviewBody!.sourceCrsPresetId).toBe('tt26-2024-ha-noi:TM3')
  })

  it('classifies pending layers, lists blocking errors and opens the advanced workspace to fix', async () => {
    const located = baseConfig()
    located.sourceCrs = 'EPSG:5897'
    located.sourceCrsPresetId = 'tt26-2024-vinh-phuc:TM3'
    located.crsEvidence = 'Đã xác nhận'
    jobs = [
      job(vinhPhuc, {
        reviewConfig: located,
        issues: [
          {
            code: 'UNMAPPED_FEATURES',
            severity: 'error',
            message: 'Còn 40 đối tượng chưa phân loại',
          },
        ],
      }),
    ]
    render(() => <ImportScreen />)
    expect(await screen.findByText('Lớp chưa phân loại (1 / 1)')).toBeInTheDocument()
    expect(screen.getByText('Còn 40 đối tượng chưa phân loại')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Phân loại lớp KHUNG TEN' })
    fireEvent.click(group.querySelectorAll('button')[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng và phân tích lại' }))
    await waitFor(() => expect(reviewBody).toBeDefined())
    expect(reviewBody!.layerRules.find(r => r.layer === 'KHUNG TEN')?.action).toBe('reference')
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    expect(await screen.findByRole('application')).toBeInTheDocument()
    expect(localStorage.getItem('wn.import.mode')).toBe('advanced')
  })

  it('fills the DN from a size-named layer and sets the material for pipe layers', async () => {
    const located = baseConfig()
    located.sourceCrs = 'EPSG:5897'
    located.crsEvidence = 'Đã xác nhận'
    located.layerRules.push({ fileId: 'file-1', layer: '110', action: 'review' })
    jobs = [job(vinhPhuc, { reviewConfig: located })]
    render(() => <ImportScreen />)
    const group = await screen.findByRole('group', { name: 'Phân loại lớp 110' })
    fireEvent.click(group.querySelector('button')!)
    expect(screen.getByLabelText('Đường kính lớp 110')).toHaveValue(110)
    fireEvent.change(screen.getByLabelText('Vật liệu cho các lớp còn trống'), {
      target: { value: 'HDPE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng và phân tích lại' }))
    await waitFor(() => expect(reviewBody).toBeDefined())
    expect(reviewBody!.layerRules.find(r => r.layer === '110')).toMatchObject({
      action: 'pipe',
      diameterMm: 110,
      material: 'HDPE',
    })
    expect(reviewBody!.layerRules.find(r => r.layer === 'ONG')?.material).toBe('HDPE')
  })

  it('submits a ready job and shows its status', async () => {
    const located = baseConfig()
    located.sourceCrs = 'EPSG:5897'
    located.sourceCrsPresetId = 'tt26-2024-vinh-phuc:TM3'
    located.crsEvidence = 'Đã xác nhận'
    located.layerRules = located.layerRules.map(r => ({
      ...r,
      action: r.action === 'review' ? 'reference' : r.action,
    }))
    jobs = [job(vinhPhuc, { state: 'ready', reviewConfig: located, issues: [] })]
    render(() => <ImportScreen />)
    expect(await screen.findByText('Sẵn sàng gửi duyệt')).toBeInTheDocument()
    expect(screen.getByText(/12 tuyến ống · 1\.834 m · 13 nút/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }))
    expect(await screen.findByText('Đã gửi duyệt')).toBeInTheDocument()
    expect(requests.some(r => r.url.endsWith('/submit'))).toBe(true)
  })

  it('switches to the advanced workspace and back, remembering the choice', async () => {
    render(() => <ImportScreen />)
    await screen.findByText('Đã tự nhận vị trí từ bản vẽ')
    fireEvent.click(screen.getByRole('button', { name: 'Chế độ chuyên sâu' }))
    expect(await screen.findByRole('application')).toBeInTheDocument()
    expect(localStorage.getItem('wn.import.mode')).toBe('advanced')
    fireEvent.click(screen.getByRole('button', { name: 'Nhập nhanh' }))
    expect(await screen.findByText('Đã tự nhận vị trí từ bản vẽ')).toBeInTheDocument()
  })
})

describe('CRS suggestion helpers', () => {
  it('derives the step from the saved job', () => {
    expect(currentStep(null)).toBe('upload')
    expect(currentStep(job(vinhPhuc))).toBe('location')
    const located = job(vinhPhuc, {
      reviewConfig: { ...baseConfig(), sourceCrs: 'EPSG:5897', crsEvidence: 'x' },
    })
    expect(currentStep(located)).toBe('network')
    expect(currentStep({ ...located, state: 'ready' })).toBe('submit')
  })

  it('marks files that disagree as ambiguous', () => {
    const two = job(vinhPhuc)
    two.inventory!.files.push({
      id: 'file-2',
      units: 6,
      bounds: null,
      entityCount: 1,
      crsSuggestion: { ...vinhPhuc, crs: 'EPSG:9209', presetId: 'tt26-2024-hai-duong:TM3' },
    } as never)
    expect(jobSuggestion(two)?.status).toBe('ambiguous')
    expect(jobSuggestion(two, ['file-2'])?.status).toBe('detected')
  })

  it('maps presets and choices to the review config', () => {
    expect(choiceFromPreset(null, 'EPSG:3405')).toEqual({ localityId: '', projection: 'UTM48N' })
    expect(choiceFromPreset('tt26-2024-vinh-phuc:TM3')).toEqual({
      localityId: 'tt26-2024-vinh-phuc',
      projection: 'TM3',
    })
    expect(
      choicePatch({ localityId: '', projection: 'UTM49N', units: 'mm', axisOrder: 'yx' })
    ).toMatchObject({
      sourceCrs: 'EPSG:3406',
      sourceUnits: 'mm',
      sourceAxisOrder: 'yx',
      controlPoints: [],
    })
    const evidence = evidenceFor(
      { localityId: 'tt26-2024-ha-noi', projection: 'TM3', units: 'm', axisOrder: 'xy' },
      vinhPhuc,
      'B'
    )
    expect(evidence).toContain('khác đề xuất tự động')
  })
})
