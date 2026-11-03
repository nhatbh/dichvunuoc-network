// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeOrganizationPolicy } from '@/shared/config/runtime-config'

/**
 * Regression for the keycloak-js lazy-singleton race.
 *
 * `getKeycloak()` did `if (!keycloak) { keycloak = new Keycloak(await import(...)) }`.
 * The `await` between the null-check and the assignment let two concurrent callers
 * (SessionProvider.onMount → getSession → initKeycloak, and createEffect →
 * attachKeycloakSessionSync → getKeycloak) each construct a *different* instance. `init()`
 * ran on one while the module stored the other, so calling `login()` on the un-init'd
 * instance threw "Cannot read properties of undefined (reading 'login')" (keycloak-js
 * dereferences its internal adapter, which only `init()` creates).
 *
 * Invariant: concurrent `getKeycloak()` calls must resolve to the SAME instance.
 */

const keycloakTestState = vi.hoisted(() => ({
  instances: [] as Array<{
    initOptions?: Record<string, unknown>
    loginOptions?: Record<string, unknown>
  }>,
  policy: {
    context: 'disabled',
    allowLegacyTenantIdFallback: false,
  } as RuntimeOrganizationPolicy,
}))

class MockKeycloak {
  authenticated = false
  token: string | undefined = undefined
  idToken: string | undefined = 'id-token'
  tokenParsed: Record<string, unknown> = {
    sub: 'user-1',
    preferred_username: 'viewer',
  }
  initOptions?: Record<string, unknown>
  loginOptions?: Record<string, unknown>

  constructor() {
    keycloakTestState.instances.push(this)
  }

  async init(options: Record<string, unknown>): Promise<boolean> {
    this.initOptions = options
    this.authenticated = true
    this.token = 'access-token'
    return true
  }
  async updateToken(): Promise<boolean> {
    return false
  }
  async login(options: Record<string, unknown>): Promise<void> {
    this.loginOptions = options
  }
  async logout(): Promise<void> {}
  async register(): Promise<void> {}
}

vi.mock('keycloak-js', () => ({ default: MockKeycloak }))

// keycloak-auth only needs clearTokenCache from auth-token; stub it so the test does not
// pull in client-auth → mock-auth (which touches localStorage at import).
vi.mock('@/shared/lib/auth-token', () => ({ clearTokenCache: vi.fn() }))

vi.mock('@/shared/config/runtime-config', () => ({
  getRuntimeOrganizationPolicy: () => keycloakTestState.policy,
}))

vi.mock('@/shared/config/env', () => ({
  env: {
    VITE_AUTH_MODE: 'keycloak',
    VITE_KEYCLOAK_URL: 'http://localhost:8080',
    VITE_KEYCLOAK_REALM: 'water-platform',
    VITE_KEYCLOAK_CLIENT_ID: 'water-network-gis-fe',
    VITE_KEYCLOAK_ON_LOAD: 'check-sso',
    VITE_KEYCLOAK_TENANT_REALM: '',
    VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI: '',
  },
}))

describe('keycloak-auth singleton under concurrency', () => {
  beforeEach(() => {
    vi.resetModules()
    keycloakTestState.instances.length = 0
    keycloakTestState.policy = {
      context: 'disabled',
      allowLegacyTenantIdFallback: false,
    }
  })

  it('concurrent getKeycloak() calls resolve to the same instance', async () => {
    const { getKeycloak } = await import('./keycloak-auth')

    const [a, b] = await Promise.all([getKeycloak(), getKeycloak()])

    expect(a).toBe(b)
  })

  it('reads the canonical singular permission claim as scalar or array', async () => {
    const { getPermissions } = await import('./keycloak-auth')

    expect(getPermissions({ permission: 'network-gis:read' })).toEqual(['network-gis:read'])
    expect(getPermissions({ permission: ['network-gis:read', 'network-gis:write'] })).toEqual([
      'network-gis:read',
      'network-gis:write',
    ])
  })

  it('retains legacy and authorization permissions without duplicates', async () => {
    const { getPermissions } = await import('./keycloak-auth')

    expect(
      getPermissions({
        permission: 'network-gis:read',
        permissions: ['network-gis:read', 'network-gis:write'],
        authorization: { permissions: [{ rsname: 'network-gis', scopes: ['read'] }] },
      })
    ).toEqual(['network-gis:read', 'network-gis:write'])
  })

  it('requests a tenant-specific Organization scope during Keycloak init', async () => {
    keycloakTestState.policy = {
      alias: 'hawaco',
      context: 'required',
      allowLegacyTenantIdFallback: false,
    }
    const { keycloakAuth } = await import('./keycloak-auth')
    const keycloak = (await import('./keycloak-auth').then(module =>
      module.getKeycloak()
    )) as MockKeycloak
    keycloak.tokenParsed = {
      sub: 'user-1',
      organization: { hawaco: { tenant_id: ['tnt_hawaco'] } },
    }

    const session = await keycloakAuth.getSession()

    expect(keycloak.initOptions).toMatchObject({ scope: 'organization:hawaco' })
    expect(session?.user).toMatchObject({
      tenantId: 'tnt_hawaco',
      organizationAlias: 'hawaco',
      tenantContextSource: 'organization',
    })
  })

  it('keeps the Organization scope on an explicit login request', async () => {
    keycloakTestState.policy = {
      alias: 'hawaco',
      context: 'required',
      allowLegacyTenantIdFallback: false,
    }
    const { getKeycloak, keycloakAuth } = await import('./keycloak-auth')
    const keycloak = (await getKeycloak()) as MockKeycloak

    await keycloakAuth.login('https://gis.example.test/return')

    expect(keycloak.loginOptions).toEqual({
      redirectUri: 'https://gis.example.test/return',
      scope: 'organization:hawaco',
    })
  })
})
