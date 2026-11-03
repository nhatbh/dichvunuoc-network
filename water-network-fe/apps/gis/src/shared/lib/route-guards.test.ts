import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authClient, type AuthSessionData } from './client-auth'
import { authGuard, permissionGuard, requireAuth, roleGuard } from './route-guards'

// `vi.mock` is hoisted above the imports, so `authClient` resolves to this stub.
vi.mock('./client-auth', () => ({
  authClient: {
    getSession: vi.fn(),
    hasRole: vi.fn(),
    hasPermission: vi.fn(),
    login: vi.fn(),
  },
}))

const getSession = vi.mocked(authClient.getSession)
const hasRole = vi.mocked(authClient.hasRole)
const hasPermission = vi.mocked(authClient.hasPermission)

const session: AuthSessionData = {
  user: { id: '1', roles: ['user'] },
  session: { token: 't' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireAuth', () => {
  it('returns true when a session exists', async () => {
    getSession.mockResolvedValue(session)
    await expect(requireAuth()).resolves.toBe(true)
  })

  it('returns false when there is no session', async () => {
    getSession.mockResolvedValue(null)
    await expect(requireAuth()).resolves.toBe(false)
  })

  it('returns false when the session lookup throws', async () => {
    getSession.mockRejectedValue(new Error('network'))
    await expect(requireAuth()).resolves.toBe(false)
  })
})

describe('authGuard', () => {
  it('resolves for an authenticated user', async () => {
    getSession.mockResolvedValue(session)
    await expect(authGuard()).resolves.toBeUndefined()
  })

  it('redirects (throws) for an anonymous user in non-keycloak mode', async () => {
    getSession.mockResolvedValue(null)
    await expect(authGuard()).rejects.toBeDefined()
  })
})

describe('roleGuard', () => {
  it('resolves when the user has the required role', async () => {
    getSession.mockResolvedValue(session)
    hasRole.mockResolvedValue(true)
    await expect(roleGuard('user')).resolves.toBeUndefined()
  })

  it('redirects when the user lacks the required role', async () => {
    getSession.mockResolvedValue(session)
    hasRole.mockResolvedValue(false)
    await expect(roleGuard('admin')).rejects.toBeDefined()
  })
})

describe('permissionGuard', () => {
  it('resolves when the user holds the permission', async () => {
    getSession.mockResolvedValue(session)
    hasPermission.mockResolvedValue(true)
    await expect(permissionGuard('view:dashboard')).resolves.toBeUndefined()
  })

  it('redirects when the user lacks the permission', async () => {
    getSession.mockResolvedValue(session)
    hasPermission.mockResolvedValue(false)
    await expect(permissionGuard('manage:roles')).rejects.toBeDefined()
  })
})
