/**
 * API Response Transformers
 *
 * Utilities for transforming API responses into consistent formats.
 * Handles date parsing, null/undefined normalization, and data unwrapping.
 *
 * Usage:
 * ```typescript
 * const response = await httpClient.get('/api/user')
 * const user = transformResponse(response)
 * ```
 */

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data: T
  status: number
  message?: string
  meta?: {
    page?: number
    perPage?: number
    total?: number
    [key: string]: unknown
  }
}

/**
 * Paginated API response
 */
export interface PaginatedResponse<T> {
  items: T[]
  page: number
  perPage: number
  total: number
  totalPages: number
  hasMore: boolean
}

/**
 * Check if value is a valid ISO date string
 */
function isIsoDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false

  // Match ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/
  return isoDateRegex.test(value)
}

/**
 * Recursively transform ISO date strings to Date objects
 *
 * @param data - Data to transform
 * @returns Transformed data with Date objects
 *
 * @example
 * ```typescript
 * const data = { createdAt: '2024-01-01T00:00:00.000Z' }
 * const transformed = transformDates(data)
 * // { createdAt: Date object }
 * ```
 */
export function transformDates<T>(data: T): T {
  if (data === null || data === undefined) {
    return data
  }

  if (typeof data === 'string' && isIsoDateString(data)) {
    return new Date(data) as T
  }

  if (Array.isArray(data)) {
    return data.map(item => transformDates(item)) as T
  }

  if (typeof data === 'object' && data !== null) {
    const transformed: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      transformed[key] = transformDates(value)
    }

    return transformed as T
  }

  return data
}

/**
 * Replace null values with undefined (TypeScript prefers undefined)
 *
 * @param data - Data to transform
 * @returns Transformed data with undefined instead of null
 *
 * @example
 * ```typescript
 * const data = { name: 'John', age: null }
 * const transformed = transformNulls(data)
 * // { name: 'John', age: undefined }
 * ```
 */
export function transformNulls<T>(data: T): T {
  if (data === null) {
    return undefined as T
  }

  if (Array.isArray(data)) {
    return data.map(item => transformNulls(item)) as T
  }

  if (typeof data === 'object' && data !== null) {
    const transformed: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      transformed[key] = transformNulls(value)
    }

    return transformed as T
  }

  return data
}

/**
 * Unwrap API response and extract data
 *
 * @param response - API response wrapper
 * @returns Extracted data
 *
 * @example
 * ```typescript
 * const response = { data: { id: 1, name: 'John' }, status: 200 }
 * const user = unwrapResponse(response)
 * // { id: 1, name: 'John' }
 * ```
 */
export function unwrapResponse<T>(response: ApiResponse<T>): T {
  if (!response || typeof response !== 'object') {
    throw new Error('Invalid API response format')
  }

  if (!('data' in response)) {
    throw new Error('API response missing data property')
  }

  return response.data
}

/**
 * Transform complete API response (unwrap, dates, nulls)
 *
 * @param response - API response
 * @returns Transformed data
 *
 * @example
 * ```typescript
 * const response = await httpClient.get('/api/user')
 * const user = transformResponse(response)
 * ```
 */
export function transformResponse<T>(response: ApiResponse<T> | T): T {
  let data: T

  // Check if response is wrapped
  if (response && typeof response === 'object' && 'data' in response) {
    data = unwrapResponse(response as ApiResponse<T>)
  } else {
    data = response as T
  }

  // Apply transformations
  data = transformDates(data)
  data = transformNulls(data)

  return data
}

/**
 * Transform paginated response
 *
 * @param response - Paginated API response
 * @returns Transformed paginated data
 */
export function transformPaginatedResponse<T>(
  response: ApiResponse<PaginatedResponse<T>>
): PaginatedResponse<T> {
  const data = unwrapResponse(response)

  // Transform items
  const items = data.items.map(item => transformDates(transformNulls(item)))

  return {
    ...data,
    items,
    hasMore: data.page < data.totalPages,
  }
}

/**
 * Safely parse JSON with error handling
 *
 * @param json - JSON string
 * @returns Parsed object or null
 */
export function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * Convert snake_case keys to camelCase
 *
 * @param data - Data with snake_case keys
 * @returns Data with camelCase keys
 *
 * @example
 * ```typescript
 * const data = { user_name: 'John', created_at: '2024-01-01' }
 * const camel = snakeToCamel(data)
 * // { userName: 'John', createdAt: '2024-01-01' }
 * ```
 */
export function snakeToCamel<T>(data: T): T {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map(item => snakeToCamel(item)) as T
  }

  if (typeof data === 'object' && data !== null) {
    const transformed: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      transformed[camelKey] = snakeToCamel(value)
    }

    return transformed as T
  }

  return data
}

/**
 * Convert camelCase keys to snake_case
 *
 * @param data - Data with camelCase keys
 * @returns Data with snake_case keys
 */
export function camelToSnake<T>(data: T): T {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map(item => camelToSnake(item)) as T
  }

  if (typeof data === 'object' && data !== null) {
    const transformed: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
      transformed[snakeKey] = camelToSnake(value)
    }

    return transformed as T
  }

  return data
}

/**
 * Remove empty values (null, undefined, empty string, empty array)
 *
 * @param data - Data to clean
 * @returns Data without empty values
 */
export function removeEmptyValues<T extends Record<string, unknown>>(data: T): Partial<T> {
  const cleaned: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === '') {
      continue
    }

    if (Array.isArray(value) && value.length === 0) {
      continue
    }

    cleaned[key] = value
  }

  return cleaned as Partial<T>
}

/**
 * Flatten nested object (one level deep)
 *
 * @param data - Nested object
 * @returns Flattened object
 *
 * @example
 * ```typescript
 * const data = { user: { name: 'John', age: 30 } }
 * const flat = flattenObject(data)
 * // { 'user.name': 'John', 'user.age': 30 }
 * ```
 */
export function flattenObject(data: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const flattened: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    const newKey = prefix ? `${prefix}.${key}` : key

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(flattened, flattenObject(value as Record<string, unknown>, newKey))
    } else {
      flattened[newKey] = value
    }
  }

  return flattened
}
