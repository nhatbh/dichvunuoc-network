import { createRoot } from 'solid-js'
import { describe, it, expect, vi } from 'vitest'
import { createThrottledCallback } from './use-throttle'

describe('useThrottle', () => {
  it('returns a function', () => {
    createRoot(dispose => {
      const throttled = createThrottledCallback(vi.fn(), 50)
      expect(typeof throttled).toBe('function')
      dispose()
    })
  })

  it('invokes callback on first call', async () => {
    await createRoot(async dispose => {
      const callback = vi.fn()
      const throttled = createThrottledCallback(callback, 50)

      throttled()
      // throttle from @solid-primitives/scheduled fires on trailing edge
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(callback).toHaveBeenCalled()
      dispose()
    })
  })
})
