/**
 * Local metric frame of the integrated 3D map. Everything three.js draws on the map is authored in metres
 * around one origin: x = east, y = north, z = up. The conversion uses the same Web Mercator formulas as
 * MapLibre's `MercatorCoordinate`, scaled to metres at the origin's latitude, so the three.js layer lines up
 * with the basemap exactly (the whole demo area is ~6 km, where the scale varies by < 0.01 %).
 */
export type LonLat = readonly [number, number]
export type XY = [number, number]

/** Between the Vĩnh Thịnh network and the Sông Hồng plant. */
export const ORIGIN: LonLat = [105.4945, 21.19]

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6_378_137

export const mercX = (lon: number) => (180 + lon) / 360
export const mercY = (lat: number) =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360

const M0X = mercX(ORIGIN[0])
const M0Y = mercY(ORIGIN[1])
/** Mercator units per metre at the origin (MapLibre's `meterInMercatorCoordinateUnits`). */
export const MERC_PER_M = 1 / (EARTH_CIRCUMFERENCE * Math.cos((ORIGIN[1] * Math.PI) / 180))
export const ORIGIN_MERC = { x: M0X, y: M0Y }

export function toLocal(lon: number, lat: number): XY {
  return [(mercX(lon) - M0X) / MERC_PER_M, -(mercY(lat) - M0Y) / MERC_PER_M]
}

export function toLonLat(x: number, y: number): [number, number] {
  const mx = M0X + x * MERC_PER_M
  const my = M0Y - y * MERC_PER_M
  const lon = mx * 360 - 180
  const y2 = 180 - my * 360
  const lat = (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90
  return [lon, lat]
}

export const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)

export function polylineLength(pts: readonly (readonly number[])[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1]!, pts[i]!)
  return s
}

/** Rotate a plant-frame point (drawing axes) into the map frame around the plant origin. */
export function rotate([x, y]: readonly number[], rad: number): XY {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [x! * c - y! * s, x! * s + y! * c]
}

export function pointInPolygon(p: readonly number[], poly: readonly (readonly number[])[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a[1]! > p[1]! !== b[1]! > p[1]! && p[0]! < ((b[0]! - a[0]!) * (p[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside
  }
  return inside
}
