/**
 * The simulated operations day on its own: a service worker that answers only the `/ops`
 * routes and lets every other request through to the real backend. Used when a deployment runs
 * the legacy demo network on a real server but sets `opsSource: "mock"` (no ops backend yet).
 */
import { setupWorker } from 'msw/browser'
import { opsHandlers } from './ops-handlers'

export async function startOpsMockWorker(): Promise<void> {
  try {
    await setupWorker(...opsHandlers).start({
      onUnhandledRequest: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
      quiet: true,
    })
    console.info('Operations data: simulated day (opsSource = mock)')
  } catch (error) {
    console.error('Could not start the simulated operations data:', error)
  }
}
