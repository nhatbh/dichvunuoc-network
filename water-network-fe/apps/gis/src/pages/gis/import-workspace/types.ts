import { z } from 'zod'

const optionalString = z
  .string()
  .nullish()
  .transform(value => value ?? undefined)
const optionalNumber = z
  .number()
  .nullish()
  .transform(value => value ?? undefined)

export const layerActionSchema = z.enum(['pipe', 'reference', 'exclude', 'review'])
const issueSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    featureId: optionalString,
  })
  .passthrough()
const layerRuleSchema = z.object({
  fileId: z.string(),
  layer: z.string(),
  action: layerActionSchema,
  diameterMm: optionalNumber,
  material: optionalString,
})
const blockRuleSchema = z.object({
  fileId: z.string(),
  blockName: z.string(),
  action: z.enum(['node', 'device', 'reference', 'exclude', 'review']),
  nodeType: z
    .enum(['Junction', 'Reservoir', 'Tank', 'Hydrant', 'Other'])
    .nullish()
    .transform(value => value ?? undefined),
  deviceType: z
    .enum(['Valve', 'FlowMeter', 'PressureSensor', 'Pump', 'Hydrant'])
    .nullish()
    .transform(value => value ?? undefined),
})
const controlCoordinateSchema = z.tuple([z.number().finite(), z.number().finite()]).nullable()
export const controlPointSchema = z.object({
  source: controlCoordinateSchema,
  target: controlCoordinateSchema,
  checkOnly: z.boolean().default(false),
})
export const georeferenceSchema = z
  .object({
    status: z.enum(['incomplete', 'invalid', 'valid']),
    targetCrs: z.string().nullable(),
    fitPointCount: z.number(),
    checkPointCount: z.number(),
    thresholdM: z.number(),
    maxErrorM: z.number().nullable(),
    rmseM: z.number().nullable(),
    residuals: z.array(z.object({ index: z.number(), checkOnly: z.boolean(), errorM: z.number() })),
    workingCrs: z.string().nullable(),
    error: z.string().nullable(),
  })
  .passthrough()
export const lineEditSchema = layerRuleSchema.extend({
  id: z.string().min(1).max(100),
  sourceFeatureId: z.string().nullable().optional(),
  action: z.literal('pipe').default('pipe'),
  coordinates: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .min(2)
    .max(10000),
})
export type LineEdit = z.infer<typeof lineEditSchema>
export const reviewSchema = z.object({
  excludedFileIds: z.array(z.string()).max(10).optional(),
  lineEdits: z.array(lineEditSchema).max(5000).optional(),
  connectEndpointFeatureIds: z.array(z.string()).optional(),
  sourceCrs: z.string().nullable(),
  sourceAxisOrder: z.enum(['xy', 'yx']).default('xy'),
  sourceUnits: z.enum(['m', 'mm']).default('m'),
  sourceCrsPresetId: z.string().max(120).nullish(),
  crsEvidence: z.string(),
  lifecycleEvidence: optionalString,
  controlPoints: z.array(controlPointSchema).max(100).optional(),
  controlPointTargetCrs: z.literal('EPSG:4326').nullable().optional(),
  controlPointMaxErrorM: z.number().finite().positive().max(10).optional(),
  fileCrs: z.array(z.object({ fileId: z.string(), sourceCrs: z.string() })).optional(),
  layerRules: z.array(layerRuleSchema),
  excludeFeatureIds: z.array(z.string()),
  acceptWarningCodes: z.array(z.string()),
  snapToleranceM: z.number(),
  simplifyToleranceM: z.number(),
  minLengthM: z.number(),
  blockRules: z.array(blockRuleSchema).optional(),
  deviceHosts: z.array(z.object({ featureId: z.string(), hostFeatureId: z.string() })).optional(),
  hostToleranceM: optionalNumber,
})
export const jobSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.number(),
    state: z.enum([
      'queued',
      'analyzing',
      'needs_review',
      'ready',
      'submitting',
      'submitted',
      'failed',
    ]),
    files: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sha256: z.string(),
        format: z.string(),
        bytes: z.number(),
      })
    ),
    inventory: z
      .object({
        layers: z.array(
          z
            .object({
              fileId: z.string(),
              name: z.string(),
              count: z.number(),
              lineCount: z.number(),
              textCount: z.number(),
              suggestedAction: layerActionSchema,
              suggestedDiameterMm: optionalNumber,
              suggestedMaterial: optionalString,
            })
            .passthrough()
        ),
        files: z.array(
          z
            .object({
              id: z.string(),
              units: z.number(),
              bounds: z.array(z.number()).nullable(),
              entityCount: z.number(),
            })
            .passthrough()
        ),
        issues: z.array(issueSchema),
        blocks: z
          .array(
            z
              .object({
                fileId: z.string(),
                name: z.string(),
                count: z.number(),
                isXref: z.boolean(),
                sampleFeatureIds: z.array(z.string()),
                suggestedAction: z.enum(['review', 'reference']),
              })
              .passthrough()
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    reviewConfig: reviewSchema.optional(),
    georeference: georeferenceSchema.nullish(),
    summary: z
      .object({
        rawFeatures: z.number(),
        keptPipes: z.number(),
        excluded: z.number(),
        duplicates: z.number(),
        nodes: z.number(),
        devices: z.number(),
        totalLengthM: z.number(),
        errors: z.number(),
        warnings: z.number(),
      })
      .passthrough()
      .optional(),
    issues: z.array(issueSchema).optional(),
    error: optionalString,
    submission: z
      .object({
        projectId: optionalString,
        revisionId: optionalString,
        status: optionalString,
        message: optionalString,
      })
      .passthrough()
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough()

export const capabilitiesSchema = z.object({
  formats: z.array(z.string()),
  dwgAvailable: z.boolean(),
  maxFileBytes: z.number(),
  maxFiles: z.number(),
})
const coordinate = z.array(z.number().finite()).min(2)
export const featureSchema = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: z.discriminatedUnion('type', [
    z.object({ type: z.literal('Point'), coordinates: coordinate }),
    z.object({ type: z.literal('LineString'), coordinates: z.array(coordinate) }),
  ]),
  properties: z
    .object({
      fileId: optionalString,
      layer: optionalString,
      entityType: optionalString,
      kind: optionalString,
      diameterMm: optionalNumber,
      material: optionalString,
      disposition: optionalString,
      reason: optionalString,
      text: optionalString,
      blockName: optionalString,
      parentId: z.string().nullable().optional(),
      isBlockGeometry: z.boolean().optional(),
    })
    .passthrough(),
})
export const featuresSchema = z.object({
  drawing: z
    .object({
      features: z.array(featureSchema),
      coordinateSpace: z.enum(['cad', 'EPSG:4326']),
      total: z.number(),
      hasMore: z.boolean(),
      bbox: z.array(z.number()).nullable().optional(),
      error: z.string().optional(),
    })
    .optional(),
  type: z.literal('FeatureCollection'),
  features: z.array(featureSchema),
  total: z.number(),
  hasMore: z.boolean(),
  offset: z.number(),
  coordinateSpace: z.enum(['cad', 'EPSG:4326']),
  version: z.number(),
  bbox: z.array(z.number()).nullable().optional(),
})
export type ImportJob = z.infer<typeof jobSchema>
export type ImportIssue = z.infer<typeof issueSchema>
export type ReviewConfig = z.infer<typeof reviewSchema>
export type ControlPoint = z.infer<typeof controlPointSchema>
export type GeoreferenceResult = z.infer<typeof georeferenceSchema>
export type LayerRule = z.infer<typeof layerRuleSchema>
export type BlockRule = z.infer<typeof blockRuleSchema>
export type CadFeature = z.infer<typeof featureSchema>
export type FeaturePage = z.infer<typeof featuresSchema>
export type ImportCapabilities = z.infer<typeof capabilitiesSchema>

export function reviewForJob(job: ImportJob): ReviewConfig {
  if (job.reviewConfig) {
    const config = structuredClone(job.reviewConfig)
    for (const layer of job.inventory?.layers ?? []) {
      if (!config.layerRules.some(r => r.fileId === layer.fileId && r.layer === layer.name))
        config.layerRules.push({
          fileId: layer.fileId,
          layer: layer.name,
          action: layer.suggestedAction,
          diameterMm: layer.suggestedDiameterMm,
          material: layer.suggestedMaterial,
        })
    }
    for (const block of job.inventory?.blocks ?? []) {
      if (
        !(config.blockRules ?? []).some(
          r => r.fileId === block.fileId && r.blockName === block.name
        )
      )
        (config.blockRules ??= []).push({
          fileId: block.fileId,
          blockName: block.name,
          action: block.suggestedAction,
        })
    }
    return config
  }
  return {
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
    blockRules:
      job.inventory?.blocks?.map(block => ({
        fileId: block.fileId,
        blockName: block.name,
        action: block.suggestedAction,
      })) ?? [],
    layerRules:
      job.inventory?.layers.map(layer => ({
        fileId: layer.fileId,
        layer: layer.name,
        action: layer.suggestedAction,
        ...(layer.suggestedDiameterMm ? { diameterMm: layer.suggestedDiameterMm } : {}),
        ...(layer.suggestedMaterial ? { material: layer.suggestedMaterial } : {}),
      })) ?? [],
  }
}

export const stateLabels: Record<ImportJob['state'], string> = {
  queued: 'Đang chờ',
  analyzing: 'Đang phân tích',
  needs_review: 'Bản nháp · cần rà soát',
  ready: 'Ready · sẵn sàng gửi duyệt',
  submitting: 'Đang xử lý bản nháp',
  submitted: 'Đã gửi quy trình duyệt',
  failed: 'Xử lý thất bại',
}
export const actionLabels: Record<LayerRule['action'], string> = {
  pipe: 'Tuyến ống',
  reference: 'Tham chiếu',
  exclude: 'Loại khỏi mạng',
  review: 'Cần phân loại',
}
export const isProcessing = (job: ImportJob | null) =>
  !!job && ['queued', 'analyzing', 'submitting'].includes(job.state)
export const canSubmitJob = (job: ImportJob | null, dirty: boolean) =>
  job?.state === 'ready' &&
  !dirty &&
  !!job.reviewConfig?.crsEvidence.trim() &&
  (job.reviewConfig.controlPointTargetCrs === 'EPSG:4326'
    ? !!job.reviewConfig.controlPoints?.length &&
      job.reviewConfig.controlPoints.every(point => point.source && point.target) &&
      job.reviewConfig.controlPoints.filter(point => !point.checkOnly).length >= 3 &&
      job.reviewConfig.controlPoints.some(point => point.checkOnly) &&
      job.georeference?.status === 'valid'
    : !!job.reviewConfig.sourceCrs?.trim())

export const acceptedMaterials = [
  'HDPE',
  'PVC',
  'DuctileIron',
  'Steel',
  'CastIron',
  'Concrete',
] as const

export function validateReview(config: ReviewConfig): string | null {
  if (
    ((config.controlPoints?.length ?? 0) > 0 || config.controlPointTargetCrs) &&
    ((config.sourceAxisOrder ?? 'xy') !== 'xy' || (config.sourceUnits ?? 'm') !== 'm')
  )
    return 'Ghép điểm CAD–GIS dùng tọa độ CAD gốc; đặt lại thứ tự trục XY và đơn vị mét trước khi chuyển chế độ.'
  if (
    config.controlPointTargetCrs === 'EPSG:4326' &&
    (config.sourceCrs?.trim() || config.fileCrs?.length)
  )
    return 'Định vị bằng điểm GIS không kết hợp với hệ tọa độ nguồn đã khai báo.'
  if (
    config.controlPointMaxErrorM !== undefined &&
    (!Number.isFinite(config.controlPointMaxErrorM) ||
      config.controlPointMaxErrorM <= 0 ||
      config.controlPointMaxErrorM > 10)
  )
    return 'Sai số điểm khống chế phải lớn hơn 0 và không vượt 10 mét.'
  if ((config.controlPoints?.length ?? 0) > 100) return 'Mỗi hồ sơ hỗ trợ tối đa 100 cặp điểm.'
  if (
    config.controlPoints?.some(point =>
      [point.source, point.target].some(pair => pair && !pair.every(Number.isFinite))
    )
  )
    return 'Tọa độ điểm phải là số hữu hạn hoặc để trống để tiếp tục ghép.'
  if (
    config.controlPointTargetCrs === 'EPSG:4326' &&
    config.controlPoints?.some(
      point => point.target && (Math.abs(point.target[0]) > 180 || Math.abs(point.target[1]) >= 90)
    )
  )
    return 'Điểm GIS cần kinh độ từ −180 đến 180 và vĩ độ trong khoảng −90 đến 90.'
  for (const [label, value] of [
    ['Ngưỡng nối', config.snapToleranceM],
    ['Ngưỡng giản lược', config.simplifyToleranceM],
    ['Chiều dài tối thiểu', config.minLengthM],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) return `${label} phải là số không âm.`
  }
  if (
    config.layerRules.some(
      rule =>
        rule.diameterMm !== undefined && (!Number.isFinite(rule.diameterMm) || rule.diameterMm <= 0)
    )
  )
    return 'Đường kính phải lớn hơn 0 mm hoặc để trống để rà soát.'
  if (
    config.layerRules.some(
      rule =>
        rule.material?.trim() &&
        !acceptedMaterials.some(
          material => material.toLowerCase() === rule.material!.trim().toLowerCase()
        )
    )
  )
    return 'Vật liệu chưa được hỗ trợ. Chọn HDPE, PVC, DuctileIron, Steel, CastIron hoặc Concrete; để trống nếu chưa xác nhận.'
  if (
    config.hostToleranceM !== undefined &&
    (!Number.isFinite(config.hostToleranceM) ||
      config.hostToleranceM <= 0 ||
      config.hostToleranceM > 2)
  )
    return 'Ngưỡng gắn thiết bị phải lớn hơn 0 và không vượt 2 mét.'
  if (
    config.blockRules?.some(
      rule =>
        (rule.action === 'node' && !rule.nodeType) || (rule.action === 'device' && !rule.deviceType)
    )
  )
    return 'Chọn loại nút hoặc thiết bị cho từng ký hiệu đã phân loại.'
  return null
}
