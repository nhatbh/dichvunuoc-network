import { render, screen, waitFor } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createFakePort, type FakeMapEnginePort } from '@wn/map-runtime/testing'
import { http, HttpResponse } from 'msw'
import { createSignal, onCleanup, onMount } from 'solid-js'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { server } from '@/shared/api/mocks/server'
import { MapPage } from './map-page'

const runtime = vi.hoisted(() => ({ port: null as unknown, initialView: null as unknown }))

// Isolate from the auth chain — mock-auth seeds localStorage at import time;
// mocking here prevents the side-effect running in the jsdom environment.
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}))
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}))

// Mock @wn/map-runtime/solid so jsdom never tries to mount OpenLayers.
// Re-implement createMapRuntime with the gis Solid instance to share the reactive graph.
vi.mock('@wn/map-runtime/solid', () => ({
  createMapRuntime: (opts: { view: unknown; factory?: (v: unknown) => Promise<unknown> }) => {
    runtime.initialView = opts.view
    const [port, setPort] = createSignal<unknown>(null)
    let container: HTMLDivElement | undefined
    const containerRef = (el: HTMLDivElement) => {
      container = el
    }
    onMount(async () => {
      const instance = opts.factory ? await opts.factory(opts.view) : runtime.port
      if (!instance) return
      if (container) (instance as { mount: (el: HTMLDivElement) => void }).mount(container)
      setPort(instance)
    })
    onCleanup(() => {
      ;(port() as { destroy?: () => void })?.destroy?.()
    })
    return { containerRef, port }
  },
}))

// Strip AbortSignal from fetch calls to avoid jsdom/Node realm mismatch with MSW interceptors
let _origFetch: typeof globalThis.fetch
beforeAll(() => {
  _origFetch = globalThis.fetch
  globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    const rest = { ...(init ?? {}) }
    delete rest.signal
    return _origFetch(url, rest)
  }
})
afterAll(() => {
  globalThis.fetch = _origFetch
})

// MSW server (src/test/setup.ts) is already running gisHandlers which serve /api/gis/*

describe('MapPage', () => {
  let testPort: FakeMapEnginePort

  beforeEach(() => {
    testPort = createFakePort()
    testPort.setView({ center: { lon: 105.81, lat: 21.035 }, zoom: 14 })
    runtime.port = testPort
    runtime.initialView = null
  })

  it('renders the canonical layer catalog', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))
    expect(await screen.findByText('Tuyến ống')).toBeInTheDocument()
  })

  it('renders the map container element', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))
    expect(await screen.findByTestId('canonical-map')).toBeInTheDocument()
  })

  it('starts at the tenant bootstrap centre instead of the deploy-time fallback', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))

    await waitFor(() =>
      expect(runtime.initialView).toEqual({
        center: { lon: 105.85, lat: 21 },
        zoom: 12,
      })
    )
  })

  it('fits the tenant home extent before issuing the first viewport query', async () => {
    let mapRequestedAfterFit = false
    server.use(
      http.get('*/map', () => {
        mapRequestedAfterFit = vi.mocked(testPort.fitToBbox).mock.calls.length > 0
        return HttpResponse.json({
          type: 'FeatureCollection',
          features: [],
          truncated: false,
        })
      })
    )

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))

    await waitFor(() => expect(mapRequestedAfterFit).toBe(true))
    expect(testPort.fitToBbox).toHaveBeenCalledWith([105.7, 20.9, 106, 21.1], {
      padding: 64,
      maxZoom: 17,
    })
  })

  it('shows an explicit empty-tenant state without mounting or querying the map', async () => {
    let mapRequests = 0
    server.use(
      http.get('*/bootstrap', () =>
        HttpResponse.json({
          schemaVersion: 1,
          hasData: false,
          homeView: null,
          counts: { nodes: 0, pipes: 0, devices: 0, total: 0 },
          pipeLengthM: 0,
          materialMix: [],
          statusMix: [],
        })
      ),
      http.get('*/map', () => {
        mapRequests += 1
        return HttpResponse.json({ type: 'FeatureCollection', features: [] })
      })
    )

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))

    expect(await screen.findByText('Đơn vị chưa có dữ liệu GIS')).toBeInTheDocument()
    expect(screen.queryByTestId('canonical-map')).not.toBeInTheDocument()
    expect(mapRequests).toBe(0)
    expect(runtime.initialView).toBeNull()
  })

  it('reports a missing home view instead of falling back to Hanoi', async () => {
    server.use(
      http.get('*/bootstrap', () =>
        HttpResponse.json({
          schemaVersion: 1,
          hasData: true,
          homeView: null,
          counts: { nodes: 1, pipes: 0, devices: 0, total: 1 },
          pipeLengthM: 0,
          materialMix: [],
          statusMix: [],
        })
      )
    )

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))

    expect(await screen.findByText('Chưa xác định được vùng bản đồ của đơn vị')).toBeInTheDocument()
    expect(screen.queryByTestId('canonical-map')).not.toBeInTheDocument()
    expect(runtime.initialView).toBeNull()
  })

  it('opens the normalized inspector without edit or trace actions in canonical read-only mode', async () => {
    server.use(
      http.get('*/map', () =>
        HttpResponse.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'node-readonly',
              geometry: { type: 'Point', coordinates: [105.81, 21.035] },
              properties: {
                kind: 'Node',
                assetCode: 'NODE-READONLY',
                status: 'Active',
                nodeType: 'Junction',
              },
            },
          ],
          truncated: false,
        })
      )
    )

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))

    await waitFor(() => {
      const nodeCalls = vi.mocked(testPort.setFeatures).mock.calls.filter(([id]) => id === 'node')
      expect(nodeCalls.at(-1)?.[1].features.map(feature => feature.id)).toEqual(['node-readonly'])
    })

    testPort.emitClick('node-readonly')

    expect(await screen.findAllByText('NODE-READONLY')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Truy vết' })).not.toBeInTheDocument()
  })

  it('clears every viewer layer when the viewport exceeds the safe query area', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))

    await waitFor(() => expect(testPort.setFeatures).toHaveBeenCalled())
    testPort.setView({ center: { lon: 105.81, lat: 21.035 }, zoom: 1 })

    expect(
      await screen.findByText(/Khu vực đang hiển thị quá rộng/, undefined, { timeout: 2_000 })
    ).toBeInTheDocument()

    for (const layerId of ['pipe', 'node', 'valve', 'hydrant', 'source']) {
      const calls = vi.mocked(testPort.setFeatures).mock.calls.filter(([id]) => id === layerId)
      const lastCall = calls[calls.length - 1]
      expect(lastCall?.[1].features).toHaveLength(0)
    }
  })

  it('does not repaint a late response from an obsolete bbox', async () => {
    let requestCount = 0
    let releaseFirstResponse = () => {}
    const firstResponseGate = new Promise<void>(resolve => {
      releaseFirstResponse = resolve
    })

    server.use(
      http.get('*/map', async () => {
        requestCount += 1
        const requestNumber = requestCount
        if (requestNumber === 1) await firstResponseGate
        return HttpResponse.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: `node-${requestNumber}`,
              geometry: { type: 'Point', coordinates: [105.81, 21.035] },
              properties: { kind: 'Node', assetCode: `NODE-${requestNumber}` },
            },
          ],
          truncated: false,
        })
      })
    )

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={qc}>
        <MapPage />
      </QueryClientProvider>
    ))

    await waitFor(() => expect(requestCount).toBe(1))
    testPort.setView({ center: { lon: 106, lat: 21.035 }, zoom: 14 })
    await waitFor(() => expect(requestCount).toBe(2), { timeout: 2_000 })
    await waitFor(() => {
      const nodeCalls = vi.mocked(testPort.setFeatures).mock.calls.filter(([id]) => id === 'node')
      expect(nodeCalls.at(-1)?.[1].features.map(feature => feature.id)).toEqual(['node-2'])
    })

    releaseFirstResponse()
    await waitFor(() => expect(qc.isFetching()).toBe(0))

    const nodeCalls = vi.mocked(testPort.setFeatures).mock.calls.filter(([id]) => id === 'node')
    expect(nodeCalls.at(-1)?.[1].features.map(feature => feature.id)).toEqual(['node-2'])
  })
})
