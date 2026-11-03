/**
 * Centralized API Error Handler
 *
 * Provides consistent error handling across the application.
 * Handles different error types (network, API, validation) uniformly.
 *
 * Usage:
 * ```typescript
 * try {
 *   await apiCall()
 * } catch (error) {
 *   handleApiError(error)
 * }
 * ```
 */

import { toast } from '@/shared/lib/toast'

/**
 * Custom API Error class
 *
 * Extends Error with additional properties for API errors.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError)
    }
  }
}

/**
 * Network error class for connection issues
 */
export class NetworkError extends Error {
  constructor(message: string = 'Network connection failed') {
    super(message)
    this.name = 'NetworkError'

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NetworkError)
    }
  }
}

/**
 * Validation error class for form/input validation
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: Record<string, string[]>
  ) {
    super(message)
    this.name = 'ValidationError'

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError)
    }
  }
}

/**
 * Error response shape from API
 */
interface ErrorResponse {
  message?: string
  error?: string
  errors?: Record<string, string[]>
  code?: string
  statusCode?: number
}

/**
 * Handle API errors with consistent behavior
 *
 * @param error - Error object (unknown type)
 * @param options - Configuration options
 * @throws The original error after handling
 *
 * @example
 * ```typescript
 * try {
 *   await httpClient.post('/api/users', data)
 * } catch (error) {
 *   handleApiError(error)
 * }
 * ```
 */
export interface ErrorHandlerOptions {
  showToast?: boolean
  onUnauthorized?: (error: ApiError) => void
  onForbidden?: (error: ApiError) => void
  customHandlers?: Record<number, (error: ApiError) => void>
}

/**
 * Surface an error to the user (toast) and run optional status callbacks.
 *
 * Display-only: it never throws and never redirects. Auth flows (401 → token
 * refresh / login redirect) are owned by the HTTP client (`http-client.ts`),
 * so this stays a pure presentation concern that can be wired into a global
 * TanStack Query error handler without side effects.
 */
export function toastApiError(error: unknown, options: ErrorHandlerOptions = {}): void {
  const { showToast = true, onUnauthorized, onForbidden, customHandlers = {} } = options

  // Handle ApiError instances
  if (error instanceof ApiError) {
    if (customHandlers[error.statusCode]) {
      customHandlers[error.statusCode]!(error)
      return
    }

    switch (error.statusCode) {
      case 400:
        if (showToast) toast.error('Invalid Request', error.message || 'Please check your input')
        break

      case 401:
        if (showToast) toast.error('Authentication Required', 'Please sign in to continue')
        onUnauthorized?.(error)
        break

      case 403:
        if (showToast) {
          toast.error('Access Denied', "You don't have permission to perform this action")
        }
        onForbidden?.(error)
        break

      case 404:
        if (showToast) {
          toast.error('Not Found', error.message || 'The requested resource was not found')
        }
        break

      case 409:
        if (showToast) toast.error('Conflict', error.message || 'This resource already exists')
        break

      case 422:
        if (showToast) toast.error('Validation Error', error.message || 'Please check your input')
        break

      case 429:
        if (showToast) toast.error('Too Many Requests', 'Please slow down and try again later')
        break

      case 500:
      case 502:
      case 503:
      case 504:
        if (showToast) {
          toast.error(
            'Server Error',
            error.message || 'Something went wrong on our end. Please try again later.'
          )
        }
        break

      default:
        if (showToast) toast.error('Error', error.message || 'An unexpected error occurred')
    }
    return
  }

  // Handle ValidationError
  if (error instanceof ValidationError) {
    if (showToast) {
      const firstError = Object.values(error.errors)[0]?.[0]
      toast.error('Validation Error', firstError || error.message)
    }
    return
  }

  // Handle NetworkError
  if (error instanceof NetworkError) {
    if (showToast) {
      toast.error('Network Error', 'Please check your internet connection and try again')
    }
    return
  }

  // Handle standard Error
  if (error instanceof Error) {
    if (showToast) toast.error('Error', error.message || 'An unexpected error occurred')
    return
  }

  // Handle unknown error types
  if (showToast) toast.error('Unknown Error', 'An unexpected error occurred')
}

/**
 * Handle an error (toast + callbacks) and rethrow it for upstream control flow.
 *
 * Prefer {@link toastApiError} when you only need to surface the error (e.g. in
 * a global query error handler). Use this in imperative try/catch blocks where
 * you want the error to propagate after handling.
 *
 * @throws The original error after handling.
 */
export function handleApiError(error: unknown, options: ErrorHandlerOptions = {}): never {
  toastApiError(error, options)
  if (error instanceof Error) throw error
  throw new Error('Unknown error occurred')
}

/**
 * Create ApiError from fetch Response
 *
 * @param response - Fetch Response object
 * @returns ApiError instance
 */
export async function createApiErrorFromResponse(response: Response): Promise<ApiError> {
  let errorData: ErrorResponse = {}
  let message = `Request failed with status ${response.status}`

  try {
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      errorData = await response.json()
      message = errorData.message || errorData.error || message
    } else {
      message = response.statusText || message
    }
  } catch {
    // If response parsing fails, use status text
    message = response.statusText || message
  }

  return new ApiError(message, response.status, errorData.code, errorData)
}

/**
 * Check if error is ApiError with specific status code
 *
 * @param error - Error to check
 * @param statusCode - Expected status code
 * @returns True if error matches
 *
 * @example
 * ```typescript
 * if (isApiErrorWithStatus(error, 404)) {
 *   console.log('Resource not found')
 * }
 * ```
 */
export function isApiErrorWithStatus(error: unknown, statusCode: number): error is ApiError {
  return error instanceof ApiError && error.statusCode === statusCode
}

/**
 * Check if error is network-related
 *
 * @param error - Error to check
 * @returns True if network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return (
    error instanceof NetworkError ||
    (error instanceof Error && error.name === 'NetworkError') ||
    (error instanceof Error && error.message.includes('Failed to fetch'))
  )
}

/**
 * Check if error is validation-related
 *
 * @param error - Error to check
 * @returns True if validation error
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError || (error instanceof ApiError && error.statusCode === 422)
}

/**
 * Extract error message from unknown error type
 *
 * @param error - Error of any type
 * @returns Readable error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unexpected error occurred'
}

/**
 * Log error to monitoring service (Sentry, etc.)
 *
 * @param error - Error to log
 * @param context - Additional context
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  // This will be picked up by the monitoring system (Sentry)
  console.error('Error occurred:', error, context)

  // If Sentry is configured, it will capture this automatically
  // You can also manually capture: Sentry.captureException(error, { extra: context })
}
