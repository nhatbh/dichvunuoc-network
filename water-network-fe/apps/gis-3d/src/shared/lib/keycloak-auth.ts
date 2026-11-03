import { env } from '@/shared/config/env'
import { getRuntimeOrganizationPolicy } from '@/shared/config/runtime-config'
import { clearTokenCache } from './auth-token'
import { resolveSilentCheckSsoRedirectUri } from './silent-check-sso'
import { getOrganizationLoginScope, resolveTenantContext } from './tenant-context'
import type { AuthClient, AuthSessionData } from './client-auth'
import type Keycloak from 'keycloak-js'

interface ParsedToken {
  exp?: number
  sub?: string
  email?: string
  name?: string
  preferred_username?: string
  scope?: string
  /** Keycloak 26 Organization Membership mapper output. */
  organization?: unknown
  /** Temporary flat claim used only when runtime policy opts into fallback. */
  tenant_id?: unknown
  realm_access?: {
    roles?: string[]
  }
  resource_access?: Record<
    string,
    {
      roles?: string[]
    }
  >
  /** Canonical BE/Keycloak claim. Keycloak may serialize one value as a scalar. */
  permission?: string | string[]
  /** Legacy/UI compatibility claim retained during IAM migration. */
  permissions?: string[]
  authorization?: {
    permissions?: Array<{ rsname?: string; scopes?: string[] }>
  }
}

// Memoize the creation PROMISE (not the resolved instance): a lazy singleton that awaits an
// async `import()` must guard with the promise, otherwise concurrent callers each pass the
// null-check before the first assigns and construct separate Keycloak instances — only one of
// which gets init()'d, so login()/logout() on another throws "reading 'login'" (undefined adapter).
let keycloakPromise: Promise<Keycloak> | null = null
let initPromise: Promise<boolean> | null = null

function requireKeycloakConfig() {
  const missing = [
    ['VITE_KEYCLOAK_URL', env.VITE_KEYCLOAK_URL],
    ['VITE_KEYCLOAK_REALM', env.VITE_KEYCLOAK_REALM],
    ['VITE_KEYCLOAK_CLIENT_ID', env.VITE_KEYCLOAK_CLIENT_ID],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(`Missing Keycloak configuration: ${missing.join(', ')}`)
  }
}

/** Exported for the concurrency regression test — concurrent callers must share one instance. */
export async function getKeycloak(): Promise<Keycloak> {
  requireKeycloakConfig()

  if (!keycloakPromise) {
    keycloakPromise = import('keycloak-js').then(({ default: KeycloakConstructor }) => {
      // Multi-tenant: use tenant realm if provided, otherwise default realm
      const realm = env.VITE_KEYCLOAK_TENANT_REALM || env.VITE_KEYCLOAK_REALM
      return new KeycloakConstructor({
        url: env.VITE_KEYCLOAK_URL,
        realm,
        clientId: env.VITE_KEYCLOAK_CLIENT_ID,
      })
    })
  }

  return keycloakPromise
}

function extractRelayedToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const hash = window.location.hash
    if (!hash) return null

    // Parse hash parameters
    const params = new URLSearchParams(hash.substring(1)) // Remove '#'
    const token = params.get('access_token')

    if (token) {
      // Clean up the URL hash immediately for security
      params.delete('access_token')
      const newHash = params.toString()
      window.history.replaceState(
        {},
        '',
        window.location.pathname + window.location.search + (newHash ? `#${newHash}` : '')
      )
      return token
    }
  } catch {
    // Ignore URL parsing errors
  }
  return null
}

async function initKeycloak(): Promise<boolean> {
  if (!initPromise) {
    const relayedToken = extractRelayedToken()

    initPromise = getKeycloak().then(kc => {
      const organizationScope = getOrganizationLoginScope(getRuntimeOrganizationPolicy())
      return kc.init({
        token: relayedToken || undefined,
        onLoad: relayedToken ? undefined : env.VITE_KEYCLOAK_ON_LOAD,
        pkceMethod: 'S256',
        ...(organizationScope ? { scope: organizationScope } : {}),
        checkLoginIframe: false,
        silentCheckSsoRedirectUri:
          typeof window === 'undefined'
            ? env.VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI || undefined
            : resolveSilentCheckSsoRedirectUri(
                env.VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI,
                window.location.origin
              ),
      })
    })
  }

  return initPromise
}

/**
 * Subscribe to Keycloak session lifecycle so cached session data stays fresh.
 * Safe to call once at app startup; no-ops when not in Keycloak mode or when config is missing.
 */
export function attachKeycloakSessionSync(onInvalidate: () => void): void {
  if (env.VITE_AUTH_MODE !== 'keycloak') {
    return
  }

  void getKeycloak()
    .then(kc => {
      kc.onTokenExpired = () => {
        clearTokenCache()
        void kc.updateToken(30).finally(() => {
          onInvalidate()
        })
      }
      kc.onAuthLogout = () => {
        clearTokenCache()
        onInvalidate()
      }
      kc.onAuthSuccess = () => {
        clearTokenCache()
        onInvalidate()
      }
    })
    .catch(() => {
      // Missing Keycloak env or failed load — dev may run without IAM
    })
}

function readParsedToken(kc: Keycloak): ParsedToken {
  return (kc.tokenParsed ?? {}) as ParsedToken
}

function getRoles(parsed: ParsedToken): string[] {
  const realmRoles = parsed.realm_access?.roles ?? []
  const clientRoles = parsed.resource_access?.[env.VITE_KEYCLOAK_CLIENT_ID]?.roles ?? []

  return Array.from(new Set([...realmRoles, ...clientRoles]))
}

export function getPermissions(parsed: ParsedToken): string[] {
  const canonicalPermissions = Array.isArray(parsed.permission)
    ? parsed.permission
    : parsed.permission
      ? [parsed.permission]
      : []
  const legacyPermissions = parsed.permissions ?? []
  const authorizationPermissions =
    parsed.authorization?.permissions?.flatMap(permission => {
      const resource = permission.rsname
      const scopes = permission.scopes ?? []

      if (!resource) return scopes
      if (scopes.length === 0) return [resource]

      return scopes.map(scope => `${resource}:${scope}`)
    }) ?? []

  return Array.from(
    new Set([...canonicalPermissions, ...legacyPermissions, ...authorizationPermissions])
  )
}

async function getSession(): Promise<AuthSessionData | null> {
  const authenticated = await initKeycloak()
  const kc = await getKeycloak()

  if (!authenticated || !kc.authenticated) {
    return null
  }

  await kc.updateToken(30)

  const parsed = readParsedToken(kc)
  const roles = getRoles(parsed)
  const permissions = getPermissions(parsed)
  const tenantContext = resolveTenantContext(parsed, getRuntimeOrganizationPolicy())

  return {
    user: {
      id: parsed.sub ?? '',
      email: parsed.email,
      name: parsed.name,
      username: parsed.preferred_username,
      roles,
      permissions,
      tenantId: tenantContext?.tenantId,
      organizationAlias: tenantContext?.organizationAlias,
      organizationId: tenantContext?.organizationId,
      tenantContextSource: tenantContext?.source,
    },
    session: {
      token: kc.token,
      idToken: kc.idToken,
      expiresAt: parsed.exp ? parsed.exp * 1000 : undefined,
    },
  }
}

export const keycloakAuth: AuthClient = {
  signUp: {
    email: async () => {
      await initKeycloak()
      const kc = await getKeycloak()
      const organizationScope = getOrganizationLoginScope(getRuntimeOrganizationPolicy())
      await kc.register({
        redirectUri: window.location.origin,
        ...(organizationScope ? { scope: organizationScope } : {}),
      })
    },
  },
  signIn: {
    email: async () => {
      await initKeycloak()
      const kc = await getKeycloak()
      const organizationScope = getOrganizationLoginScope(getRuntimeOrganizationPolicy())
      await kc.login({
        redirectUri: window.location.origin,
        ...(organizationScope ? { scope: organizationScope } : {}),
      })
    },
  },
  signOut: async () => {
    clearTokenCache()
    await initKeycloak()
    const kc = await getKeycloak()
    await kc.logout({ redirectUri: window.location.origin })
  },
  getSession,
  getAccessToken: async () => {
    const authenticated = await initKeycloak()
    const kc = await getKeycloak()

    if (!authenticated || !kc.authenticated) {
      return null
    }

    await kc.updateToken(30)
    return kc.token ?? null
  },
  login: async redirectUri => {
    await initKeycloak()
    const kc = await getKeycloak()
    const organizationScope = getOrganizationLoginScope(getRuntimeOrganizationPolicy())
    await kc.login({
      redirectUri: redirectUri ?? window.location.href,
      ...(organizationScope ? { scope: organizationScope } : {}),
    })
  },
  logout: async redirectUri => {
    clearTokenCache()
    await initKeycloak()
    const kc = await getKeycloak()
    await kc.logout({ redirectUri: redirectUri ?? window.location.origin })
  },
  updateToken: async (minValiditySeconds = 30) => {
    const authenticated = await initKeycloak()
    const kc = await getKeycloak()

    if (!authenticated || !kc.authenticated) {
      return false
    }

    return kc.updateToken(minValiditySeconds)
  },
  hasRole: async role => {
    const session = await getSession()
    return session?.user.roles?.includes(role) ?? false
  },
  hasPermission: async permission => {
    const session = await getSession()
    return session?.user.permissions?.includes(permission) ?? false
  },
}
