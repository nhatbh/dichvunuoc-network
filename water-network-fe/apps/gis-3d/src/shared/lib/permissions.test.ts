import { describe, expect, it } from 'vitest'
import { canAccessRoute, hasRoleLevel, isValidRole, requiresAuth, ROLES } from './permissions'

describe('role hierarchy', () => {
  it('ranks higher roles above lower ones', () => {
    expect(hasRoleLevel(ROLES.ADMIN, ROLES.USER)).toBe(true)
    expect(hasRoleLevel(ROLES.USER, ROLES.USER)).toBe(true)
    expect(hasRoleLevel(ROLES.GUEST, ROLES.USER)).toBe(false)
  })

  it('validates known roles', () => {
    expect(isValidRole('admin')).toBe(true)
    expect(isValidRole('superuser')).toBe(false)
  })
})

describe('canAccessRoute', () => {
  it('allows everyone on public routes', () => {
    expect(canAccessRoute('/', ROLES.GUEST)).toBe(true)
    expect(canAccessRoute('/login', ROLES.GUEST)).toBe(true)
  })

  it('defaults unknown routes to authenticated roles (user and above)', () => {
    expect(canAccessRoute('/something-new', ROLES.USER)).toBe(true)
    expect(canAccessRoute('/something-new', ROLES.GUEST)).toBe(false)
  })
})

describe('requiresAuth', () => {
  it('treats configured public routes as not requiring auth', () => {
    expect(requiresAuth('/login')).toBe(false)
  })

  it('defaults unknown routes to requiring auth', () => {
    expect(requiresAuth('/unmapped')).toBe(true)
  })
})
