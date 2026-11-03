/**
 * MSW Server Setup
 *
 * Sets up Mock Service Worker for Node.js environment.
 * Used in tests (Vitest) to mock API calls.
 */

import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/**
 * Server instance for Node.js (tests)
 */
export const server = setupServer(...handlers)
