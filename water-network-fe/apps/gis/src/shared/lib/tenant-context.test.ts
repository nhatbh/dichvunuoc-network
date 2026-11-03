import { describe, expect, it } from 'vitest'
import type { RuntimeOrganizationPolicy } from '@/shared/config/runtime-config'
import {
  getOrganizationLoginScope,
  resolveTenantContext,
  TenantContextError,
} from './tenant-context'

const required = (alias?: string): RuntimeOrganizationPolicy => ({
  ...(alias ? { alias } : {}),
  context: 'required',
  allowLegacyTenantIdFallback: false,
})

describe('getOrganizationLoginScope', () => {
  it('requests a specific Organization on a tenant deployment', () => {
    expect(getOrganizationLoginScope(required('hawaco'))).toBe('organization:hawaco')
  })

  it('requests interactive Organization selection without a configured alias', () => {
    expect(getOrganizationLoginScope(required())).toBe('organization')
  })

  it('does not request an Organization during an explicit legacy transition', () => {
    expect(
      getOrganizationLoginScope({
        alias: 'legacy_waterco',
        context: 'disabled',
        allowLegacyTenantIdFallback: true,
      })
    ).toBeUndefined()
  })
})

describe('resolveTenantContext', () => {
  it('uses nested Organization tenant_id as the authoritative tenant projection', () => {
    expect(
      resolveTenantContext(
        {
          organization: {
            hawaco: {
              id: 'c5f80143-28e4-4a65-8bc6-02702483cf22',
              tenant_id: ['tnt_hawaco'],
            },
          },
          tenant_id: 'tnt_hawaco',
        },
        required('hawaco')
      )
    ).toEqual({
      tenantId: 'tnt_hawaco',
      organizationAlias: 'hawaco',
      organizationId: 'c5f80143-28e4-4a65-8bc6-02702483cf22',
      source: 'organization',
    })
  })

  it('does not require the transitional top-level tenant_id claim', () => {
    expect(
      resolveTenantContext(
        { organization: { quawaco: { tenant_id: ['tnt_quawaco'] } } },
        required()
      )
    ).toEqual({
      tenantId: 'tnt_quawaco',
      organizationAlias: 'quawaco',
      source: 'organization',
    })
  })

  it('fails closed when the configured Organization is not selected', () => {
    expect(() =>
      resolveTenantContext(
        { organization: { quawaco: { tenant_id: ['tnt_quawaco'] } } },
        required('hawaco')
      )
    ).toThrowError(TenantContextError)
  })

  it('fails closed for multiple Organizations without a selected context', () => {
    expect(() =>
      resolveTenantContext(
        {
          organization: {
            hawaco: { tenant_id: ['tnt_hawaco'] },
            quawaco: { tenant_id: ['tnt_quawaco'] },
          },
        },
        required()
      )
    ).toThrowError(/exactly one selected Organization/)
  })

  it.each([
    [{ organization: { 'Hà Nội': {} } }, 'invalid alias'],
    [{ organization: { hawaco: [] } }, 'invalid metadata'],
    [{ organization: { hawaco: {} } }, 'missing nested tenant_id'],
    [
      { organization: { hawaco: { tenant_id: ['tnt_hawaco', 'tnt_quawaco'] } } },
      'multivalued tenant_id',
    ],
    [
      { organization: { hawaco: { tenant_id: 'tnt_quawaco' } } },
      'mismatched organization attribute',
    ],
    [
      {
        organization: { hawaco: { tenant_id: ['tnt_hawaco'] } },
        tenant_id: 'tnt_quawaco',
      },
      'conflicting legacy claim',
    ],
  ])('rejects malformed or conflicting claims: %s (%s)', (claims, _description) => {
    expect(() => resolveTenantContext(claims, required())).toThrowError(TenantContextError)
  })

  it('accepts the flat claim only when the transition flag is explicit', () => {
    const policy: RuntimeOrganizationPolicy = {
      alias: 'cwa',
      context: 'disabled',
      allowLegacyTenantIdFallback: true,
    }

    expect(resolveTenantContext({ tenant_id: 'cwa' }, policy)).toEqual({
      tenantId: 'cwa',
      organizationAlias: 'cwa',
      source: 'legacy-tenant-id',
    })
  })

  it('rejects the flat claim when Organization context is required', () => {
    expect(() =>
      resolveTenantContext({ tenant_id: 'tnt_hawaco' }, required('hawaco'))
    ).toThrowError(/fallback is disabled/)
  })

  it('allows a required rollout to opt in to a bounded legacy fallback', () => {
    expect(
      resolveTenantContext(
        { tenant_id: 'tnt_hawaco' },
        {
          alias: 'hawaco',
          context: 'required',
          allowLegacyTenantIdFallback: true,
        }
      )
    ).toEqual({
      tenantId: 'tnt_hawaco',
      organizationAlias: 'hawaco',
      source: 'legacy-tenant-id',
    })
  })
})
