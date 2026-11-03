/**
 * Feature Flags — Solid edition.
 *
 * Replaces the Zustand+persist baseline. Backed by a single `createSignal`
 * over the flag map, with manual localStorage persistence in development.
 * Hooks return reactive accessors so consumers can call them in JSX.
 */

import { createMemo, createSignal, type Accessor, type JSX } from 'solid-js'
import { Show } from 'solid-js'

export const FEATURE_FLAGS = {
  NEW_DASHBOARD: 'newDashboard',
  DARK_MODE: 'darkMode',
  NEW_EDITOR: 'newEditor',
  BETA_FEATURES: 'betaFeatures',
  EXPERIMENTAL_API: 'experimentalApi',
  PAYMENTS_V2: 'paymentsV2',
  ADVANCED_ANALYTICS: 'advancedAnalytics',
  REAL_TIME_NOTIFICATIONS: 'realTimeNotifications',
  DEBUG_MODE: 'debugMode',
  MOCK_DATA: 'mockData',
  CANONICAL_VIEWER: 'canonicalViewer',
  PERFORMANCE_MONITORING: 'performanceMonitoring',
} as const

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS]

interface FeatureFlagConfig {
  enabled: boolean
  description?: string
  targetUsers?: string[]
  targetRoles?: string[]
  rolloutPercentage?: number
}

type FeatureFlags = Record<FeatureFlagKey, boolean | FeatureFlagConfig>

const defaultFlags: FeatureFlags = {
  [FEATURE_FLAGS.NEW_DASHBOARD]: false,
  [FEATURE_FLAGS.DARK_MODE]: true,
  [FEATURE_FLAGS.NEW_EDITOR]: false,
  [FEATURE_FLAGS.BETA_FEATURES]: false,
  [FEATURE_FLAGS.EXPERIMENTAL_API]: false,
  [FEATURE_FLAGS.PAYMENTS_V2]: false,
  [FEATURE_FLAGS.ADVANCED_ANALYTICS]: false,
  [FEATURE_FLAGS.REAL_TIME_NOTIFICATIONS]: false,
  [FEATURE_FLAGS.DEBUG_MODE]: import.meta.env.DEV,
  [FEATURE_FLAGS.MOCK_DATA]: import.meta.env.VITE_USE_MOCK_DATA === 'true',
  [FEATURE_FLAGS.CANONICAL_VIEWER]: false,
  [FEATURE_FLAGS.PERFORMANCE_MONITORING]:
    import.meta.env.VITE_ENABLE_PERFORMANCE_MONITORING === 'true',
}

function loadFlagsFromEnv(): Partial<FeatureFlags> {
  const envFlags: Partial<FeatureFlags> = {}
  if (import.meta.env.VITE_ENABLE_NEW_EDITOR === 'true') {
    envFlags[FEATURE_FLAGS.NEW_EDITOR] = true
  }
  if (import.meta.env.VITE_ENABLE_BETA_FEATURES === 'true') {
    envFlags[FEATURE_FLAGS.BETA_FEATURES] = true
  }
  if (import.meta.env.VITE_DEBUG_MODE === 'true') {
    envFlags[FEATURE_FLAGS.DEBUG_MODE] = true
  }
  return envFlags
}

const STORAGE_KEY = 'feature-flags-storage'

function readPersisted(): Partial<FeatureFlags> {
  if (typeof window === 'undefined' || import.meta.env.PROD) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return (parsed?.state?.flags ?? {}) as Partial<FeatureFlags>
  } catch {
    return {}
  }
}

const initialFlags: FeatureFlags = {
  ...defaultFlags,
  ...loadFlagsFromEnv(),
  ...readPersisted(),
}

const [flagsAccessor, setFlagsAccessor] = createSignal<FeatureFlags>(initialFlags)

function persist(next: FeatureFlags) {
  if (typeof window === 'undefined' || import.meta.env.PROD) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { flags: next } }))
  } catch {
    /* ignore quota */
  }
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = (hash << 5) - hash + ch
    hash |= 0
  }
  return Math.abs(hash)
}

function isFlagEnabled(
  flag: boolean | FeatureFlagConfig,
  userId?: string,
  userRole?: string
): boolean {
  if (typeof flag === 'boolean') return flag
  if (!flag.enabled) return false
  if (userId && flag.targetUsers && !flag.targetUsers.includes(userId)) return false
  if (userRole && flag.targetRoles && !flag.targetRoles.includes(userRole)) return false
  if (flag.rolloutPercentage !== undefined) {
    const bucket = userId ? hashString(userId) % 100 : Math.random() * 100
    return bucket < flag.rolloutPercentage
  }
  return true
}

export function useFeatureFlag(
  key: FeatureFlagKey,
  userId?: string,
  userRole?: string
): Accessor<boolean> {
  return createMemo(() => isFlagEnabled(flagsAccessor()[key], userId, userRole))
}

export function useFeatureFlags(
  keys: FeatureFlagKey[],
  userId?: string,
  userRole?: string
): Accessor<Record<string, boolean>> {
  return createMemo(() => {
    const map = flagsAccessor()
    return keys.reduce(
      (acc, key) => {
        acc[key] = isFlagEnabled(map[key], userId, userRole)
        return acc
      },
      {} as Record<string, boolean>
    )
  })
}

export function useAllFeatureFlags(): Accessor<FeatureFlags> {
  return flagsAccessor
}

export function useUpdateFeatureFlags() {
  return {
    setFlag: (key: FeatureFlagKey, value: boolean | FeatureFlagConfig) => {
      setFlagsAccessor(prev => {
        const next = { ...prev, [key]: value }
        persist(next)
        return next
      })
    },
    setFlags: (partial: Partial<FeatureFlags>) => {
      setFlagsAccessor(prev => {
        const next = { ...prev, ...partial }
        persist(next)
        return next
      })
    },
    resetFlags: () => {
      const next = { ...defaultFlags, ...loadFlagsFromEnv() }
      setFlagsAccessor(next)
      persist(next)
    },
  }
}

export function getFeatureFlag(
  key: FeatureFlagKey,
  userId?: string,
  userRole?: string
): boolean {
  return isFlagEnabled(flagsAccessor()[key], userId, userRole)
}

/**
 * Apply runtime flag overrides (e.g. from `config.json` at boot). Only keys that
 * are known flags are applied; unknown keys in the override map are ignored so a
 * stray entry in deploy config can never crash the app. Not persisted — runtime
 * config is authoritative on every boot.
 */
export function setFeatureFlags(overrides: Record<string, boolean | FeatureFlagConfig>): void {
  setFlagsAccessor(prev => {
    const next = { ...prev }
    for (const [key, value] of Object.entries(overrides)) {
      if (key in defaultFlags) {
        next[key as FeatureFlagKey] = value
      }
    }
    return next
  })
}

export async function loadRemoteFeatureFlags(url: string): Promise<void> {
  try {
    const response = await fetch(url)
    const remoteFlags = (await response.json()) as Partial<FeatureFlags>
    setFlagsAccessor(prev => {
      const next = { ...prev, ...remoteFlags }
      persist(next)
      return next
    })
  } catch (error) {
    console.error('Failed to load remote feature flags:', error)
  }
}

interface FeatureFlagProps {
  flag: FeatureFlagKey
  children: JSX.Element
  fallback?: JSX.Element
  userId?: string
  userRole?: string
}

export function FeatureFlag(props: FeatureFlagProps) {
  const isEnabled = useFeatureFlag(props.flag, props.userId, props.userRole)
  return (
    <Show when={isEnabled()} fallback={props.fallback ?? null}>
      {props.children}
    </Show>
  )
}
