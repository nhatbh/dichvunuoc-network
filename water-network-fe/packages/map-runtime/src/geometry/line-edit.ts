/** Public line points use EPSG:4326; map points and movement vectors use EPSG:3857. */
export type LinePoint = [number, number]
export const LINE_TOLERANCE_M = 0.01
const R = 6378137
const DEG = Math.PI / 180
const MAX_LAT = 85.0511287798066
const distance = (a: LinePoint, b: LinePoint) => Math.hypot(a[0] - b[0], a[1] - b[1])
function finitePoint(p: LinePoint): void {
  if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
    throw new Error('Coordinates must contain two finite numbers.')
}
export function toMapPoint(p: LinePoint): LinePoint {
  finitePoint(p)
  if (Math.abs(p[1]) > MAX_LAT) throw new Error('Latitude is outside the valid Mercator range.')
  return [R * p[0] * DEG, R * Math.log(Math.tan(Math.PI / 4 + p[1] * DEG / 2))]
}
export function toGeoPoint(p: LinePoint): LinePoint {
  finitePoint(p)
  if (Math.abs(p[1]) > R * Math.PI) throw new Error('Map coordinate is outside the valid Mercator range.')
  return [p[0] / R / DEG, (2 * Math.atan(Math.exp(p[1] / R)) - Math.PI / 2) / DEG]
}
export function normalizeLine(points: LinePoint[]): LinePoint[] {
  if (!Array.isArray(points) || points.length < 2) throw new Error('Line needs at least two points.')
  const mapped = points.map(toMapPoint)
  const result: LinePoint[] = [points[0]!]
  let last = mapped[0]!
  for (let i = 1; i < points.length - 1; i++) {
    if (distance(last, mapped[i]!) > LINE_TOLERANCE_M) {
      result.push(points[i]!)
      last = mapped[i]!
    }
  }
  // Keep the original final endpoint rather than a nearby internal vertex.
  const end = points.at(-1)!
  while (result.length > 1 && distance(toMapPoint(result.at(-1)!), mapped.at(-1)!) <= LINE_TOLERANCE_M)
    result.pop()
  if (distance(toMapPoint(result.at(-1)!), mapped.at(-1)!) > LINE_TOLERANCE_M) result.push(end)
  if (result.length < 2) throw new Error('Line is degenerate within the 0.01 metre tolerance.')
  return result
}
export function splitLine(points: LinePoint[], click: LinePoint): { point: LinePoint; first: LinePoint[]; second: LinePoint[] } {
  const line = normalizeLine(points)
  const mapped = line.map(toMapPoint)
  const pick = toMapPoint(click)
  let best = Infinity, segment = 0, projected: LinePoint = mapped[0]!
  for (let i = 0; i < mapped.length - 1; i++) {
    const a = mapped[i]!, b = mapped[i + 1]!
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((pick[0] - a[0]) * dx + (pick[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    const candidate: LinePoint = [a[0] + t * dx, a[1] + t * dy]
    const d = distance(candidate, pick)
    if (d < best) { best = d; segment = i; projected = candidate }
  }
  if (distance(projected, mapped[0]!) <= LINE_TOLERANCE_M || distance(projected, mapped.at(-1)!) <= LINE_TOLERANCE_M)
    throw new Error('Split must be more than 0.01 metres from line endpoints.')
  const vertex = mapped.findIndex((p, i) => i > 0 && i < mapped.length - 1 && distance(p, projected) <= LINE_TOLERANCE_M)
  const point = vertex >= 0 ? line[vertex]! : toGeoPoint(projected)
  const first = normalizeLine(vertex >= 0 ? line.slice(0, vertex + 1) : [...line.slice(0, segment + 1), point])
  const second = normalizeLine(vertex >= 0 ? line.slice(vertex) : [point, ...line.slice(segment + 1)])
  return { point, first, second }
}
export function translateSegment(points: LinePoint[], index: number, deltaMap: LinePoint): LinePoint[] {
  normalizeLine(points)
  if (!Number.isInteger(index) || index < 0 || index >= points.length - 1) throw new Error('Invalid segment index.')
  finitePoint(deltaMap)
  if (distance(toMapPoint(points[index]!), toMapPoint(points[index + 1]!)) <= LINE_TOLERANCE_M)
    throw new Error('Cannot translate a degenerate segment.')
  if (deltaMap[0] === 0 && deltaMap[1] === 0) return points.slice()
  const move = (p: LinePoint): LinePoint => { const m = toMapPoint(p); return toGeoPoint([m[0] + deltaMap[0], m[1] + deltaMap[1]]) }
  const result = points.slice()
  result[index] = move(points[index]!)
  result[index + 1] = move(points[index + 1]!)
  if (index === 0) result.unshift(points[0]!)
  if (index === points.length - 2) result.push(points.at(-1)!)
  return normalizeLine(result)
}
export function lineHandles(points: LinePoint[]): { kind: 'vertex' | 'mid'; index: number; point: LinePoint }[] {
  normalizeLine(points)
  const handles: { kind: 'vertex' | 'mid'; index: number; point: LinePoint }[] = []
  points.forEach((point, index) => {
    handles.push({ kind: 'vertex', index, point })
    if (index < points.length - 1) {
      const a = toMapPoint(point), b = toMapPoint(points[index + 1]!)
      handles.push({ kind: 'mid', index, point: toGeoPoint([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) })
    }
  })
  return handles
}
