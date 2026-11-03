import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Isolated cookie-session fixture server: never contacts a live tenant. */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/network-editor-geometry.spec.ts',
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    env: {
      VITE_AUTH_MODE: 'backend-session',
      VITE_USE_MOCK_AUTH: 'false',
      VITE_USE_MOCK_DATA: 'false',
      VITE_USE_RUNTIME_CONFIG: 'true',
      VITE_API_URL: '/api/gis',
    },
  },
})
