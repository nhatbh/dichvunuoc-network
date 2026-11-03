import { createRoot, createSignal } from 'solid-js'
import { describe, it, expect } from 'vitest'
import { createDebouncedAccessor } from './use-debounce'

describe('useDebounce', () => {
  it('returns initial value immediately', () => {
    createRoot(dispose => {
      const [value] = createSignal('hello')
      const debounced = createDebouncedAccessor(value, 100)
      expect(debounced()).toBe('hello')
      dispose()
    })
  })

  it('debounces rapid updates', async () => {
    await createRoot(async dispose => {
      const [value, setValue] = createSignal('')
      const debounced = createDebouncedAccessor(value, 50)

      setValue('a')
      setValue('b')
      setValue('c')

      expect(debounced()).toBe('')

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(debounced()).toBe('c')
      dispose()
    })
  })
})
