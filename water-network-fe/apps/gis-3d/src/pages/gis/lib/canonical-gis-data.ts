import type { CanonicalNetworkData, GisBootstrap, GisHomeView } from '@/entities/gis'
import type {
  Asset,
  GisData,
  GisGeoMetadata,
  Hydrant,
  Node,
  Pipe,
  Pump,
  SourceDevice,
  Valve,
} from './gis-data'
import type { Feature, Point, LineString } from 'geojson'

const UNITS_TO_METERS = 1.15
const METERS_PER_DEGREE_LAT = 111_132
const INSET = 420

const STATUS_COLORS: Record<string, string> = {
  active: '#1A7F37',
  commissioned: '#1A7F37',
  planned: '#0969DA',
  leak: '#D1242F',
  suspended: '#9A6700',
  abandoned: '#8B949E',
  decommissioned: '#8B949E',
}

function props(feature: Feature): Record<string, unknown> {
  return (feature.properties ?? {}) as Record<string, unknown>
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function idOf(feature: Feature): string {
  return feature.id == null ? text(props(feature).assetCode) : String(feature.id)
}

function codeOf(feature: Feature): string {
  return text(props(feature).assetCode, text(props(feature).code, idOf(feature)))
}

function normalizeToken(value: unknown): string {
  return text(value)
    .replaceAll(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function materialLabel(value: unknown): string {
  const material = text(value)
  return !material || normalizeToken(material) === 'unknown' ? 'Chưa xác định' : material
}

function pipeStatus(value: unknown): string {
  const status = normalizeToken(value)
  if (status.includes('planned')) return 'planned'
  if (status.includes('leak')) return 'leak'
  if (status.includes('abandon') || status.includes('decommission')) return 'abandoned'
  return 'ok'
}

function statusLabel(value: string): string {
  const normalized = normalizeToken(value)
  if (normalized === 'active') return 'Đang vận hành'
  if (normalized === 'commissioned') return 'Đã nghiệm thu'
  if (normalized === 'planned') return 'Quy hoạch'
  if (normalized === 'leak') return 'Rò rỉ'
  if (normalized === 'suspended') return 'Tạm dừng'
  if (normalized === 'abandoned' || normalized === 'decommissioned') return 'Ngừng sử dụng'
  return value || 'Chưa xác định'
}

interface CanonicalAssetMetadata {
  status: string
  lifecycleStatus: string
  physicalState: string
}

function assetMetadata(feature: Feature): CanonicalAssetMetadata {
  const properties = props(feature)
  return {
    status: text(properties.status),
    lifecycleStatus: text(properties.lifecycleStatus),
    // `status` and `lifecycleStatus` describe the asset record, not a valve's
    // physical position. Only consume an explicitly dedicated field here.
    physicalState: text(properties.physicalState, text(properties.valveState)),
  }
}

function canonicalStatusAttrs(
  metadata: CanonicalAssetMetadata | undefined
): Record<string, string> {
  return {
    'Trạng thái tài sản': metadata?.status ? statusLabel(metadata.status) : 'Chưa có dữ liệu',
    'Trạng thái vòng đời': metadata?.lifecycleStatus
      ? statusLabel(metadata.lifecycleStatus)
      : 'Chưa có dữ liệu',
  }
}

function lifecycleConditionKey(metadata: CanonicalAssetMetadata | undefined): string {
  return normalizeToken(metadata?.lifecycleStatus) || 'unknown'
}

function lifecycleConditionDefinitions(
  metadataById: Record<string, CanonicalAssetMetadata>
): Record<string, { label: string; col: string }> {
  return Object.fromEntries(
    Object.values(metadataById).flatMap(metadata => {
      const key = lifecycleConditionKey(metadata)
      if (key === 'unknown') return []
      return [
        [
          key,
          {
            label: statusLabel(metadata.lifecycleStatus),
            col: STATUS_COLORS[key] ?? '#7E8997',
          },
        ],
      ]
    })
  )
}

function valvePhysicalState(value: unknown): string {
  const state = normalizeToken(value)
  if (state === 'open' || state === 'opened') return 'open'
  if (state === 'closed') return 'closed'
  return 'unknown'
}

function valvePhysicalStateLabel(value: string): string {
  if (value === 'open') return 'Mở'
  if (value === 'closed') return 'Đóng'
  return 'Chưa có dữ liệu'
}

interface GeoTransform {
  world: { w: number; h: number }
  geo: GisGeoMetadata
  point: (coordinate: readonly number[]) => [number, number]
}

function createGeoTransform(homeView: GisHomeView): GeoTransform {
  const [minLon, minLat, maxLon, maxLat] = homeView.bbox
  const centerLat = (minLat + maxLat) / 2
  const metersPerDegreeLon = 111_320 * Math.cos((centerLat * Math.PI) / 180)
  const spanX = Math.max(0, ((maxLon - minLon) * metersPerDegreeLon) / UNITS_TO_METERS)
  const spanY = Math.max(0, ((maxLat - minLat) * METERS_PER_DEGREE_LAT) / UNITS_TO_METERS)
  const world = {
    w: Math.max(2 * INSET, spanX + 2 * INSET),
    h: Math.max(2 * INSET, spanY + 2 * INSET),
  }
  const geo: GisGeoMetadata = {
    bbox: [minLon, minLat, maxLon, maxLat],
    center: [homeView.center.lon, homeView.center.lat],
    source: homeView.source,
    inset: INSET,
    unitsToMeters: UNITS_TO_METERS,
    metersPerDegreeLon,
    metersPerDegreeLat: METERS_PER_DEGREE_LAT,
  }
  return {
    world,
    geo,
    point: coordinate => [
      INSET + ((numberValue(coordinate[0]) - minLon) * metersPerDegreeLon) / UNITS_TO_METERS,
      INSET + ((maxLat - numberValue(coordinate[1])) * METERS_PER_DEGREE_LAT) / UNITS_TO_METERS,
    ],
  }
}

function pointGeometry(feature: Feature): Point | null {
  return feature.geometry?.type === 'Point' ? feature.geometry : null
}

function lineGeometry(feature: Feature): LineString | null {
  return feature.geometry?.type === 'LineString' ? feature.geometry : null
}

function emptyDashboard(bootstrap: GisBootstrap, valves: Valve[], hydrants: Hydrant[]) {
  return {
    pipeKm: bootstrap.pipeLengthM / 1000,
    pipeCount: bootstrap.counts.pipes,
    valveCount: valves.length,
    hydrantCount: hydrants.length,
    connCount: 0,
    dmaCount: 0,
    topoOpen: 0,
    csPending: 0,
    importPending: 0,
    fieldPending: 0,
    geocodedPct: 0,
    rtkPct: 0,
    condMix: bootstrap.statusMix.map(item => ({
      k: item.status,
      label: statusLabel(item.status),
      col: STATUS_COLORS[normalizeToken(item.status)] ?? '#7E8997',
      n: item.count,
    })),
    matMix: bootstrap.materialMix.map(item => ({
      label: materialLabel(item.material),
      n: Math.round(item.lengthM || item.count),
    })),
  }
}

function emptyData(bootstrap: GisBootstrap): GisData {
  const world = { w: 1200, h: 800 }
  return makeData(bootstrap, undefined, world, [], [], [], [], [], [], {})
}

function makeData(
  bootstrap: GisBootstrap,
  network: CanonicalNetworkData | undefined,
  world: { w: number; h: number },
  nodes: Node[],
  pipes: Pipe[],
  valves: Valve[],
  hydrants: Hydrant[],
  pumps: Pump[],
  sourceDevices: SourceDevice[],
  metadataById: Record<string, CanonicalAssetMetadata>,
  geo?: GisGeoMetadata
): GisData {
  const pipeBy = Object.fromEntries(pipes.map(pipe => [pipe.id, pipe]))
  const lifecycleConditions = lifecycleConditionDefinitions(metadataById)
  const materialNames = Array.from(
    new Set(
      bootstrap.materialMix
        .map(item => materialLabel(item.material))
        .concat(pipes.map(pipe => pipe.material))
    )
  )

  const assets: Asset[] = [
    ...nodes.map(node => {
      const metadata = metadataById[node.id]
      return {
        id: node.id,
        code: node.code,
        type: 'node',
        geom: 'point' as const,
        name: node.code,
        dma: '',
        cond: lifecycleConditionKey(metadata),
        status: pipeStatus(metadata?.status),
        attrs: {
          'Loại nút': node.kind || 'Chưa xác định',
          ...canonicalStatusAttrs(metadata),
        },
        geomRef: node,
      }
    }),
    ...pipes.map(pipe => ({
      id: pipe.id,
      code: pipe.code,
      type: 'pipe',
      geom: 'line' as const,
      name: pipe.code,
      dma: '',
      cond: lifecycleConditionKey(metadataById[pipe.id]),
      status: pipe.status,
      attrs: {
        'Đường kính': pipe.dn > 0 ? `DN ${pipe.dn}` : 'Chưa xác định',
        'Vật liệu': pipe.material,
        'Chiều dài': `${pipe.lenM.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} m`,
        'Nút đầu': pipe.from || 'Chưa xác định',
        'Nút cuối': pipe.to || 'Chưa xác định',
        ...canonicalStatusAttrs(metadataById[pipe.id]),
      },
      geomRef: pipe,
    })),
    ...valves.map(valve => {
      const metadata = metadataById[valve.id]
      return {
        id: valve.id,
        code: valve.code,
        type: 'valve',
        geom: 'point' as const,
        name: valve.code,
        dma: '',
        cond: lifecycleConditionKey(metadata),
        status: pipeStatus(metadata?.status),
        attrs: {
          'Loại thiết bị': valve.kind,
          'Ống chủ': valve.pipe || 'Chưa xác định',
          'Trạng thái đóng/mở': valvePhysicalStateLabel(valve.state),
          ...canonicalStatusAttrs(metadata),
        },
        geomRef: valve,
      }
    }),
    ...hydrants.map(hydrant => {
      const metadata = metadataById[hydrant.id]
      return {
        id: hydrant.id,
        code: hydrant.code,
        type: 'hydrant',
        geom: 'point' as const,
        name: hydrant.code,
        dma: '',
        cond: lifecycleConditionKey(metadata),
        status: pipeStatus(metadata?.status),
        attrs: {
          'Loại thiết bị': 'Trụ cứu hoả',
          ...canonicalStatusAttrs(metadata),
        },
        geomRef: hydrant,
      }
    }),
    ...pumps.map(pump => {
      const metadata = metadataById[pump.id]
      return {
        id: pump.id,
        code: pump.name,
        type: 'pump',
        geom: 'point' as const,
        name: pump.name,
        dma: '',
        cond: lifecycleConditionKey(metadata),
        status: pipeStatus(metadata?.status),
        attrs: { 'Loại thiết bị': 'Bơm', ...canonicalStatusAttrs(metadata) },
        geomRef: pump,
      }
    }),
    ...sourceDevices.map(device => {
      const metadata = metadataById[device.id]
      return {
        id: device.id,
        code: device.code,
        type: 'device',
        geom: 'point' as const,
        name: device.name,
        dma: '',
        cond: lifecycleConditionKey(metadata),
        status: pipeStatus(metadata?.status),
        attrs: {
          'Loại thiết bị': device.deviceType || 'Khác',
          'Ống chủ': device.hostPipeId || 'Không có',
          'Nút chủ': device.hostNodeId || 'Không có',
          ...canonicalStatusAttrs(metadata),
        },
        geomRef: device,
      }
    }),
  ]

  return {
    TODAY: new Intl.DateTimeFormat('vi-VN').format(new Date()),
    SRID: 'EPSG:4326 (WGS84)',
    world,
    nodes,
    pipes,
    pipeBy,
    valves,
    hydrants,
    plant: { id: '', name: '', flow: 0, x: world.w / 2, y: world.h / 2 },
    reservoirs: [],
    pumps,
    sourceDevices,
    dmas: [],
    blocks: [],
    parks: [],
    river: '',
    lake: [],
    connDots: [],
    connections: [],
    LAYERS: [
      { id: 'basemap', label: 'Nền bản đồ', grp: 'Nền', on: true, lock: true },
      { id: 'pipe', label: 'Tuyến ống', grp: 'Tài sản', on: true, count: pipes.length },
      { id: 'node', label: 'Nút / Phụ kiện', grp: 'Tài sản', on: true, count: nodes.length },
      { id: 'valve', label: 'Van', grp: 'Tài sản', on: true, count: valves.length },
      { id: 'hydrant', label: 'Trụ cứu hoả', grp: 'Tài sản', on: true, count: hydrants.length },
      {
        id: 'source',
        label: 'Thiết bị khác',
        grp: 'Tài sản',
        on: true,
        count: pumps.length + sourceDevices.length,
      },
    ],
    assets,
    ASSET_TYPES: {
      pipe: { label: 'Tuyến ống', geom: 'line', icon: 'IcPipe', col: '#0E7C86' },
      valve: { label: 'Van', geom: 'point', icon: 'IcValve', col: '#0969DA' },
      hydrant: { label: 'Trụ cứu hoả', geom: 'point', icon: 'IcHydrant', col: '#D1242F' },
      node: { label: 'Nút / Phụ kiện', geom: 'point', icon: 'IcNode', col: '#8250DF' },
      pump: { label: 'Trạm bơm', geom: 'point', icon: 'IcPump', col: '#D86C1F' },
      device: { label: 'Thiết bị', geom: 'point', icon: 'IcActivity', col: '#D86C1F' },
      reservoir: { label: 'Bể / Đài nước', geom: 'point', icon: 'IcTank', col: '#1A7F37' },
      dma: { label: 'Vùng DMA', geom: 'polygon', icon: 'IcPolygon', col: '#9A6700' },
    },
    COND: {
      good: { label: 'Tốt', col: '#1A7F37' },
      fair: { label: 'Khá', col: '#9A6700' },
      poor: { label: 'Kém', col: '#D86C1F' },
      critical: { label: 'Nguy cấp', col: '#D1242F' },
      unknown: { label: 'Chưa có dữ liệu', col: '#7E8997' },
      ...lifecycleConditions,
    },
    PSTATUS: {
      ok: { label: 'Vận hành', col: '#1A7F37' },
      leak: { label: 'Rò rỉ', col: '#D1242F' },
      planned: { label: 'Quy hoạch', col: '#0969DA' },
      abandoned: { label: 'Đã huỷ', col: '#8B949E' },
      unknown: { label: 'Chưa có dữ liệu', col: '#7E8997' },
    },
    MATERIALS: materialNames,
    CTYPE: {},
    TOPO_KINDS: {},
    topoIssues: [],
    isolation: {
      target: '',
      targetMid: [world.w / 2, world.h / 2],
      valves: [],
      affectedPipes: [],
      affectedConns: 0,
      estPop: 0,
    },
    importJobs: [],
    importErrors: [],
    changeSets: [],
    fieldObs: [],
    offlinePkgs: [],
    ROLES: [],
    DATAFLOW: {
      inputs: [
        { src: 'GIS BE', label: 'Tài sản không gian canonical' },
        { src: 'IAM', label: 'Tenant và phân quyền từ JWT' },
      ],
      // These names mirror WaterNetwork.Gis.Contracts.Events.GisEventTypes.
      outputs: [
        'network.node.registered',
        'network.pipe.registered',
        'network.device.installed',
        'network.node.deleted',
        'network.pipe.deleted',
        'network.device.deleted',
        'network.node.relocated',
        'network.gis-import.completed',
      ],
    },
    DASH: emptyDashboard(bootstrap, valves, hydrants),
    SERVICES: {},
    LINK_STATE: {},
    canonical: true,
    geo,
    network: network
      ? {
          featureCount: network.featureCount,
          limit: network.limit,
          truncated: network.truncated,
          initialExtentPartial: network.initialExtentPartial,
        }
      : { featureCount: 0, limit: 0, truncated: false },
    assetLinks: () => [],
  }
}

export function createCanonicalGisData(
  bootstrap: GisBootstrap,
  network?: CanonicalNetworkData
): GisData {
  if (!bootstrap.hasData || !bootstrap.homeView || !network) return emptyData(bootstrap)

  const transform = createGeoTransform(bootstrap.homeView)
  const nodeFeatures = network.layers.node?.features ?? []
  const pipeFeatures = network.layers.pipe?.features ?? []
  const valveFeatures = network.layers.valve?.features ?? []
  const hydrantFeatures = network.layers.hydrant?.features ?? []
  const sourceFeatures = network.layers.source?.features ?? []
  const metadataById = Object.fromEntries(
    [nodeFeatures, pipeFeatures, valveFeatures, hydrantFeatures, sourceFeatures]
      .flat()
      .map(feature => [idOf(feature), assetMetadata(feature)])
  )

  const nodes: Node[] = nodeFeatures.flatMap((feature, index) => {
    const geometry = pointGeometry(feature)
    if (!geometry) return []
    const [x, y] = transform.point(geometry.coordinates)
    return [
      {
        id: idOf(feature),
        code: codeOf(feature),
        x,
        y,
        i: index,
        j: index,
        z: 0,
        kind: text(props(feature).nodeType, 'Chưa xác định'),
      },
    ]
  })

  const pipes: Pipe[] = pipeFeatures.flatMap(feature => {
    const geometry = lineGeometry(feature)
    if (!geometry || geometry.coordinates.length < 2) return []
    const id = idOf(feature)
    const properties = props(feature)
    const vertices = geometry.coordinates.map(transform.point)
    return [
      {
        id,
        code: codeOf(feature),
        from: text(properties.fromNodeId),
        to: text(properties.toNodeId),
        dn: numberValue(properties.diameterMm),
        trunk: false,
        material: materialLabel(properties.material),
        year: 0,
        cond: lifecycleConditionKey(metadataById[id]),
        status: pipeStatus(properties.status),
        lenM: numberValue(properties.lengthM),
        pts: [vertices[0]!, vertices[vertices.length - 1]!],
        vertices,
        dma: '',
      },
    ]
  })

  const toDevicePoint = (feature: Feature) => {
    const geometry = pointGeometry(feature)
    return geometry ? transform.point(geometry.coordinates) : null
  }

  const valves: Valve[] = valveFeatures.flatMap(feature => {
    const coordinate = toDevicePoint(feature)
    if (!coordinate) return []
    const properties = props(feature)
    return [
      {
        id: idOf(feature),
        code: codeOf(feature),
        x: coordinate[0],
        y: coordinate[1],
        pipe: text(properties.hostPipeId),
        dn: numberValue(properties.diameterMm),
        kind: text(properties.deviceType, 'Valve'),
        state: valvePhysicalState(assetMetadata(feature).physicalState),
        dma: '',
        year: 0,
      },
    ]
  })

  const hydrants: Hydrant[] = hydrantFeatures.flatMap(feature => {
    const coordinate = toDevicePoint(feature)
    if (!coordinate) return []
    return [
      {
        id: idOf(feature),
        code: codeOf(feature),
        x: coordinate[0],
        y: coordinate[1],
        dma: '',
        status: pipeStatus(props(feature).status),
      },
    ]
  })

  const pumps: Pump[] = []
  const sourceDevices: SourceDevice[] = []
  for (const feature of sourceFeatures) {
    const coordinate = toDevicePoint(feature)
    if (!coordinate) continue
    const properties = props(feature)
    const type = text(properties.deviceType, 'Khác')
    if (normalizeToken(type) === 'pump') {
      pumps.push({
        id: idOf(feature),
        name: codeOf(feature),
        x: coordinate[0],
        y: coordinate[1],
        pumps: 0,
        run: 0,
        dma: '',
      })
    } else {
      sourceDevices.push({
        id: idOf(feature),
        code: codeOf(feature),
        name: codeOf(feature),
        x: coordinate[0],
        y: coordinate[1],
        deviceType: type,
        status: text(properties.status, 'Chưa xác định'),
        hostPipeId: text(properties.hostPipeId) || undefined,
        hostNodeId: text(properties.hostNodeId) || undefined,
      })
    }
  }

  return makeData(
    bootstrap,
    network,
    transform.world,
    nodes,
    pipes,
    valves,
    hydrants,
    pumps,
    sourceDevices,
    metadataById,
    transform.geo
  )
}
