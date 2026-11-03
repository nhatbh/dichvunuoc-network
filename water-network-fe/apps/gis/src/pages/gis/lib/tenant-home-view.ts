import type { GisBbox, GisHomeView } from '@/entities/gis'

const MIN_SPAN_DEGREES = 0.0001
const SAFE_QUERY_AREA_SQUARE_DEGREES = 0.999_999

export interface PreparedTenantHomeView {
  /** Normalized full tenant extent, safe for map fitting and coordinate transforms. */
  homeView: GisHomeView
  /** Initial map API query; always ordered, finite, in range and below the BE area cap. */
  queryBbox: GisBbox
  /** True when queryBbox covers only the home extent around its configured centre. */
  initialExtentPartial: boolean
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function expandDegenerateAxis(
  min: number,
  max: number,
  lowerBound: number,
  upperBound: number
): readonly [number, number] | null {
  if (min < max) return [min, max]

  const halfSpan = MIN_SPAN_DEGREES / 2
  if (min - halfSpan < lowerBound || max + halfSpan > upperBound) return null
  return [min - halfSpan, max + halfSpan]
}

function area(bbox: GisBbox): number {
  return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
}

function centeredQueryBbox(extent: GisBbox, center: GisHomeView['center']): GisBbox | null {
  const width = extent[2] - extent[0]
  const height = extent[3] - extent[1]
  const scale = Math.sqrt(SAFE_QUERY_AREA_SQUARE_DEGREES / (width * height))

  // Preserve the configured tenant centre. Near a world boundary, reduce the
  // affected span rather than shifting the tenant's chosen home point.
  const halfWidth = Math.min((width * scale) / 2, center.lon - -180, 180 - center.lon)
  const halfHeight = Math.min((height * scale) / 2, center.lat - -90, 90 - center.lat)
  if (halfWidth <= 0 || halfHeight <= 0) return null

  return [
    center.lon - halfWidth,
    center.lat - halfHeight,
    center.lon + halfWidth,
    center.lat + halfHeight,
  ]
}

/**
 * Validate and normalize the bootstrap home view before it can drive either a
 * map fit or the BE bbox endpoint. Runtime JSON remains untrusted despite its
 * TypeScript type: malformed/non-finite coordinates return null and are shown
 * as a tenant configuration error instead of silently falling back to Hanoi.
 */
export function prepareTenantHomeView(
  homeView: GisHomeView | null | undefined
): PreparedTenantHomeView | null {
  if (!homeView || !Array.isArray(homeView.bbox) || homeView.bbox.length !== 4) return null
  if (homeView.source !== 'data_extent' && homeView.source !== 'tenant_override') return null

  const [rawLonA, rawLatA, rawLonB, rawLatB] = homeView.bbox
  if (
    !finiteInRange(rawLonA, -180, 180) ||
    !finiteInRange(rawLonB, -180, 180) ||
    !finiteInRange(rawLatA, -90, 90) ||
    !finiteInRange(rawLatB, -90, 90) ||
    !finiteInRange(homeView.center?.lon, -180, 180) ||
    !finiteInRange(homeView.center?.lat, -90, 90)
  ) {
    return null
  }

  const minLon = Math.min(rawLonA, rawLonB)
  const maxLon = Math.max(rawLonA, rawLonB)
  const minLat = Math.min(rawLatA, rawLatB)
  const maxLat = Math.max(rawLatA, rawLatB)

  // A declared home centre outside its own extent is an invalid contract. Do
  // not invent a replacement centre because that could open on another area.
  if (
    homeView.center.lon < minLon ||
    homeView.center.lon > maxLon ||
    homeView.center.lat < minLat ||
    homeView.center.lat > maxLat
  ) {
    return null
  }

  const longitude = expandDegenerateAxis(minLon, maxLon, -180, 180)
  const latitude = expandDegenerateAxis(minLat, maxLat, -90, 90)
  if (!longitude || !latitude) return null

  const extent: GisBbox = [longitude[0], latitude[0], longitude[1], latitude[1]]
  const normalizedHomeView: GisHomeView = {
    bbox: extent,
    center: { lon: homeView.center.lon, lat: homeView.center.lat },
    source: homeView.source,
  }

  if (area(extent) <= SAFE_QUERY_AREA_SQUARE_DEGREES) {
    return {
      homeView: normalizedHomeView,
      queryBbox: extent,
      initialExtentPartial: false,
    }
  }

  const queryBbox = centeredQueryBbox(extent, normalizedHomeView.center)
  if (!queryBbox) return null
  return {
    homeView: normalizedHomeView,
    queryBbox,
    initialExtentPartial: true,
  }
}
