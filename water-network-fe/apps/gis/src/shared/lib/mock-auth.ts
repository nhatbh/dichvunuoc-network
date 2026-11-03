/**
 * Mock Authentication Client
 *
 * Stores users and sessions in localStorage for development/demo purposes.
 * Passwords are obfuscated (not cryptographically hashed) to avoid plaintext storage.
 * This is a mock implementation — never use in production.
 */

import { env } from '@/shared/config/env'
import type { AuthSessionData } from './client-auth'

/** Parse a comma-separated env list into a trimmed, non-empty string array. */
function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
}

/** Roles granted to the mock session (configurable via VITE_MOCK_ROLES). */
export function mockRoles(): string[] {
  const roles = parseCsv(env.VITE_MOCK_ROLES)
  return roles.length > 0 ? roles : ['user']
}

/** Permissions granted to the mock session (configurable via VITE_MOCK_PERMISSIONS). */
export function mockPermissions(): string[] {
  return parseCsv(env.VITE_MOCK_PERMISSIONS)
}

interface StoredUser {
  id: string
  email: string
  name?: string
  ph: string // obfuscated password hash
  createdAt: string
}

interface SafeUser {
  id: string
  email: string
  name?: string
  createdAt: string
}

interface Session {
  token: string
  userId: string
  expiresAt: number
}

const USERS_KEY = 'mock_users'
const SESSION_KEY = 'mock_session'

/** Simple obfuscation — NOT cryptographic, just avoids plaintext in localStorage. */
function obscure(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .split('')
    .reverse()
    .join('')
}

function verifyPassword(raw: string, ph: string): boolean {
  return obscure(raw) === ph
}

/** Local mock auth runs in dev unless VITE_USE_MOCK_AUTH=false. Never seeds storage in production builds. */
export const isMockAuthActive =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_AUTH !== 'false'

function initializeMockUsers() {
  if (typeof window === 'undefined') return

  const existing = localStorage.getItem(USERS_KEY)
  if (!existing) {
    const demoUser: StoredUser = {
      id: '1',
      email: 'demo@example.com',
      name: 'Demo User',
      ph: obscure('password123'),
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem(USERS_KEY, JSON.stringify([demoUser]))
  }
}

if (typeof window !== 'undefined' && isMockAuthActive) {
  initializeMockUsers()
}

function getUsers(): StoredUser[] {
  if (typeof window === 'undefined') return []
  const usersJson = localStorage.getItem(USERS_KEY)
  return usersJson ? JSON.parse(usersJson) : []
}

function saveUsers(users: StoredUser[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function getStoredSession(): Session | null {
  if (typeof window === 'undefined') return null
  const sessionJson = localStorage.getItem(SESSION_KEY)
  if (!sessionJson) return null
  const session = JSON.parse(sessionJson) as Session
  if (session.expiresAt < Date.now()) {
    localStorage.removeItem(SESSION_KEY)
    return null
  }
  return session
}

function saveSession(session: Session) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function clearSession() {
  if (typeof window !== 'undefined') localStorage.removeItem(SESSION_KEY)
}

function toSafeUser(u: StoredUser): SafeUser {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt }
}

export const mockAuth = {
  signUp: {
    email: async (params: {
      email: string
      password: string
      name?: string
    }): Promise<{ user: SafeUser }> => {
      await new Promise(resolve => setTimeout(resolve, 500))

      const users = getUsers()

      if (users.some(u => u.email === params.email)) {
        throw new Error('User with this email already exists')
      }

      const newUser: StoredUser = {
        id: Date.now().toString(),
        email: params.email,
        name: params.name,
        ph: obscure(params.password),
        createdAt: new Date().toISOString(),
      }

      users.push(newUser)
      saveUsers(users)

      const session: Session = {
        token: `mock_${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0]}`,
        userId: newUser.id,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
      saveSession(session)

      return { user: toSafeUser(newUser) }
    },
  },

  signIn: {
    email: async (params: { email: string; password: string }): Promise<{ user: SafeUser }> => {
      await new Promise(resolve => setTimeout(resolve, 500))

      const users = getUsers()
      const user = users.find(
        u => u.email === params.email && verifyPassword(params.password, u.ph)
      )

      if (!user) {
        throw new Error('Invalid email or password')
      }

      const session: Session = {
        token: `mock_${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0]}`,
        userId: user.id,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
      saveSession(session)

      return { user: toSafeUser(user) }
    },
  },

  signOut: async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 200))
    clearSession()
  },

  getSession: async (): Promise<AuthSessionData | null> => {
    await new Promise(resolve => setTimeout(resolve, 100))

    const session = getStoredSession()
    if (!session) return null

    const users = getUsers()
    const user = users.find(u => u.id === session.userId)

    if (!user) {
      clearSession()
      return null
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: mockRoles(),
        permissions: mockPermissions(),
      },
      session: {
        token: session.token,
        expiresAt: session.expiresAt,
      },
    }
  },
}
