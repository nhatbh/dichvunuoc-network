import { describe, expect, it } from 'vitest'
import legacySeed from '@/shared/api/mocks/gis-full.json'
import { parseLegacyGisData } from './legacy-gis-data'

describe('parseLegacyGisData compatibility boundary', () => {
  it('accepts the shipped legacy seed and supplies only its missing source device collection', () => {
    expect(legacySeed).not.toHaveProperty('sourceDevices')

    const data = parseLegacyGisData(legacySeed)

    expect(data.sourceDevices).toEqual([])
    expect(data.pipes).toEqual(legacySeed.pipes)
    expect(data.assets).toEqual(legacySeed.assets)
    expect(data.LAYERS).toEqual(legacySeed.LAYERS)
    expect(data.DASH).toEqual(legacySeed.DASH)
    expect(legacySeed).not.toHaveProperty('sourceDevices')
  })

  it('preserves source devices when they are supplied', () => {
    const sourceDevices = [
      {
        id: 'meter-1',
        code: 'FM-1',
        name: 'Đồng hồ đầu nguồn',
        deviceType: 'FlowMeter',
        status: 'ok',
        x: 100,
        y: 200,
      },
    ]

    expect(parseLegacyGisData({ ...legacySeed, sourceDevices }).sourceDevices).toEqual(
      sourceDevices
    )
  })

  it.each([null, {}, 'devices'])('rejects a malformed sourceDevices value: %j', sourceDevices => {
    expect(() => parseLegacyGisData({ ...legacySeed, sourceDevices })).toThrow()
  })

  it('rejects canonical data at the legacy contract boundary', () => {
    expect(() =>
      parseLegacyGisData({ ...legacySeed, canonical: true, sourceDevices: [] })
    ).toThrow()
  })

  it.each([null, {}, { ...legacySeed, pipes: undefined }, { ...legacySeed, DASH: null }])(
    'rejects incomplete or malformed required legacy data',
    payload => expect(() => parseLegacyGisData(payload)).toThrow()
  )
})
