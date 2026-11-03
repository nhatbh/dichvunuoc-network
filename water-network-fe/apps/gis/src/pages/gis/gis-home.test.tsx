import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { server } from '@/shared/api/mocks/server'
import { GisHome } from './gis-home'

vi.mock('@/entities/session', () => ({ useSessionContext: () => ({ session: () => null }) }))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}))
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}))
vi.mock('./gis-app', () => ({
  GisApp: () => <div data-testid="rich-gis-app">GIS tenant app</div>,
}))

let originalFetch: typeof globalThis.fetch
beforeAll(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    const rest = { ...(init ?? {}) }
    delete rest.signal
    return originalFetch(url, rest)
  }
})
afterAll(() => {
  globalThis.fetch = originalFetch
})

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <GisHome />
    </QueryClientProvider>
  ))
}

describe('GisHome tenant bootstrap', () => {
  it('shows an explicit empty state and does not request a fallback bbox', async () => {
    let mapRequests = 0
    let legacyRequests = 0
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
      }),
      http.get('*/full', () => {
        legacyRequests += 1
        return HttpResponse.json({})
      })
    )

    renderHome()

    expect(await screen.findByText('Đơn vị chưa có dữ liệu GIS')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Import CAD' })).toHaveAttribute('href', '/gis#import')
    expect(screen.getByTestId('gis-shell')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Về cổng ứng dụng' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Đổi giao diện' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    fireEvent.click(screen.getByRole('button', { name: 'Đổi giao diện' }))
    expect(screen.queryByTestId('rich-gis-app')).not.toBeInTheDocument()
    expect(mapRequests).toBe(0)
    expect(legacyRequests).toBe(0)
  })

  it('uses a centred sub-1-degree query for a large tenant extent', async () => {
    let requestedBbox: number[] | undefined
    server.use(
      http.get('*/bootstrap', () =>
        HttpResponse.json({
          schemaVersion: 1,
          hasData: true,
          homeView: {
            bbox: [104, 19, 108, 23],
            center: { lon: 106, lat: 21 },
            source: 'data_extent',
          },
          counts: { nodes: 1, pipes: 0, devices: 0, total: 1 },
          pipeLengthM: 0,
          materialMix: [],
          statusMix: [],
        })
      ),
      http.get('*/map', ({ request }) => {
        requestedBbox = new URL(request.url).searchParams.get('bbox')?.split(',').map(Number)
        return HttpResponse.json({
          type: 'FeatureCollection',
          features: [],
          truncated: false,
        })
      })
    )

    renderHome()

    expect(await screen.findByTestId('rich-gis-app')).toBeInTheDocument()
    await waitFor(() => expect(requestedBbox).toHaveLength(4))
    const [minLon, minLat, maxLon, maxLat] = requestedBbox as [number, number, number, number]
    expect((maxLon - minLon) * (maxLat - minLat)).toBeLessThan(1)
    expect((minLon + maxLon) / 2).toBeCloseTo(106, 10)
    expect((minLat + maxLat) / 2).toBeCloseTo(21, 10)
  })

  it('reports a missing home view instead of using the canonical default bbox', async () => {
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

    renderHome()

    expect(await screen.findByText('Chưa xác định được vùng bản đồ của đơn vị')).toBeInTheDocument()
    expect(screen.queryByTestId('rich-gis-app')).not.toBeInTheDocument()
  })
})
