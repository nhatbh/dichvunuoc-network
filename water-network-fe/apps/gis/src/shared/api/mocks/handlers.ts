/**
 * MSW (Mock Service Worker) Request Handlers
 *
 * Define mock API responses for testing and development.
 * Paths are matched relative to VITE_API_URL (use wildcard host prefix).
 */

import { http, HttpResponse } from 'msw'
import { aSnapshot, aMapFeatureCollection } from '@wn/contracts/testing'
import { gisHandlers } from './gis-handlers'
import {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  SplitPipeRequest,
  ConnectNodeToPipeRequest,
  type DraftNetworkFeature,
} from '@wn/contracts/draft'

// Shared fixture so /features and /search never diverge. Coordinates stay within
// DEFAULT_BBOX ([105.7,20.9,106.0,21.1]) so search hits are already loaded & highlightable.
const mockFeatures = aMapFeatureCollection({ count: 6 })

/** Axis-aligned bbox [minLon,minLat,maxLon,maxLat] from a GeoJSON geometry's coordinates. */
function featureBbox(coordinates: unknown): [number, number, number, number] {
  const pts: number[][] = []
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[])
    else if (Array.isArray(c)) c.forEach(walk)
  }
  walk(coordinates)
  const lons = pts.map((p) => p[0] ?? 0)
  const lats = pts.map((p) => p[1] ?? 0)
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

const mockSession = {
  user: {
    id: '1',
    email: 'demo@example.com',
    name: 'Demo User',
    roles: ['user'],
  },
  session: {
    id: 'session-1',
    userId: '1',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  },
}

// In-memory draft working-set (single-user mock). Reset per test via resetDraftStore().
let draftFeatures: DraftNetworkFeature[] = []
let draftSeq = 0
export function resetDraftStore(): void {
  draftFeatures = []
  draftSeq = 0
}

/** Planar distance from point p to segment [a,b] (lon/lat as cartesian — fine for the mock). */
function distToSegment(a: number[], b: number[], p: number[]): number {
  const ax = a[0] ?? 0, ay = a[1] ?? 0, bx = b[0] ?? 0, by = b[1] ?? 0, px = p[0] ?? 0, py = p[1] ?? 0
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Split a LineString's coordinates at `at` (closest segment). Null if degenerate (on an endpoint). */
function splitLineAt(coords: number[][], at: number[]): { a: number[][]; b: number[][] } | null {
  if (coords.length < 2) return null
  const same = (p: number[], q: number[]) =>
    Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0)) < 1e-9
  if (same(at, coords[0]!) || same(at, coords[coords.length - 1]!)) return null
  let best = 0, bestD = Infinity
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distToSegment(coords[i]!, coords[i + 1]!, at)
    if (d < bestD) { bestD = d; best = i }
  }
  return { a: [...coords.slice(0, best + 1), at], b: [at, ...coords.slice(best + 1)] }
}

export const handlers = [
  ...gisHandlers,
  http.get('*/snapshot/:id/features', () => HttpResponse.json(mockFeatures)),

  http.post('*/snapshot/:id/draft/features', async ({ request }) => {
    const parsed = CreateDraftFeatureRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid draft feature' }, { status: 422 })
    }
    const { kind, geometry } = parsed.data
    const created: DraftNetworkFeature = {
      type: 'Feature',
      id: `draft-${++draftSeq}`,
      geometry,
      properties: { kind, name: `Draft ${kind} ${draftSeq}`, status: 'draft' },
    }
    draftFeatures.push(created)
    return HttpResponse.json(created, { status: 201 })
  }),

  http.get('*/snapshot/:id/draft/features', () =>
    HttpResponse.json({ type: 'FeatureCollection', features: draftFeatures }),
  ),

  http.patch('*/snapshot/:id/draft/features/:featureId', async ({ params, request }) => {
    const parsed = UpdateDraftFeatureGeometryRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid draft geometry' }, { status: 422 })
    }
    const target = draftFeatures.find((f) => f.id === String(params.featureId))
    if (!target) {
      return HttpResponse.json({ error: 'Draft feature not found' }, { status: 404 })
    }
    target.geometry = parsed.data.geometry
    return HttpResponse.json(target, { status: 200 })
  }),

  http.post('*/snapshot/:id/draft/features/:featureId/split', async ({ params, request }) => {
    const parsed = SplitPipeRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid split request' }, { status: 422 })
    }
    if (parsed.data.atPoint.type !== 'Point') {
      return HttpResponse.json({ error: 'atPoint must be a Point geometry' }, { status: 422 })
    }
    const idx = draftFeatures.findIndex((f) => f.id === String(params.featureId))
    if (idx < 0) {
      return HttpResponse.json({ error: 'Draft feature not found' }, { status: 404 })
    }
    const target = draftFeatures[idx]!
    if (target.geometry.type !== 'LineString') {
      return HttpResponse.json({ error: 'Only a pipe (LineString) can be split' }, { status: 400 })
    }
    const at = (parsed.data.atPoint as { coordinates: number[] }).coordinates
    const split = splitLineAt(target.geometry.coordinates as number[][], at)
    if (!split) {
      return HttpResponse.json({ error: 'Degenerate split' }, { status: 400 })
    }
    const make = (c: number[][]): DraftNetworkFeature => ({
      type: 'Feature',
      id: `draft-${++draftSeq}`,
      geometry: { type: 'LineString', coordinates: c },
      properties: { ...target.properties },
    })
    const a = make(split.a), b = make(split.b)
    draftFeatures.splice(idx, 1, a, b)
    return HttpResponse.json([a, b], { status: 200 })
  }),

  http.post('*/snapshot/:id/draft/features/:featureId/connect', async ({ params, request }) => {
    const parsed = ConnectNodeToPipeRequest.safeParse(await request.json())
    if (!parsed.success) {
      return HttpResponse.json({ error: 'Invalid connect request' }, { status: 422 })
    }
    const pipe = draftFeatures.find((f) => f.id === String(params.featureId))
    if (!pipe) {
      return HttpResponse.json({ error: 'Pipe not found' }, { status: 404 })
    }
    if (pipe.geometry.type !== 'LineString') {
      return HttpResponse.json({ error: 'Connect target must be a pipe (LineString)' }, { status: 400 })
    }
    const node = draftFeatures.find((f) => f.id === parsed.data.nodeId)
    if (!node) {
      return HttpResponse.json({ error: 'Node not found' }, { status: 404 })
    }
    if (node.properties.kind !== 'node') {
      return HttpResponse.json({ error: 'nodeId must reference a node' }, { status: 400 })
    }
    const at = (parsed.data.atPoint as { coordinates: number[] }).coordinates
    const dedupe = (ids: string[]) => [...new Set(ids)]

    const movedNode: DraftNetworkFeature = {
      ...node,
      geometry: { type: 'Point', coordinates: at },
      properties: { ...node.properties },
    }

    const split = splitLineAt(pipe.geometry.coordinates as number[][], at)
    let newPipes: DraftNetworkFeature[]
    if (split) {
      // Interior pick → split into two pipes, both referencing the node.
      const make = (c: number[][]): DraftNetworkFeature => ({
        type: 'Feature',
        id: `draft-${++draftSeq}`,
        geometry: { type: 'LineString', coordinates: c },
        properties: {
          ...pipe.properties,
          connectedFeatureIds: dedupe([...(pipe.properties.connectedFeatureIds ?? []), node.id]),
        },
      })
      newPipes = [make(split.a), make(split.b)]
      movedNode.properties.connectedFeatureIds = dedupe([
        ...(node.properties.connectedFeatureIds ?? []),
        ...newPipes.map((p) => p.id),
      ])
    } else {
      // Endpoint pick → attach without splitting; keep the same pipe id.
      const updatedPipe: DraftNetworkFeature = {
        ...pipe,
        properties: {
          ...pipe.properties,
          connectedFeatureIds: dedupe([...(pipe.properties.connectedFeatureIds ?? []), node.id]),
        },
      }
      newPipes = [updatedPipe]
      movedNode.properties.connectedFeatureIds = dedupe([
        ...(node.properties.connectedFeatureIds ?? []),
        pipe.id,
      ])
    }

    // Replace the old pipe + old node with the new pipe(s) + moved node (preserve the array reference).
    const remaining = draftFeatures.filter((f) => f.id !== pipe.id && f.id !== node.id)
    draftFeatures.length = 0
    draftFeatures.push(...remaining, ...newPipes, movedNode)

    return HttpResponse.json([...newPipes, movedNode], { status: 200 })
  }),

  http.get('*/snapshot/:id/search', ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase()
    const results = mockFeatures.features
      .filter(
        (f) =>
          q !== '' &&
          (f.id.toLowerCase().includes(q) ||
            (f.properties.name ?? '').toLowerCase().includes(q) ||
            f.properties.kind.toLowerCase().includes(q)),
      )
      .map((f) => ({
        id: f.id,
        name: f.properties.name ?? f.id,
        kind: f.properties.kind,
        bbox: featureBbox(f.geometry.coordinates),
      }))
    return HttpResponse.json({ results })
  }),

  http.get('*/snapshot/:id', ({ params }) =>
    HttpResponse.json(aSnapshot({ snapshotId: String(params.id) })),
  ),

  http.get('*/api/session', () => HttpResponse.json(mockSession)),

  http.get('*/auth/session', () =>
    HttpResponse.json({
      user: mockSession.user,
      session: { token: 'session-cookie' },
    })
  ),

  http.get('*/auth/csrf', () => HttpResponse.json({ csrfToken: 'mock-csrf-token' })),

  http.post('*/api/auth/sign-in', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email && body.password) {
      return HttpResponse.json(mockSession)
    }
    return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }),

  http.post('*/api/auth/sign-out', () => HttpResponse.json({ success: true })),
]
