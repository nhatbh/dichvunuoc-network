import { afterEach, describe, expect, it } from 'vitest'
import {
  FEATURE_FLAGS,
  getFeatureFlag,
  setFeatureFlags,
  useUpdateFeatureFlags,
} from './feature-flags'

describe('setFeatureFlags — runtime flag overrides', () => {
  afterEach(() => useUpdateFeatureFlags().resetFlags())

  it('enables a known flag from an override map', () => {
    expect(getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)).toBe(false)
    setFeatureFlags({ newEditor: true })
    expect(getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)).toBe(true)
  })

  it('ignores unknown flag keys without throwing', () => {
    setFeatureFlags({ someFlagThatDoesNotExist: true })
    expect(getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)).toBe(false)
  })
})
