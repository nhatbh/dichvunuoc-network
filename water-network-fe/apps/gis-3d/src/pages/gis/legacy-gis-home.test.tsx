import { fireEvent, render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { server } from '@/shared/api/mocks/server'
import legacySeed from '@/shared/api/mocks/gis-full.json'
import { LegacyGisHome } from './legacy-gis-home'

vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}))
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}))
vi.mock('./gis-app', async () => {
  const { useGis } = await import('./lib/gis-data')
  return {
    GisApp: () => {
      const data = useGis()
      return (
        <div data-testid="legacy-rich-gis-app">
          <span data-testid="legacy-pipe-count">{data.pipes.length}</span>
          {data.sourceDevices.map(device => (
            <span>{device.code}</span>
          ))}
        </div>
      )
    },
  }
})

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
      <LegacyGisHome />
    </QueryClientProvider>
  ))
}

describe('LegacyGisHome data boundary', () => {
  it('loads the existing legacy seed without sourceDevices using only /full', async () => {
    let fullRequests = 0
    let canonicalRequests = 0
    server.use(
      http.get('*/full', () => {
        fullRequests += 1
        return HttpResponse.json(legacySeed)
      }),
      http.get('*/bootstrap', () => {
        canonicalRequests += 1
        return HttpResponse.json({})
      }),
      http.get('*/map', () => {
        canonicalRequests += 1
        return HttpResponse.json({ type: 'FeatureCollection', features: [] })
      })
    )

    renderHome()

    expect(await screen.findByTestId('legacy-rich-gis-app')).toBeInTheDocument()
    expect(screen.getByTestId('legacy-pipe-count')).toHaveTextContent(
      String(legacySeed.pipes.length)
    )
    expect(fullRequests).toBe(1)
    expect(canonicalRequests).toBe(0)
  })

  it.each([
    ['an incomplete object', {}],
    ['an invalid sourceDevices collection', { ...legacySeed, sourceDevices: null }],
  ])('handles HTTP 200 with %s before mounting the map', async (_description, payload) => {
    let canonicalRequests = 0
    server.use(
      http.get('*/full', () => HttpResponse.json(payload)),
      http.get('*/bootstrap', () => {
        canonicalRequests += 1
        return HttpResponse.json({})
      })
    )

    renderHome()

    expect(await screen.findByText(/Không tải được dữ liệu GIS/)).toBeInTheDocument()
    expect(screen.queryByTestId('legacy-rich-gis-app')).not.toBeInTheDocument()
    expect(canonicalRequests).toBe(0)
  })

  it('recovers from a map render error after one retry fetches corrected legacy data', async () => {
    let fullRequests = 0
    let canonicalRequests = 0
    server.use(
      http.get('*/full', () => {
        fullRequests += 1
        return HttpResponse.json(
          fullRequests === 1 ? { ...legacySeed, sourceDevices: [null] } : legacySeed
        )
      }),
      http.get('*/bootstrap', () => {
        canonicalRequests += 1
        return HttpResponse.json({})
      })
    )

    renderHome()

    expect(await screen.findByText('Không tải được dữ liệu GIS')).toBeInTheDocument()
    expect(screen.queryByTestId('legacy-rich-gis-app')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))

    expect(await screen.findByTestId('legacy-rich-gis-app')).toBeInTheDocument()
    expect(screen.queryByText('Không tải được dữ liệu GIS')).not.toBeInTheDocument()
    expect(fullRequests).toBe(2)
    expect(canonicalRequests).toBe(0)
  })
})
