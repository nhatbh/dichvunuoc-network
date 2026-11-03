import { expect, it } from 'vitest'
import { LINE_TOLERANCE_M, splitLine, translateSegment, type LinePoint } from './geometry'
it('exposes the shared metre-tolerant geometry implementation', () => {
  const pts: LinePoint[] = [[105,21],[105.001,21]]
  expect(LINE_TOLERANCE_M).toBe(0.01)
  expect(splitLine(pts,[105.0005,21.0001]).point[1]).toBeCloseTo(21,10)
  const moved=translateSegment(pts,0,[0,10])
  expect(moved).toHaveLength(4)
  expect(moved[0]).toEqual(pts[0])
  expect(moved.at(-1)).toEqual(pts.at(-1))
})
