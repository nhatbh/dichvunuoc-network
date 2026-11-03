import { describe, expect, it } from 'vitest'
import {
  authoritativeOverlay,
  controlPointFeatures,
  inspectControlPoints,
} from './georeference-model'
import {
  canSubmitJob,
  jobSchema,
  reviewForJob,
  reviewSchema,
  validateReview,
  type CadFeature,
  type ControlPoint,
  type ImportJob,
} from './types'

export const pairedPoints: ControlPoint[] = [
  { source: [1000000, 2000000], target: [105.8, 21], checkOnly: false },
  { source: [1000100, 2000000], target: [105.801, 21], checkOnly: false },
  { source: [1000000, 2000100], target: [105.8, 21.001], checkOnly: false },
  { source: [1000050, 2000050], target: [105.8005, 21.0005], checkOnly: true },
]
const job: ImportJob = {
  id: 'one',
  name: 'Test',
  version: 1,
  state: 'needs_review',
  files: [],
  createdAt: '',
  updatedAt: '',
}
const config = () => ({
  ...reviewForJob(job),
  controlPoints: structuredClone(pairedPoints),
  controlPointTargetCrs: 'EPSG:4326' as const,
  crsEvidence: 'Survey benchmarks 2026-09-15',
})
const diagnostic = {
  status: 'valid' as const,
  targetCrs: 'EPSG:4326',
  fitPointCount: 3,
  checkPointCount: 1,
  thresholdM: 0.2,
  maxErrorM: 0.03,
  rmseM: 0.02,
  residuals: [{ index: 3, checkOnly: true, errorM: 0.03 }],
  workingCrs: '+proj=aeqd +ellps=WGS84',
  error: null,
}

describe('GIS control-point contract', () => {
  it('round trips incomplete pairs and WGS84 target mode without declaring a CAD CRS', () => {
    const parsed = jobSchema.parse({
      ...job,
      reviewConfig: {
        ...config(),
        controlPoints: [
          { source: [7, 8], target: null, checkOnly: false },
          { source: null, target: [105, 21], checkOnly: true },
        ],
      },
      georeference: {
        ...diagnostic,
        status: 'incomplete',
        maxErrorM: null,
        rmseM: null,
        residuals: [],
      },
    })
    expect(parsed.reviewConfig?.sourceCrs).toBeNull()
    expect(parsed.reviewConfig?.controlPointTargetCrs).toBe('EPSG:4326')
    expect(parsed.reviewConfig?.controlPoints?.[0]?.target).toBeNull()
    expect(reviewForJob(parsed)).toEqual(parsed.reviewConfig)
    expect(validateReview(parsed.reviewConfig!)).toBeNull()
  })
  it('accepts legacy projected control points without changing their target CRS', () => {
    const legacy = reviewSchema.parse({
      ...config(),
      controlPointTargetCrs: null,
      sourceCrs: 'EPSG:3405',
      controlPoints: [{ source: [0, 0], target: [500000, 2322212], checkOnly: false }],
    })
    expect(legacy.controlPoints?.[0]?.target).toEqual([500000, 2322212])
  })
  it('rejects mixed coordinate modes and non-finite or out-of-range GIS points', () => {
    expect(validateReview({ ...config(), sourceCrs: 'EPSG:3405' })).toMatch(/không kết hợp/)
    expect(
      validateReview({ ...config(), fileCrs: [{ fileId: 'one', sourceCrs: 'EPSG:3405' }] })
    ).toMatch(/không kết hợp/)
    expect(
      validateReview({
        ...config(),
        controlPoints: [{ source: [0, NaN], target: null, checkOnly: false }],
      })
    ).toMatch(/hữu hạn/)
    expect(
      validateReview({
        ...config(),
        controlPoints: [{ source: [0, 0], target: [105, 91], checkOnly: false }],
      })
    ).toMatch(/kinh độ/)
  })
  it('keeps submission gated by authoritative readiness and valid georeference evidence', () => {
    const ready = {
      ...job,
      state: 'ready' as const,
      reviewConfig: config(),
      georeference: diagnostic,
    }
    expect(canSubmitJob(ready, false)).toBe(true)
    expect(canSubmitJob(ready, true)).toBe(false)
    expect(canSubmitJob({ ...ready, georeference: undefined }, false)).toBe(false)
    expect(canSubmitJob({ ...ready, reviewConfig: { ...config(), crsEvidence: '' } }, false)).toBe(
      false
    )
    expect(
      canSubmitJob(
        { ...ready, reviewConfig: { ...config(), controlPoints: pairedPoints.slice(0, 3) } },
        false
      )
    ).toBe(false)
    expect(canSubmitJob({ ...ready, state: 'needs_review' }, false)).toBe(false)
  })
})

describe('point review and authoritative map overlay', () => {
  it('requires independent check and noncollinear fit points while handling large CAD offsets', () => {
    expect(inspectControlPoints(pairedPoints).error).toBe('')
    expect(inspectControlPoints(pairedPoints.slice(0, 3)).error).toMatch(/kiểm tra độc lập/)
    expect(
      inspectControlPoints([...pairedPoints.slice(0, 3), { ...pairedPoints[0]!, checkOnly: true }])
        .error
    ).toMatch(/điểm trùng/)
    const collinear = pairedPoints.map((point, index) => ({
      ...point,
      source: [1000000 + index, 2000000 + index] as [number, number],
    }))
    expect(inspectControlPoints(collinear).error).toMatch(/thẳng hàng/)
    expect(
      inspectControlPoints([{ source: [1, 2], target: null, checkOnly: false }]).incomplete
    ).toBe(1)
  })
  it('uses actual row IDs for sparse pair markers and never displays CAD coordinates as WGS84', () => {
    expect(
      controlPointFeatures(
        [{ source: [0, 0], target: null, checkOnly: false }, pairedPoints[3]!],
        1
      ).features[0]
    ).toMatchObject({ id: 'cp-2', properties: { index: 2, checkOnly: true, active: true } })
    const feature: CadFeature = {
      id: 'pipe',
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [105.8, 21],
          [105.801, 21.001],
        ],
      },
      properties: {},
    }
    expect(authoritativeOverlay([feature], 'cad', true).features).toEqual([])
    expect(authoritativeOverlay([feature], 'EPSG:4326', false).features).toEqual([])
    expect(authoritativeOverlay([feature], 'EPSG:4326', true).features).toHaveLength(1)
    expect(
      authoritativeOverlay(
        [{ ...feature, geometry: { type: 'Point', coordinates: [1000000, 2000000] } }],
        'EPSG:4326',
        true
      ).features
    ).toHaveLength(0)
  })
})
