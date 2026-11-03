import type { FeatureCollection } from 'geojson'
import type { CadFeature, ControlPoint } from './types'

export type CoordinatePair = [number, number]
export const controlPointId = (index: number) => `cp-${index + 1}`
export const isFinitePair = (value: unknown): value is CoordinatePair =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
export const isGeographicPair = (value: unknown): value is CoordinatePair =>
  isFinitePair(value) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) < 90

/** Advisory only: the worker performs the authoritative ellipsoidal metric fit. */
export function inspectControlPoints(points: ControlPoint[]) {
  const complete = points.filter(
    point => isFinitePair(point.source) && isGeographicPair(point.target)
  )
  const fit = complete.filter(point => !point.checkOnly)
  const checks = complete.filter(point => point.checkOnly)
  const incomplete = points.length - complete.length
  let error = ''
  if (incomplete) error = `Còn ${incomplete} cặp chưa đủ tọa độ CAD và GIS hợp lệ.`
  else if (fit.length < 3 || checks.length < 1)
    error = 'Cần ít nhất 3 điểm ghép và 1 điểm kiểm tra độc lập.'
  else {
    const same = (a: CoordinatePair, b: CoordinatePair) => a[0] === b[0] && a[1] === b[1]
    if (
      complete.some((point, index) =>
        complete
          .slice(0, index)
          .some(
            previous =>
              same(point.source!, previous.source!) || same(point.target!, previous.target!)
          )
      )
    )
      error = 'Điểm kiểm tra và điểm ghép phải ở các vị trí khác nhau; thay điểm trùng.'
    else {
      // Center and normalize before area comparison to handle large CAD offsets.
      const origin = fit[0]!.source!
      const offsets = fit.map(point => [point.source![0] - origin[0], point.source![1] - origin[1]])
      const scale = Math.max(...offsets.flat().map(Math.abs))
      const noncollinear =
        scale > 0 &&
        offsets.some(a =>
          offsets.some(
            b =>
              Math.abs((a[0]! / scale) * (b[1]! / scale) - (a[1]! / scale) * (b[0]! / scale)) > 1e-8
          )
        )
      if (!noncollinear) error = 'Các điểm ghép CAD đang thẳng hàng; chọn điểm phân bố rộng hơn.'
    }
  }
  return { fitCount: fit.length, checkCount: checks.length, incomplete, error }
}

export function controlPointFeatures(
  points: ControlPoint[],
  active: number | null
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.flatMap((point, index) =>
      isGeographicPair(point.target)
        ? [
            {
              type: 'Feature' as const,
              id: controlPointId(index),
              geometry: { type: 'Point' as const, coordinates: point.target },
              properties: {
                index: index + 1,
                checkOnly: point.checkOnly,
                active: active === index,
              },
            },
          ]
        : []
    ),
  }
}

export function geographicExtent(
  points: CoordinatePair[]
): [number, number, number, number] | null {
  const valid = points.filter(isGeographicPair)
  if (!valid.length) return null
  return [
    Math.min(...valid.map(p => p[0])),
    Math.min(...valid.map(p => p[1])),
    Math.max(...valid.map(p => p[0])),
    Math.max(...valid.map(p => p[1])),
  ]
}

/** No CAD transform is performed in the browser. Only server-projected features enter the map. */
export function authoritativeOverlay(
  features: CadFeature[],
  coordinateSpace: string,
  confirmed: boolean
): FeatureCollection {
  if (!confirmed || coordinateSpace !== 'EPSG:4326')
    return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: features.filter(feature => {
      if (feature.properties.isXref) return false
      const pairs =
        feature.geometry.type === 'Point'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates
      return pairs.length > 0 && pairs.every(isGeographicPair)
    }) as FeatureCollection['features'],
  }
}
