import { describe, expect, it } from 'vitest'
import type { CanonicalNetworkData, GisBootstrap } from '@/entities/gis'
import { createCanonicalGisData } from './canonical-gis-data'
import { enrichGisData, gisPixelToLonLat } from './gis-data'

const bootstrap: GisBootstrap = {
  schemaVersion: 1,
  hasData: true,
  homeView: {
    bbox: [105.4, 21.3, 105.6, 21.5],
    center: { lon: 105.5, lat: 21.4 },
    source: 'data_extent',
  },
  counts: { nodes: 1, pipes: 1, devices: 2, total: 4 },
  pipeLengthM: 1234.5,
  materialMix: [{ material: 'HDPE', count: 1, lengthM: 1234.5 }],
  statusMix: [{ status: 'Active', count: 1 }],
}

const network: CanonicalNetworkData = {
  bbox: bootstrap.homeView!.bbox,
  featureCount: 4,
  limit: 10_000,
  truncated: false,
  layers: {
    node: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'n-1',
          geometry: { type: 'Point', coordinates: [105.45, 21.35] },
          properties: { assetCode: 'N-1', nodeType: 'Junction' },
        },
      ],
    },
    pipe: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p-1',
          geometry: {
            type: 'LineString',
            coordinates: [
              [105.45, 21.35],
              [105.5, 21.4],
              [105.55, 21.45],
            ],
          },
          properties: {
            assetCode: 'P-1',
            diameterMm: 200,
            material: 'HDPE',
            lengthM: 1234.5,
            status: 'Active',
            lifecycleStatus: 'Commissioned',
            fromNodeId: 'n-1',
            toNodeId: 'n-2',
          },
        },
      ],
    },
    valve: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'v-1',
          geometry: { type: 'Point', coordinates: [105.5, 21.4] },
          properties: {
            assetCode: 'V-1',
            deviceType: 'Valve',
            status: 'Active',
            lifecycleStatus: 'Suspended',
          },
        },
      ],
    },
    source: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'm-1',
          geometry: { type: 'Point', coordinates: [105.52, 21.42] },
          properties: { assetCode: 'M-1', deviceType: 'FlowMeter', status: 'Active' },
        },
      ],
    },
  },
}

describe('createCanonicalGisData', () => {
  it('adapts canonical tenant data without retaining demo operational records', () => {
    const data = createCanonicalGisData(bootstrap, network)

    expect(data.canonical).toBe(true)
    expect(data.DASH.pipeKm).toBeCloseTo(1.2345)
    expect(data.DASH.pipeCount).toBe(1)
    expect(data.DASH.valveCount).toBe(1)
    expect(data.pipes[0]).toMatchObject({
      id: 'p-1',
      code: 'P-1',
      dn: 200,
      material: 'HDPE',
      lenM: 1234.5,
      from: 'n-1',
      to: 'n-2',
      cond: 'commissioned',
    })
    expect(data.pipes[0]?.vertices).toHaveLength(3)
    expect(data.sourceDevices[0]).toMatchObject({ id: 'm-1', deviceType: 'FlowMeter' })
    expect(data.valves[0]?.state).toBe('unknown')
    expect(data.assets.find(asset => asset.id === 'v-1')).toMatchObject({
      status: 'ok',
      cond: 'suspended',
      attrs: {
        'Trạng thái tài sản': 'Đang vận hành',
        'Trạng thái vòng đời': 'Tạm dừng',
        'Trạng thái đóng/mở': 'Chưa có dữ liệu',
      },
    })
    expect(data.connections).toEqual([])
    expect(data.dmas).toEqual([])
    expect(data.topoIssues).toEqual([])
    expect(data.importJobs).toEqual([])
    expect(data.ROLES).toEqual([])
    expect(data.DATAFLOW.outputs).toContain('network.node.registered')
    expect(data.DATAFLOW.outputs).not.toContain('gis.asset-spatial.created')
    expect(data.assetLinks(data.assets[0] ?? null)).toEqual([])
  })

  it('uses only a dedicated physical-state field for a valve position', () => {
    const valve = network.layers.valve!.features[0]!
    const withPhysicalState: CanonicalNetworkData = {
      ...network,
      layers: {
        ...network.layers,
        valve: {
          type: 'FeatureCollection',
          features: [
            {
              ...valve,
              properties: { ...valve.properties, physicalState: 'Closed' },
            },
          ],
        },
      },
    }

    const data = createCanonicalGisData(bootstrap, withPhysicalState)

    expect(data.valves[0]?.state).toBe('closed')
    expect(data.assets.find(asset => asset.id === 'v-1')?.attrs['Trạng thái đóng/mở']).toBe('Đóng')
  })

  it('preserves canonical source devices through the shared rich-map enrichment', () => {
    const adapted = createCanonicalGisData(bootstrap, network)
    const data = enrichGisData(adapted)

    expect(data.canonical).toBe(true)
    expect(data.sourceDevices).toEqual(adapted.sourceDevices)
    expect(data.sourceDevices).toHaveLength(1)
    expect(data.sourceDevices[0]).toMatchObject({ id: 'm-1', deviceType: 'FlowMeter' })
    expect(data.assetLinks(data.assets[0] ?? null)).toEqual([])
  })

  it('carries the initial partial-extent signal into the rich map model', () => {
    const data = createCanonicalGisData(bootstrap, {
      ...network,
      initialExtentPartial: true,
    })

    expect(data.network?.initialExtentPartial).toBe(true)
  })

  it('keeps the tenant extent as the inverse of the rich-app pixel plane', () => {
    const data = createCanonicalGisData(bootstrap, network)
    const pipeStart = data.pipes[0]?.pts[0]

    expect(pipeStart).toBeDefined()
    expect(gisPixelToLonLat(data, pipeStart![0], pipeStart![1])).toEqual([105.45, 21.35])
    expect(data.geo?.bbox).toEqual(bootstrap.homeView?.bbox)
    expect(data.geo?.center).toEqual([105.5, 21.4])
  })

  it('returns a truthful empty shell for a tenant with no spatial data', () => {
    const empty = createCanonicalGisData({
      ...bootstrap,
      hasData: false,
      homeView: null,
      counts: { nodes: 0, pipes: 0, devices: 0, total: 0 },
      pipeLengthM: 0,
      materialMix: [],
      statusMix: [],
    })

    expect(empty.geo).toBeUndefined()
    expect(empty.assets).toEqual([])
    expect(empty.DASH.pipeCount).toBe(0)
    expect(empty.network?.truncated).toBe(false)
  })
})
