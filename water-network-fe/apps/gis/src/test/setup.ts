/**
 * Test Setup — Solid edition.
 */

import { cleanup } from '@solidjs/testing-library'
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '@/shared/api/mocks/server'
import { resetDraftStore } from '@/shared/api/mocks/handlers'

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterEach(() => {
  server.resetHandlers()
  resetDraftStore()
  cleanup()
})

afterAll(() => {
  server.close()
})
