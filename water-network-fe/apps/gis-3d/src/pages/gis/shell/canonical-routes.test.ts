import { describe, expect, it } from 'vitest'
import { canonicalRoutes } from './canonical-routes'
import { OPS_ROUTES } from './nav'

describe('screens on the live (canonical) network', () => {
  it('include the SYSTEM 3D editor and the review of its revisions', () => {
    const routes = canonicalRoutes('off')
    expect(routes.has('editor')).toBe(true)
    expect(routes.has('versions')).toBe(true)
  })
  it('include the operations screens only when they are live', () => {
    const [ops] = [...OPS_ROUTES]
    expect(canonicalRoutes('off').has(ops!)).toBe(false)
    expect(canonicalRoutes('live').has(ops!)).toBe(true)
  })
})
