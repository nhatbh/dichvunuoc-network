/**
 * MSW Browser Setup
 *
 * Sets up Mock Service Worker for browser environment.
 * Used in development mode to mock API calls.
 */

import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

/**
 * Service Worker instance for browser
 *
 * To enable mocking in browser:
 * 1. Set VITE_USE_MOCK_DATA=true in your .env
 * 2. Run: npx msw init public/ --save
 * 3. Restart dev server
 */
export const worker = setupWorker(...handlers)

/**
 * Start the mock service worker
 */
export async function startMockServiceWorker(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_DATA === 'true') {
    try {
      await worker.start({
        onUnhandledRequest: 'bypass', // Don't warn about unhandled requests
        serviceWorker: {
          url: '/mockServiceWorker.js',
        },
      })
      console.log('🔶 MSW: Mock Service Worker started')
    } catch (error) {
      console.error('Failed to start Mock Service Worker:', error)
    }
  }
}
