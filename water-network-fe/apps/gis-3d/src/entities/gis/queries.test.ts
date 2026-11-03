// @vitest-environment node
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '@/shared/api/mocks/server'

vi.mock('@/shared/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}))
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}))

const { fetchNetwork, networkQueryOptions, toNetworkResponse } = await import('./queries')

describe('toNetworkResponse', () => {
  it('normalizes a Node for lowercase styling and inspector identity', () => {
    const result = toNetworkResponse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'n-1',
          geometry: { type: 'Point', coordinates: [105.8, 21] },
          properties: {
            kind: 'Node',
            assetCode: 'N-1',
            status: 'Active',
            nodeType: 'Junction',
          },
        },
      ],
      truncated: false,
    })

    expect(result.node?.features).toHaveLength(1)
    expect(result.node?.features[0]?.properties).toMatchObject({
      kind: 'node',
      assetType: 'node',
      assetCode: 'N-1',
      code: 'N-1',
      name: 'N-1',
      status: 'Active',
      nodeType: 'Junction',
    })
  })

  it('normalizes a Pipe and aliases diameterMm to dn without dropping raw fields', () => {
    const result = toNetworkResponse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'p-1',
          geometry: {
            type: 'LineString',
            coordinates: [
              [105.8, 21],
              [105.81, 21.01],
            ],
          },
          properties: {
            kind: 'Pipe',
            assetCode: 'P-1',
            diameterMm: 300,
            material: 'HDPE',
          },
        },
      ],
      truncated: false,
    })

    expect(result.pipe?.features).toHaveLength(1)
    expect(result.pipe?.features[0]?.properties).toMatchObject({
      kind: 'pipe',
      assetType: 'pipe',
      assetCode: 'P-1',
      code: 'P-1',
      name: 'P-1',
      diameterMm: 300,
      dn: 300,
      material: 'HDPE',
    })
  })

  it('maps a Device to the component style kind and its explicit subtype layer', () => {
    const result = toNetworkResponse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'v-1',
          geometry: { type: 'Point', coordinates: [105.805, 21.005] },
          properties: {
            kind: 'Device',
            deviceType: 'Valve',
            assetCode: 'V-1',
            hostPipeId: 'p-1',
          },
        },
      ],
      truncated: false,
    })

    expect(result.valve?.features).toHaveLength(1)
    expect(result.valve?.features[0]?.properties).toMatchObject({
      kind: 'component',
      assetType: 'valve',
      assetCode: 'V-1',
      code: 'V-1',
      name: 'V-1',
      deviceType: 'Valve',
      hostPipeId: 'p-1',
    })
  })

  it.each([
    ['Hydrant', 'hydrant'],
    ['FlowMeter', 'source'],
    ['Pump', 'source'],
    ['PressureSensor', 'source'],
  ] as const)('routes Device subtype %s to the %s layer', (deviceType, expectedLayer) => {
    const result = toNetworkResponse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: `device-${deviceType}`,
          geometry: { type: 'Point', coordinates: [105.805, 21.005] },
          properties: { kind: 'Device', deviceType, assetCode: `D-${deviceType}` },
        },
      ],
      truncated: false,
    })

    expect(result[expectedLayer]?.features[0]?.properties).toMatchObject({
      kind: 'component',
      assetType: expectedLayer,
      deviceType,
    })
  })
})

describe('fetchNetwork', () => {
  it('uses the supplied viewport bbox and preserves canonical truncation metadata', async () => {
    const bbox = [105.8, 21, 105.82, 21.02] as const
    server.use(
      http.get('*/map', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('bbox')).toBe(bbox.join(','))
        expect(url.searchParams.get('types')).toBe('node,pipe,device')
        expect(url.searchParams.get('limit')).toBe('500')
        return HttpResponse.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'n-1',
              geometry: { type: 'Point', coordinates: [105.81, 21.01] },
              properties: { kind: 'Node' },
            },
          ],
          truncated: true,
        })
      })
    )

    const result = await fetchNetwork(bbox, 500)

    expect(result.bbox).toEqual(bbox)
    expect(result.featureCount).toBe(1)
    expect(result.limit).toBe(500)
    expect(result.truncated).toBe(true)
    expect(result.layers.node?.features).toHaveLength(1)
  })

  it('keys each viewport independently and can stay disabled before the map is ready', () => {
    const bbox = [105.8, 21, 105.82, 21.02] as const
    const options = networkQueryOptions(bbox, false)

    expect(options.queryKey).toEqual(['gis', 'network', 'bbox', ...bbox, 10_000])
    expect(options.enabled).toBe(false)
  })
})
