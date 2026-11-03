import { http, HttpResponse } from 'msw'
import gisSeed from './gis-seed.json'
import { applyPublishedEdits } from './editor-handlers'
import { buildLegacyFullSeed } from './legacy-full-seed'

export const gisHandlers = [
  // Legacy (rich viewer) contract: the full design network in one payload.
  http.get('*/full', () => HttpResponse.json(applyPublishedEdits(buildLegacyFullSeed()))),
  http.get('*/dashboard', () => HttpResponse.json(gisSeed.dashboard)),
  http.get('*/layers', () => HttpResponse.json(gisSeed.layers)),
  http.get('*/network', () => HttpResponse.json(gisSeed.network)),
  http.get('*/bootstrap', () =>
    HttpResponse.json({
      schemaVersion: 1,
      hasData: true,
      homeView: {
        bbox: [105.7, 20.9, 106, 21.1],
        center: { lon: 105.85, lat: 21 },
        source: 'data_extent',
      },
      counts: { nodes: 54, pipes: 93, devices: 52, total: 199 },
      pipeLengthM: 16_517,
      materialMix: gisSeed.dashboard.matMix.map(item => ({
        material: item.label,
        count: item.n,
        lengthM: item.n,
      })),
      statusMix: gisSeed.dashboard.condMix.map(item => ({ status: item.label, count: item.n })),
    })
  ),
  http.get('*/map', () => {
    const network = gisSeed.network as Record<string, { features: unknown[] }>
    return HttpResponse.json({
      type: 'FeatureCollection',
      features: Object.values(network).flatMap(layer => layer.features),
      truncated: false,
    })
  }),
]
