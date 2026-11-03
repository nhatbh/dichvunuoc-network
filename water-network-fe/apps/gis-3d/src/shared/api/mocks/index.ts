/**
 * MSW Mocks Entry Point
 *
 * Export mock service worker utilities for browser and server.
 */

export { handlers } from './handlers'
export { worker, startMockServiceWorker } from './browser'
export { server } from './server'
