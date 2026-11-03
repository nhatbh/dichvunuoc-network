import { describe, it, expect } from 'vitest'
import { styleSpecFor } from './gis-style'
describe('styleSpecFor', () => {
  it('pipe leak → red stroke', () => {
    const s = styleSpecFor({ assetType: 'pipe', status: 'leak', trunk: false })
    expect(s.stroke?.color).toBe('#D1242F')
  })
  it('trunk pipe ok → teal, thicker', () => {
    const s = styleSpecFor({ assetType: 'pipe', status: 'ok', trunk: true, dn: 400 })
    expect(s.stroke?.color).toBe('#0E7C86')
    expect(s.stroke!.width).toBeGreaterThanOrEqual(4)
  })
  it('valve → blue square image', () => {
    const s = styleSpecFor({ assetType: 'valve' })
    expect(s.image?.shape).toBe('square')
  })
})
