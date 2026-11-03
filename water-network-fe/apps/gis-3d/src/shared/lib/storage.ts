/**
 * Type-safe Local Storage Wrapper
 *
 * Provides error handling, type safety, and consistent API for localStorage operations.
 * FSD Rule: This is in the Shared layer, accessible to all layers.
 */

/**
 * Storage wrapper with error handling and type safety
 */
export const storage = {
  /**
   * Get an item from localStorage
   * @param key - Storage key
   * @param defaultValue - Default value if key doesn't exist
   * @returns Parsed value or default value
   */
  get<T>(key: string, defaultValue?: T): T | null {
    try {
      const item = localStorage.getItem(key)
      if (item === null) {
        return defaultValue ?? null
      }
      return JSON.parse(item) as T
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error)
      return defaultValue ?? null
    }
  },

  /**
   * Set an item in localStorage
   * @param key - Storage key
   * @param value - Value to store (will be JSON stringified)
   */
  set<T>(key: string, value: T): void {
    try {
      const serialized = JSON.stringify(value)
      localStorage.setItem(key, serialized)
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error)

      // Check for quota exceeded error
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.error('localStorage quota exceeded. Consider clearing old data.')
      }
    }
  },

  /**
   * Remove an item from localStorage
   * @param key - Storage key to remove
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error)
    }
  },

  /**
   * Clear all items from localStorage
   */
  clear(): void {
    try {
      localStorage.clear()
    } catch (error) {
      console.error('Error clearing localStorage:', error)
    }
  },

  /**
   * Check if a key exists in localStorage
   * @param key - Storage key
   * @returns True if key exists
   */
  has(key: string): boolean {
    try {
      return localStorage.getItem(key) !== null
    } catch (error) {
      console.error(`Error checking localStorage key "${key}":`, error)
      return false
    }
  },

  /**
   * Get all keys from localStorage
   * @returns Array of all storage keys
   */
  keys(): string[] {
    try {
      return Object.keys(localStorage)
    } catch (error) {
      console.error('Error getting localStorage keys:', error)
      return []
    }
  },

  /**
   * Get localStorage size in bytes (approximate)
   * @returns Approximate size in bytes
   */
  getSize(): number {
    try {
      let size = 0
      for (const key in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
          const item = localStorage[key]
          if (item) {
            size += key.length + item.length
          }
        }
      }
      return size * 2 // UTF-16 encoding
    } catch (error) {
      console.error('Error calculating localStorage size:', error)
      return 0
    }
  },
}

/**
 * Session Storage wrapper (same API as storage)
 */
export const sessionStorage = {
  get<T>(key: string, defaultValue?: T): T | null {
    try {
      const item = window.sessionStorage.getItem(key)
      if (item === null) {
        return defaultValue ?? null
      }
      return JSON.parse(item) as T
    } catch (error) {
      console.error(`Error reading sessionStorage key "${key}":`, error)
      return defaultValue ?? null
    }
  },

  set<T>(key: string, value: T): void {
    try {
      const serialized = JSON.stringify(value)
      window.sessionStorage.setItem(key, serialized)
    } catch (error) {
      console.error(`Error setting sessionStorage key "${key}":`, error)
    }
  },

  remove(key: string): void {
    try {
      window.sessionStorage.removeItem(key)
    } catch (error) {
      console.error(`Error removing sessionStorage key "${key}":`, error)
    }
  },

  clear(): void {
    try {
      window.sessionStorage.clear()
    } catch (error) {
      console.error('Error clearing sessionStorage:', error)
    }
  },

  has(key: string): boolean {
    try {
      return window.sessionStorage.getItem(key) !== null
    } catch (error) {
      console.error(`Error checking sessionStorage key "${key}":`, error)
      return false
    }
  },
}

/**
 * Storage keys used throughout the application
 * Centralize storage keys to prevent typos and aid refactoring
 */
export const STORAGE_KEYS = {
  THEME: 'theme-storage',
  USER_PREFERENCES: 'user-preferences',
  AUTH_TOKEN: 'auth-token',
  DASHBOARD_STATS: 'dashboard_stats',
  // Add more keys as needed
} as const
