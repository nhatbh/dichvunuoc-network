import { describe, it, expect } from 'vitest'
import { resolveSilentCheckSsoRedirectUri } from './silent-check-sso'

describe('resolveSilentCheckSsoRedirectUri', () => {
  it('returns the configured value when provided', () => {
    expect(
      resolveSilentCheckSsoRedirectUri('https://x/sso.html', 'https://gis-dev.dichvunuoc.vn'),
    ).toBe('https://x/sso.html')
  })

  it('derives from origin when configured is empty', () => {
    expect(resolveSilentCheckSsoRedirectUri('', 'https://gis-dev.dichvunuoc.vn')).toBe(
      'https://gis-dev.dichvunuoc.vn/silent-check-sso.html',
    )
  })
})
