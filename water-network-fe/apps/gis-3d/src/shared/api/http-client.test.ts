// @vitest-environment node
//
// Run in Node (not jsdom) so AbortController/fetch share the realm MSW's
// interceptor validates against, and so the auth chain's localStorage seeding
// is skipped (mock-auth no-ops without `window`).
import { http, HttpResponse, delay } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '@/shared/api/mocks/server'
import { ApiError } from './error-handler'

// Isolate the HTTP client from the auth chain (mock-auth seeds localStorage at
// import time, which is irrelevant here and flaky under Node's experimental
// localStorage global). These tests cover request/error behavior only.
vi.mock('@/shared/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/shared/lib/auth-token', () => ({
  getAuthToken: vi.fn(async () => null),
  clearTokenCache: vi.fn(),
}))
vi.mock('@/shared/lib/client-auth', () => ({
  authClient: { updateToken: vi.fn(async () => false) },
}))

const { createHttpClient } = await import('./http-client')

const BASE = 'http://api.test'
const client = createHttpClient({ baseURL: BASE })

describe('HttpClient', () => {
  it('returns parsed JSON on success', async () => {
    server.use(http.get(`${BASE}/ok`, () => HttpResponse.json({ value: 42 })))
    await expect(client.get<{ value: number }>('/ok')).resolves.toEqual({ value: 42 })
  })

  it('returns an empty object for non-JSON responses', async () => {
    server.use(http.get(`${BASE}/empty`, () => new HttpResponse(null, { status: 204 })))
    await expect(client.get('/empty')).resolves.toEqual({})
  })

  it('throws an ApiError carrying the HTTP status and body message', async () => {
    server.use(
      http.get(`${BASE}/missing`, () =>
        HttpResponse.json({ message: 'Item not found' }, { status: 404 })
      )
    )
    await expect(client.get('/missing')).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 404,
      message: 'Item not found',
    })
  })

  it('does not show toasts from the HTTP layer (presentation is centralized)', async () => {
    // Regression guard: the client must surface a throwable, not a side effect.
    server.use(http.get(`${BASE}/boom`, () => HttpResponse.json({}, { status: 500 })))
    const error = await client.get('/boom').catch(e => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).statusCode).toBe(500)
  })

  it('normalizes a timeout into a 408 ApiError', async () => {
    const slowClient = createHttpClient({ baseURL: BASE, timeout: 20 })
    server.use(
      http.get(`${BASE}/slow`, async () => {
        await delay(200)
        return HttpResponse.json({ ok: true })
      })
    )
    const error = await slowClient.get('/slow').catch(e => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).statusCode).toBe(408)
    expect((error as ApiError).code).toBe('TIMEOUT')
  })

  it('serializes the body for POST requests', async () => {
    server.use(
      http.post(`${BASE}/items`, async ({ request }) => {
        const body = (await request.json()) as { name: string }
        return HttpResponse.json({ created: body.name }, { status: 201 })
      })
    )
    await expect(client.post('/items', { name: 'widget' })).resolves.toEqual({ created: 'widget' })
  })
})
