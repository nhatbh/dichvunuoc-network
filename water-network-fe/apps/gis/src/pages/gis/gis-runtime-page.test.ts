// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveGisExperience } from './lib/gis-runtime'

describe('resolveGisExperience', () => {
  it('never lets a viewer query override cross the legacy data boundary', () => {
    expect(resolveGisExperience({ dataSource: 'legacy', viewerMode: 'rich' }, 'canonical')).toBe(
      'legacy-rich'
    )
    expect(resolveGisExperience({ dataSource: 'legacy', viewerMode: 'scalable' }, 'scalable')).toBe(
      'legacy-rich'
    )
  })

  it('selects rich or scalable presentation only after canonical data is enabled', () => {
    expect(resolveGisExperience({ dataSource: 'canonical', viewerMode: 'rich' })).toBe(
      'canonical-rich'
    )
    expect(resolveGisExperience({ dataSource: 'canonical', viewerMode: 'scalable' })).toBe(
      'canonical-scalable'
    )
    expect(resolveGisExperience({ dataSource: 'canonical', viewerMode: 'rich' }, 'scalable')).toBe(
      'canonical-scalable'
    )
  })
})
