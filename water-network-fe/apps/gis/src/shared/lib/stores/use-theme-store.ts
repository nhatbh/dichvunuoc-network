/**
 * Theme store — Solid edition with localStorage persistence.
 *
 * Replaces the Zustand+persist baseline. `theme` is a reactive accessor; the
 * `setTheme` / `toggleTheme` calls write through to localStorage immediately.
 */

import { createEffect, createSignal, type Accessor } from 'solid-js'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme-storage'

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return 'system'
    const parsed = JSON.parse(raw) as { state?: { theme?: Theme }; theme?: Theme }
    return parsed?.state?.theme ?? parsed?.theme ?? 'system'
  } catch {
    return 'system'
  }
}

const [theme, setThemeRaw] = createSignal<Theme>(readInitial())

if (typeof window !== 'undefined') {
  createEffect(() => {
    const value = theme()
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { theme: value } }))
    } catch {
      /* ignore quota errors */
    }
  })
}

function setTheme(next: Theme) {
  setThemeRaw(next)
}

function toggleTheme() {
  setThemeRaw(prev => (prev === 'light' ? 'dark' : 'light'))
}

export function useThemeStore(): {
  theme: Accessor<Theme>
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
} {
  return { theme, setTheme, toggleTheme }
}
