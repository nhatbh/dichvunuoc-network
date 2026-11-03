import { expect, it } from 'vitest'
import { LINE_TOLERANCE_M, toMapPoint, toGeoPoint, normalizeLine, splitLine, translateSegment, lineHandles, type LinePoint } from '../index.js'
const pts: LinePoint[] = [[105,21],[105.001,21]]
it('preserves endpoints during two-point translation and zero movement', () => {
  expect(LINE_TOLERANCE_M).toBe(0.01)
  const moved = translateSegment(pts, 0, [0,10])
  expect(moved).toHaveLength(4)
  expect(moved[0]).toEqual(pts[0])
  expect(moved.at(-1)).toEqual(pts.at(-1))
  expect(translateSegment(pts,0,[0,0])).toEqual(pts)
  expect(pts).toEqual([[105,21],[105.001,21]])
})
it('projects splits and rejects endpoints', () => {
  expect(() => splitLine(pts,pts[0]!)).toThrow()
  expect(splitLine(pts,[105.0005,21.0001]).point[1]).toBeCloseTo(21,10)
  expect(() => splitLine(pts,toGeoPoint([toMapPoint(pts[0]!)[0]+0.005,toMapPoint(pts[0]!)[1]]))).toThrow()
})
it('splits at an internal vertex without duplication', () => {
  const points: LinePoint[] = [pts[0]!, [105.0005,21],pts[1]!]
  const result=splitLine(points,points[1]!)
  expect(result.first).toEqual(points.slice(0,2))
  expect(result.second).toEqual(points.slice(1))
})
it('moves first middle and last segments with fixed outer endpoints', () => {
  const points: LinePoint[] = [[105,21],[105.001,21],[105.002,21],[105.003,21]]
  for (const index of [0,1,2]) {
    const moved=translateSegment(points,index,[0,10])
    expect(moved).toHaveLength(index===1?4:5)
    expect(moved[0]).toEqual(points[0])
    expect(moved.at(-1)).toEqual(points.at(-1))
  }
})
it('normalizes coincident points using map metres and retains endpoints', () => {
  const near=toGeoPoint([toMapPoint(pts[0]!)[0]+0.005,toMapPoint(pts[0]!)[1]])
  expect(normalizeLine([pts[0]!,near,pts[1]!])).toEqual(pts)
  expect(() => normalizeLine([pts[0]!,pts[0]!])).toThrow()
  expect(() => splitLine([pts[0]!,pts[0]!],pts[1]!)).toThrow()
})
it('rejects invalid coordinates, lines and segment indices', () => {
  expect(() => toMapPoint([105,90])).toThrow()
  expect(() => toGeoPoint([Infinity,0])).toThrow()
  expect(() => normalizeLine([[NaN,21],pts[1]!])).toThrow()
  expect(() => normalizeLine([])).toThrow()
  for(const index of [-1,1,0.5,NaN]) expect(() => translateSegment(pts,index,[0,10])).toThrow()
  expect(() => translateSegment(pts,0,[0,Infinity])).toThrow()
})
it('roundtrips projections and constructs ordered map-space midpoints', () => {
  const roundtrip=toGeoPoint(toMapPoint(pts[0]!))
  expect(roundtrip[0]).toBeCloseTo(105,10)
  expect(roundtrip[1]).toBeCloseTo(21,10)
  expect(lineHandles(pts)).toEqual([{kind:'vertex',index:0,point:pts[0]},{kind:'mid',index:0,point:splitLine(pts,[105.0005,21]).point},{kind:'vertex',index:1,point:pts[1]}])
})
