/**
 * Production stub for mock-auth.
 *
 * This module replaces mock-auth.ts in production builds via Vite alias.
 * It provides no-op implementations so the auth client factory never
 * accidentally activates mock auth in production.
 */

import type { AuthSessionData } from './client-auth'

export const isMockAuthActive = false

export const mockAuth = {
  signUp: {
    email: async (): Promise<never> => {
      throw new Error('Mock auth is not available in production builds')
    },
  },
  signIn: {
    email: async (): Promise<never> => {
      throw new Error('Mock auth is not available in production builds')
    },
  },
  signOut: async (): Promise<void> => {},
  getSession: async (): Promise<AuthSessionData | null> => null,
}
