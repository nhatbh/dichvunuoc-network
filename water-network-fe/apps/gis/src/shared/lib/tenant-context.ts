import type { RuntimeOrganizationPolicy } from '@/shared/config/runtime-config'

export interface TenantTokenClaims {
  /** Keycloak 26 Organization Membership mapper output. */
  organization?: unknown
  /** Legacy, user-attribute-based claim retained only during migration. */
  tenant_id?: unknown
}

export type TenantContextSource = 'organization' | 'legacy-tenant-id'

export interface TenantContext {
  tenantId: string
  organizationAlias?: string
  organizationId?: string
  source: TenantContextSource
}

export type TenantContextErrorCode =
  | 'invalid-organization-claim'
  | 'organization-context-mismatch'
  | 'ambiguous-organization-context'
  | 'invalid-tenant-id'
  | 'tenant-id-mismatch'
  | 'organization-context-required'
  | 'legacy-tenant-id-disabled'

export class TenantContextError extends Error {
  constructor(
    public readonly code: TenantContextErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TenantContextError'
  }
}

const ORGANIZATION_ALIAS_PATTERN = /^[a-z0-9_]+$/
const TENANT_ID_PATTERN = /^[a-z0-9_]+$/
const TENANT_ID_PREFIX = 'tnt_'
const MAX_TENANT_ID_LENGTH = 32
const MAX_ALIAS_LENGTH = MAX_TENANT_ID_LENGTH - TENANT_ID_PREFIX.length

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidAlias(alias: string): boolean {
  return (
    alias.length > 0 && alias.length <= MAX_ALIAS_LENGTH && ORGANIZATION_ALIAS_PATTERN.test(alias)
  )
}

function canonicalTenantId(alias: string): string {
  return `${TENANT_ID_PREFIX}${alias}`
}

function parseTenantIdValue(value: unknown, claimName: string): string | undefined {
  if (value === undefined || value === null) return undefined

  const values = Array.isArray(value) ? value : [value]
  if (values.length !== 1 || typeof values[0] !== 'string') {
    throw new TenantContextError(
      'invalid-tenant-id',
      `${claimName} must contain exactly one string value`
    )
  }

  const tenantId = values[0].trim()
  if (
    tenantId.length === 0 ||
    tenantId.length > MAX_TENANT_ID_LENGTH ||
    !TENANT_ID_PATTERN.test(tenantId)
  ) {
    throw new TenantContextError(
      'invalid-tenant-id',
      `${claimName} must match [a-z0-9_] and be at most ${MAX_TENANT_ID_LENGTH} chars`
    )
  }

  return tenantId
}

function resolveLegacyTenantContext(
  claims: TenantTokenClaims,
  policy: RuntimeOrganizationPolicy
): TenantContext | undefined {
  const legacyTenantId = parseTenantIdValue(claims.tenant_id, 'tenant_id')

  if (!legacyTenantId) {
    if (policy.context === 'required') {
      throw new TenantContextError(
        'organization-context-required',
        'The authenticated session is not bound to a Keycloak Organization'
      )
    }
    return undefined
  }

  if (!policy.allowLegacyTenantIdFallback) {
    if (policy.context === 'required') {
      throw new TenantContextError(
        'legacy-tenant-id-disabled',
        'Legacy tenant_id fallback is disabled for this deployment'
      )
    }
    return undefined
  }

  if (
    policy.alias &&
    legacyTenantId !== policy.alias &&
    legacyTenantId !== canonicalTenantId(policy.alias)
  ) {
    throw new TenantContextError(
      'organization-context-mismatch',
      `Legacy tenant_id does not match Organization ${policy.alias}`
    )
  }

  const derivedAlias = legacyTenantId.startsWith(TENANT_ID_PREFIX)
    ? legacyTenantId.slice(TENANT_ID_PREFIX.length)
    : undefined
  const organizationAlias =
    policy.alias ?? (derivedAlias && isValidAlias(derivedAlias) ? derivedAlias : undefined)

  return {
    tenantId: legacyTenantId,
    ...(organizationAlias ? { organizationAlias } : {}),
    source: 'legacy-tenant-id',
  }
}

/**
 * Resolve the selected tenant from a Keycloak 26 Organization claim.
 *
 * Organization alias is the canonical tenant key. The nested Organization
 * `tenant_id` attribute is the authoritative stable projection and must equal
 * `tnt_<alias>`; conflicting flat/nested claims fail closed.
 */
export function resolveTenantContext(
  claims: TenantTokenClaims,
  policy: RuntimeOrganizationPolicy
): TenantContext | undefined {
  if (policy.context === 'disabled') {
    return resolveLegacyTenantContext(claims, policy)
  }

  const rawOrganization = claims.organization
  if (rawOrganization === undefined || rawOrganization === null) {
    return resolveLegacyTenantContext(claims, policy)
  }
  if (!isRecord(rawOrganization)) {
    throw new TenantContextError(
      'invalid-organization-claim',
      'organization must be a JSON object keyed by Organization alias'
    )
  }

  const entries = Object.entries(rawOrganization)
  if (entries.length === 0) {
    return resolveLegacyTenantContext(claims, policy)
  }

  let selected: [string, unknown]
  if (policy.alias) {
    const matching = entries.find(([alias]) => alias === policy.alias)
    if (!matching) {
      throw new TenantContextError(
        'organization-context-mismatch',
        `Token is not bound to configured Organization ${policy.alias}`
      )
    }
    if (entries.length !== 1) {
      throw new TenantContextError(
        'ambiguous-organization-context',
        'A tenant-specific login must contain exactly one Organization'
      )
    }
    selected = matching
  } else {
    if (entries.length !== 1) {
      throw new TenantContextError(
        'ambiguous-organization-context',
        'Token must contain exactly one selected Organization'
      )
    }
    selected = entries[0] as [string, unknown]
  }

  const [organizationAlias, metadata] = selected
  if (!isValidAlias(organizationAlias) || !isRecord(metadata)) {
    throw new TenantContextError(
      'invalid-organization-claim',
      'organization contains an invalid alias or metadata value'
    )
  }

  const expectedTenantId = canonicalTenantId(organizationAlias)
  const mappedTenantId = parseTenantIdValue(
    metadata.tenant_id,
    `organization.${organizationAlias}.tenant_id`
  )
  if (!mappedTenantId) {
    throw new TenantContextError(
      'invalid-tenant-id',
      `Organization ${organizationAlias} is missing its tenant_id attribute`
    )
  }
  if (mappedTenantId !== expectedTenantId) {
    throw new TenantContextError(
      'tenant-id-mismatch',
      `Organization ${organizationAlias} has inconsistent tenant_id metadata`
    )
  }

  const legacyTenantId = parseTenantIdValue(claims.tenant_id, 'tenant_id')
  if (legacyTenantId && legacyTenantId !== mappedTenantId) {
    throw new TenantContextError(
      'tenant-id-mismatch',
      'Legacy tenant_id conflicts with the selected Organization'
    )
  }

  const organizationId = metadata.id
  if (
    organizationId !== undefined &&
    (typeof organizationId !== 'string' || organizationId.trim().length === 0)
  ) {
    throw new TenantContextError(
      'invalid-organization-claim',
      `organization.${organizationAlias}.id must be a non-empty string`
    )
  }

  return {
    tenantId: mappedTenantId,
    organizationAlias,
    ...(typeof organizationId === 'string' ? { organizationId } : {}),
    source: 'organization',
  }
}

/** Scope passed to keycloak-js. Keycloak adds `openid` automatically. */
export function getOrganizationLoginScope(policy: RuntimeOrganizationPolicy): string | undefined {
  if (policy.context === 'disabled') return undefined
  return policy.alias ? `organization:${policy.alias}` : 'organization'
}
