import { describe, expect, it } from 'vitest'
import { validatedEnvSchema } from './env'

function parse(overrides: Record<string, unknown>) {
  // All non-overridden fields fall back to their schema defaults.
  return validatedEnvSchema.safeParse(overrides)
}

describe('env validation', () => {
  it('accepts a minimal mock-mode config', () => {
    const result = parse({ VITE_AUTH_MODE: 'mock' })
    expect(result.success).toBe(true)
  })

  it('rejects keycloak mode without IdP configuration when runtime config is disabled', () => {
    const result = parse({ VITE_AUTH_MODE: 'keycloak', VITE_USE_RUNTIME_CONFIG: 'false' })
    expect(result.success).toBe(false)
    const paths = result.success ? [] : result.error.issues.map(i => i.path.join('.'))
    expect(paths).toContain('VITE_KEYCLOAK_URL')
    expect(paths).toContain('VITE_KEYCLOAK_REALM')
    expect(paths).toContain('VITE_KEYCLOAK_CLIENT_ID')
  })

  it('accepts keycloak mode without baked IdP values when runtime config is enabled', () => {
    // Production image bakes VITE_AUTH_MODE=keycloak + VITE_USE_RUNTIME_CONFIG=true
    // with empty IdP URLs — they arrive via /config.json at runtime.
    const result = parse({
      VITE_AUTH_MODE: 'keycloak',
      VITE_USE_RUNTIME_CONFIG: 'true',
    })
    expect(result.success).toBe(true)
  })

  it('accepts keycloak mode when fully configured', () => {
    const result = parse({
      VITE_AUTH_MODE: 'keycloak',
      VITE_KEYCLOAK_URL: 'https://idp.example.com',
      VITE_KEYCLOAK_REALM: 'app',
      VITE_KEYCLOAK_CLIENT_ID: 'spa',
    })
    expect(result.success).toBe(true)
  })

  it('requires VITE_API_URL in production without runtime config', () => {
    const result = parse({
      NODE_ENV: 'production',
      VITE_API_URL: '',
      VITE_USE_RUNTIME_CONFIG: 'false',
    })
    expect(result.success).toBe(false)
    const paths = result.success ? [] : result.error.issues.map(i => i.path.join('.'))
    expect(paths).toContain('VITE_API_URL')
  })

  it('allows an empty VITE_API_URL in production when runtime config is on', () => {
    const result = parse({
      NODE_ENV: 'production',
      VITE_API_URL: '',
      VITE_USE_RUNTIME_CONFIG: 'true',
    })
    expect(result.success).toBe(true)
  })
})
