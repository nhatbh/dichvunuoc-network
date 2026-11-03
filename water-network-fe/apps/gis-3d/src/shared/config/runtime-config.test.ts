import { afterEach, describe, expect, it } from 'vitest'
import { FEATURE_FLAGS, getFeatureFlag, useUpdateFeatureFlags } from '@/shared/lib/feature-flags'
import {
  applyRuntimeConfig,
  DEFAULT_MAP_VIEW,
  getGisRuntimePolicy,
  getRuntimeMapView,
  getRuntimeOrganizationPolicy,
  type RuntimeConfig,
} from './runtime-config'

describe('GIS runtime contract', () => {
  it('defaults to the rollback-safe legacy rich experience', () => {
    applyRuntimeConfig({})

    expect(getGisRuntimePolicy()).toEqual({
      dataSource: 'legacy',
      viewerMode: 'rich',
    })
  })

  it('accepts canonical data independently from viewer mode', () => {
    applyRuntimeConfig({ gisDataSource: 'canonical', gisViewerMode: 'scalable' })

    expect(getGisRuntimePolicy()).toEqual({
      dataSource: 'canonical',
      viewerMode: 'scalable',
    })
  })

  it.each([
    [{ gisDataSource: 'other' }, /gisDataSource/],
    [{ gisViewerMode: 'other' }, /gisViewerMode/],
  ] as const)('rejects an invalid untrusted GIS runtime value: %o', (config, message) => {
    expect(() => applyRuntimeConfig(config as unknown as RuntimeConfig)).toThrow(message)
  })
})

describe('applyRuntimeConfig — feature flags', () => {
  afterEach(() => useUpdateFeatureFlags().resetFlags())

  it('applies feature flags carried in runtime config', () => {
    expect(getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)).toBe(false)
    applyRuntimeConfig({ flags: { newEditor: true } })
    expect(getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)).toBe(true)
  })

  it('is a no-op when no flags are present', () => {
    applyRuntimeConfig({ appName: 'X' })
    expect(getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)).toBe(false)
  })
})

describe('getRuntimeMapView', () => {
  it('returns a valid deploy-time map view', () => {
    applyRuntimeConfig({
      mapView: { center: { lon: 105.495, lat: 21.4 }, zoom: 13 },
    })

    expect(getRuntimeMapView()).toEqual({
      center: { lon: 105.495, lat: 21.4 },
      zoom: 13,
    })
  })

  it.each([
    { center: { lon: Number.NaN, lat: 21.4 }, zoom: 13 },
    { center: { lon: 181, lat: 21.4 }, zoom: 13 },
    { center: { lon: 105.495, lat: -91 }, zoom: 13 },
    { center: { lon: 105.495, lat: 21.4 }, zoom: 25 },
    { center: { lon: '105.495', lat: 21.4 }, zoom: 13 },
  ])('falls back to Hanoi for an invalid map view: %o', mapView => {
    applyRuntimeConfig({ mapView } as RuntimeConfig)

    expect(getRuntimeMapView()).toEqual(DEFAULT_MAP_VIEW)
  })
})

describe('runtime Organization policy', () => {
  it('defaults to Organization-disabled with no implicit legacy fallback', () => {
    applyRuntimeConfig({})

    expect(getRuntimeOrganizationPolicy()).toEqual({
      context: 'disabled',
      allowLegacyTenantIdFallback: false,
    })
  })

  it('accepts a tenant-specific Organization context', () => {
    applyRuntimeConfig({
      organization: {
        alias: 'hawaco',
        context: 'required',
        allowLegacyTenantIdFallback: false,
      },
    })

    expect(getRuntimeOrganizationPolicy()).toEqual({
      alias: 'hawaco',
      context: 'required',
      allowLegacyTenantIdFallback: false,
    })
  })

  it.each(['CWA', 'cwa.vn', 'cwa-1', ''])('rejects an invalid Organization alias: %s', alias => {
    const config = {
      organization: { alias, context: 'required' },
    } as RuntimeConfig

    expect(() => applyRuntimeConfig(config)).toThrow(/organization.alias/)
  })

  it('rejects a non-string alias from untrusted JSON', () => {
    expect(() =>
      applyRuntimeConfig({
        organization: { alias: 123, context: 'required' },
      } as unknown as RuntimeConfig)
    ).toThrow(/organization.alias/)
  })

  it('rejects a non-boolean legacy fallback flag from untrusted JSON', () => {
    expect(() =>
      applyRuntimeConfig({
        organization: {
          context: 'required',
          allowLegacyTenantIdFallback: 'true',
        },
      } as unknown as RuntimeConfig)
    ).toThrow(/allowLegacyTenantIdFallback/)
  })
})
