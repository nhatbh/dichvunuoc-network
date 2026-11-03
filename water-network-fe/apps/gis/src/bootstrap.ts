/**
 * App bootstrap — load runtime config and MSW before rendering.
 */

import { applyRuntimeConfig, loadRuntimeConfig } from '@/shared/config/runtime-config'

export async function bootstrap(): Promise<void> {
  const runtime = await loadRuntimeConfig()
  if (runtime) {
    applyRuntimeConfig(runtime)
  }

  // Mocks are a dev-only concern. Dynamic-import behind the DEV flag so MSW and
  // the @wn/contracts/testing fixtures never ship to the production bundle.
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_DATA === 'true') {
    const { startMockServiceWorker } = await import('@/shared/api/mocks/browser')
    await startMockServiceWorker()
  }
}
