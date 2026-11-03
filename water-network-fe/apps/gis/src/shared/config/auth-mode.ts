/**
 * Auth mode helpers — shared by HTTP client and auth adapters.
 */

import { env } from './env'

export function isBackendSessionMode(): boolean {
  return env.VITE_AUTH_MODE === 'backend-session'
}

export function isKeycloakMode(): boolean {
  return env.VITE_AUTH_MODE === 'keycloak'
}

export function usesBearerAuth(): boolean {
  return !isBackendSessionMode()
}
