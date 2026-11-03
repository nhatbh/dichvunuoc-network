/**
 * Runtime configuration loaded from /config.json at deploy time.
 *
 * Use this when the same Docker image must point at different API gateways
 * or IAM hosts per environment without rebuilding.
 */

import { setFeatureFlags } from '@/shared/lib/feature-flags'
import { env } from './env'

export interface RuntimeConfig {
  apiUrl?: string
  secondaryApiUrl?: string
  keycloakUrl?: string
  keycloakRealm?: string
  keycloakClientId?: string
  menuAppUrl?: string
  accountUrl?: string
  appName?: string
  /** Selects the backend contract. This is the single rollback switch. */
  gisDataSource?: GisDataSource
  /** Selects the UI implementation after the canonical backend is enabled. */
  gisViewerMode?: GisViewerMode
  mapView?: RuntimeMapView
  /**
   * Keycloak Organization context requested by this deployment.
   *
   * Keep the application client per-app (`water-network-gis-fe`). Tenant
   * selection happens through the standard Keycloak `organization` scope,
   * never by replacing the realm or client id with tenant-specific values.
   */
  organization?: RuntimeOrganizationConfig
  /** Runtime feature-flag overrides; unknown keys are ignored. */
  flags?: Record<string, boolean>
}

export type GisDataSource = 'legacy' | 'canonical'
export type GisViewerMode = 'rich' | 'scalable'

export interface GisRuntimePolicy {
  dataSource: GisDataSource
  viewerMode: GisViewerMode
}

export type RuntimeOrganizationContext = 'disabled' | 'optional' | 'required'

export interface RuntimeOrganizationConfig {
  /**
   * Optional Keycloak Organization alias for a tenant-specific deployment.
   * Reliable tenant selection (including `organization:<alias>` and multi-org
   * users) requires Keycloak >= 26.2. The repository currently pins 26.0, so
   * this setting is a prepared cutover contract only.
   */
  alias?: string
  /** Whether the login/session must be bound to an Organization. */
  context: RuntimeOrganizationContext
  /**
   * Temporary migration escape hatch for the old top-level `tenant_id` claim.
   * Production Organization-first deployments should leave this false.
   */
  allowLegacyTenantIdFallback?: boolean
}

export interface RuntimeOrganizationPolicy {
  alias?: string
  context: RuntimeOrganizationContext
  allowLegacyTenantIdFallback: boolean
}

export interface RuntimeMapView {
  center: {
    lon: number
    lat: number
  }
  zoom: number
}

export const DEFAULT_MAP_VIEW: RuntimeMapView = {
  center: { lon: 105.81, lat: 21.035 },
  zoom: 14,
}

let cached: RuntimeConfig | null = null
let gisRuntimePolicy: GisRuntimePolicy = {
  dataSource: 'legacy',
  viewerMode: 'rich',
}
let organizationPolicy: RuntimeOrganizationPolicy = {
  context: 'disabled',
  allowLegacyTenantIdFallback: false,
}

const ORGANIZATION_ALIAS_PATTERN = /^[a-z0-9_]+$/

function resolveGisRuntimePolicy(config: RuntimeConfig): GisRuntimePolicy {
  const dataSource = config.gisDataSource ?? 'legacy'
  const viewerMode = config.gisViewerMode ?? 'rich'

  if (dataSource !== 'legacy' && dataSource !== 'canonical') {
    throw new Error('Invalid runtime gisDataSource; expected legacy or canonical')
  }
  if (viewerMode !== 'rich' && viewerMode !== 'scalable') {
    throw new Error('Invalid runtime gisViewerMode; expected rich or scalable')
  }

  return { dataSource, viewerMode }
}

function resolveOrganizationPolicy(
  organization: RuntimeOrganizationConfig | undefined
): RuntimeOrganizationPolicy {
  if (organization === undefined) {
    return { context: 'disabled', allowLegacyTenantIdFallback: false }
  }
  if (typeof organization !== 'object' || organization === null) {
    throw new Error('Invalid runtime organization; expected an object')
  }

  if (!['disabled', 'optional', 'required'].includes(organization.context)) {
    throw new Error('Invalid runtime organization.context')
  }

  if (organization.alias !== undefined && typeof organization.alias !== 'string') {
    throw new Error('Invalid runtime organization.alias; expected a string')
  }
  const alias = organization.alias?.trim()
  if (
    organization.alias !== undefined &&
    (!alias || !ORGANIZATION_ALIAS_PATTERN.test(alias) || alias.length > 28)
  ) {
    throw new Error('Invalid runtime organization.alias; expected [a-z0-9_] and at most 28 chars')
  }

  if (
    organization.allowLegacyTenantIdFallback !== undefined &&
    typeof organization.allowLegacyTenantIdFallback !== 'boolean'
  ) {
    throw new Error('Invalid runtime organization.allowLegacyTenantIdFallback')
  }

  return {
    ...(alias ? { alias } : {}),
    context: organization.context,
    allowLegacyTenantIdFallback: organization.allowLegacyTenantIdFallback ?? false,
  }
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  if (cached) return cached
  if (env.VITE_USE_RUNTIME_CONFIG !== 'true') return null

  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (!res.ok) return null
    cached = (await res.json()) as RuntimeConfig
    return cached
  } catch {
    return null
  }
}

export function getRuntimeConfig(): RuntimeConfig | null {
  return cached
}

/** Validated GIS source/viewer contract used by the route boundary. */
export function getGisRuntimePolicy(): GisRuntimePolicy {
  return { ...gisRuntimePolicy }
}

/** Validated Organization policy. Safe to use when constructing OIDC requests. */
export function getRuntimeOrganizationPolicy(): RuntimeOrganizationPolicy {
  return { ...organizationPolicy }
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/**
 * Initial GIS viewport from deploy-time config.
 *
 * JSON is untrusted at runtime even though `RuntimeConfig` is typed, so reject
 * malformed or out-of-range values as one unit and retain the Hanoi default.
 */
export function getRuntimeMapView(): RuntimeMapView {
  const view = cached?.mapView
  const lon = view?.center?.lon
  const lat = view?.center?.lat
  const zoom = view?.zoom

  if (
    isFiniteNumberInRange(lon, -180, 180) &&
    isFiniteNumberInRange(lat, -90, 90) &&
    isFiniteNumberInRange(zoom, 0, 24)
  ) {
    return { center: { lon, lat }, zoom }
  }

  return {
    center: { ...DEFAULT_MAP_VIEW.center },
    zoom: DEFAULT_MAP_VIEW.zoom,
  }
}

/** Default account self-service portal (account-dev). */
const DEFAULT_ACCOUNT_URL = 'https://account-dev.dichvunuoc.vn/'

/**
 * URL of the account configuration / self-service page.
 * Runtime config wins, then VITE_ACCOUNT_URL, then the account-dev default.
 */
export function getAccountUrl(): string {
  return (
    cached?.accountUrl ??
    (env as unknown as Record<string, string>).VITE_ACCOUNT_URL ??
    DEFAULT_ACCOUNT_URL
  )
}

/** Apply runtime overrides to build-time env (call once before rendering app). */
export function applyRuntimeConfig(config: RuntimeConfig): void {
  const nextOrganizationPolicy = resolveOrganizationPolicy(config.organization)
  const nextGisRuntimePolicy = resolveGisRuntimePolicy(config)

  cached = config
  organizationPolicy = nextOrganizationPolicy
  gisRuntimePolicy = nextGisRuntimePolicy

  if (config.apiUrl) {
    ;(env as { VITE_API_URL: string }).VITE_API_URL = config.apiUrl
  }
  if (config.secondaryApiUrl) {
    ;(env as { VITE_SECONDARY_API_URL: string }).VITE_SECONDARY_API_URL = config.secondaryApiUrl
  }
  if (config.keycloakUrl) {
    ;(env as { VITE_KEYCLOAK_URL: string }).VITE_KEYCLOAK_URL = config.keycloakUrl
  }
  if (config.keycloakRealm) {
    ;(env as { VITE_KEYCLOAK_REALM: string }).VITE_KEYCLOAK_REALM = config.keycloakRealm
  }
  if (config.keycloakClientId) {
    ;(env as { VITE_KEYCLOAK_CLIENT_ID: string }).VITE_KEYCLOAK_CLIENT_ID = config.keycloakClientId
  }
  if (config.menuAppUrl) {
    ;(env as { VITE_MENU_APP_URL: string }).VITE_MENU_APP_URL = config.menuAppUrl
  }
  if (config.accountUrl) {
    ;(env as unknown as Record<string, string>).VITE_ACCOUNT_URL = config.accountUrl
  }
  if (config.appName) {
    ;(env as { VITE_APP_NAME: string }).VITE_APP_NAME = config.appName
  }
  if (config.flags) {
    setFeatureFlags(config.flags)
  }
}
