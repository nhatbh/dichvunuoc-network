import { describe, expect, it } from 'vitest'
import { designPreviewToDraftFeatures, toDesignGeometry, toDesignKind } from './design-adapter'

describe('Design BFF draft adapter', () => {
  it('maps preview assets to editor GeoJSON and flattens point coordinates', () => {
    const result = designPreviewToDraftFeatures([
      {
        id: 'node-1',
        kind: 'Node',
        assetCode: 'N-001',
        clientRef: null,
        geometryType: 'Point',
        coordinates: [[105.8, 21]],
        fromRef: null,
        toRef: null,
        hostRef: null,
        attributes: {},
      },
      {
        id: 'pipe-1',
        kind: 'Pipe',
        assetCode: 'P-001',
        geometryType: 'LineString',
        coordinates: [
          [105.8, 21],
          [105.81, 21.01],
        ],
        attributes: {},
      },
    ])

    expect(result.features[0]?.geometry.coordinates).toEqual([105.8, 21])
    expect(result.features[0]?.properties).toMatchObject({ kind: 'node', name: 'N-001' })
    expect(result.features[1]?.properties.kind).toBe('pipe')
  })

  it('maps editor commands to the deployed Design contract', () => {
    expect(toDesignKind('pipe')).toBe('Pipe')
    expect(toDesignGeometry({ type: 'Point', coordinates: [105.8, 21] })).toEqual({
      type: 'Point',
      coordinates: [[105.8, 21]],
    })
    expect(() =>
      toDesignGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [105.8, 21],
            [105.81, 21],
            [105.8, 21],
          ],
        ],
      })
    ).toThrow(/điểm và đường/)
  })
})
