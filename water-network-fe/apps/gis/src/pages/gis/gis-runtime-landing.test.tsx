import { fireEvent, render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { server } from '@/shared/api/mocks/server'
import { GisRuntimePage } from './gis-runtime-page'

vi.mock('@/entities/session', () => ({ useSessionContext: () => ({ session: () => null }) }))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}))
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}))
vi.mock('@/shared/config/runtime-config', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/config/runtime-config')>()),
  getGisRuntimePolicy: () => ({ dataSource: 'canonical', viewerMode: 'rich' }),
}))
vi.mock('./gis-app', () => ({ GisApp: () => <div>Published GIS map</div> }))
vi.mock('./map-page', () => ({ MapPage: () => <div>Scalable GIS map</div> }))
vi.mock('./screens/import', () => ({ ImportScreen: () => <div>CAD import workspace</div> }))

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
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('canonical GIS runtime landing', () => {
  it('offers import for an empty tenant without requesting legacy data or mounting a map', async () => {
    let bootstrapRequests = 0
    let fullRequests = 0
    let mapRequests = 0
    server.use(
      http.get('*/bootstrap', () => {
        bootstrapRequests += 1
        return HttpResponse.json({
          schemaVersion: 1,
          hasData: false,
          homeView: null,
          counts: { nodes: 0, pipes: 0, devices: 0, total: 0 },
          pipeLengthM: 0,
          materialMix: [],
          statusMix: [],
        })
      }),
      http.get('*/full', () => {
        fullRequests += 1
        return HttpResponse.json({})
      }),
      http.get('*/map', () => {
        mapRequests += 1
        return HttpResponse.json({ type: 'FeatureCollection', features: [] })
      })
    )
    window.history.replaceState(null, '', '/gis')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(() => (
      <QueryClientProvider client={queryClient}>
        <GisRuntimePage />
      </QueryClientProvider>
    ))

    expect(await screen.findByText('Đơn vị chưa có dữ liệu GIS')).toBeInTheDocument()
    expect(screen.getByTestId('gis-shell')).toBeInTheDocument()
    const importLink = screen.getByRole('link', { name: 'Import CAD' })
    expect(importLink).toHaveAttribute('href', '/gis#import')
    expect(screen.queryByText('Published GIS map')).not.toBeInTheDocument()
    expect(screen.queryByText('Scalable GIS map')).not.toBeInTheDocument()
    expect(bootstrapRequests).toBe(1)
    expect(fullRequests).toBe(0)
    expect(mapRequests).toBe(0)

    fireEvent.click(importLink)
    expect(await screen.findByText('CAD import workspace')).toBeInTheDocument()
    expect(screen.getByTestId('gis-shell')).toBeInTheDocument()
    expect(fullRequests).toBe(0)
    expect(mapRequests).toBe(0)
  })
})
