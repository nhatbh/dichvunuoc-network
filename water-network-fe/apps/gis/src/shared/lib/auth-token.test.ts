import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAuthToken, clearTokenCache } from './auth-token'

// Mock auth client
vi.mock('./client-auth', () => ({
  authClient: {
    getAccessToken: vi.fn(),
    getSession: vi.fn(),
  },
}))

describe('auth-token', () => {
  beforeEach(() => {
    clearTokenCache()
    vi.clearAllMocks()
  })

  it('returns null when no token available', async () => {
    const { authClient } = await import('./client-auth')
    vi.mocked(authClient.getAccessToken).mockResolvedValue(null)

    const token = await getAuthToken()
    expect(token).toBeNull()
  })

  it('caches token and avoids redundant calls', async () => {
    const { authClient } = await import('./client-auth')
    vi.mocked(authClient.getAccessToken).mockResolvedValue('test-token-123')
    vi.mocked(authClient.getSession).mockResolvedValue({
      user: { id: '1' },
      session: { expiresAt: Date.now() + 600_000 },
    })

    const token1 = await getAuthToken()
    const token2 = await getAuthToken()

    expect(token1).toBe('test-token-123')
    expect(token2).toBe('test-token-123')
    expect(authClient.getAccessToken).toHaveBeenCalledTimes(1)
  })

  it('clears cache and refetches after clearTokenCache', async () => {
    const { authClient } = await import('./client-auth')
    vi.mocked(authClient.getAccessToken).mockResolvedValue('test-token')
    vi.mocked(authClient.getSession).mockResolvedValue({
      user: { id: '1' },
      session: { expiresAt: Date.now() + 600_000 },
    })

    await getAuthToken()
    clearTokenCache()
    await getAuthToken()

    expect(authClient.getAccessToken).toHaveBeenCalledTimes(2)
  })
})
