/**
 * App bootstrap — load runtime config and MSW before rendering.
 */

import { configureMapRuntime3D } from '@wn/map-runtime-3d'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { applyRuntimeConfig, loadRuntimeConfig } from '@/shared/config/runtime-config'

export async function bootstrap(): Promise<void> {
  // MapLibre 6 loads its worker from a separate script; Vite emits it as an asset.
  configureMapRuntime3D({ workerUrl })

  const runtime = await loadRuntimeConfig()
  if (runtime) {
    applyRuntimeConfig(runtime)
  }

  // Mocks are a dev-only concern, except in the frontend-only demo build (`--mode demo`).
  // Dynamic-import behind the flags so MSW and the fixtures never ship to a production bundle.
  if ((import.meta.env.DEV || import.meta.env.VITE_DEMO === 'true') && import.meta.env.VITE_USE_MOCK_DATA === 'true') {
    const { startMockServiceWorker } = await import('@/shared/api/mocks/browser')
    await startMockServiceWorker()
  }
}
