/**
 * HTTP Client Wrapper
 *
 * Centralized HTTP client. Resolves auth headers, enforces a request timeout,
 * and normalizes failures into {@link ApiError} (carrying the HTTP status) so
 * callers and the global query error handler can branch on `statusCode`.
 * FSD Rule: This is in the Shared layer, accessible to all layers.
 *
 * - keycloak / mock: Bearer token via Authorization header
 * - backend-session: cookie session (credentials: 'include'), no Bearer
 *
 * This layer does NOT show toasts — presentation is owned by the global
 * TanStack Query error handler (see `app/providers/query-provider.tsx`). It
 * DOES own the auth side-effect: a 401 triggers a token refresh + retry, then
 * a login redirect if that fails.
 */

import { isBackendSessionMode, usesBearerAuth } from '@/shared/config/auth-mode'
import { env } from '@/shared/config/env'
import { getAuthToken } from '@/shared/lib/auth-token'
import { authClient } from '@/shared/lib/client-auth'
import { ApiError, createApiErrorFromResponse } from './error-handler'

export interface HttpClientConfig {
  baseURL?: string
  timeout?: number
  headers?: Record<string, string>
}

export interface RequestConfig extends RequestInit {
  /** Skip attaching the Authorization header (e.g. public endpoints). */
  skipAuth?: boolean
}

class HttpClient {
  /** When undefined, resolves `env.VITE_API_URL` on each request (runtime config). */
  private baseURLOverride: string | undefined
  private defaultHeaders: Record<string, string>
  private timeout: number

  constructor(config: HttpClientConfig = {}) {
    this.baseURLOverride = config.baseURL
    this.timeout = config.timeout || env.VITE_API_TIMEOUT
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...config.headers,
    }
  }

  private fetchCredentials(): RequestCredentials {
    return isBackendSessionMode() ? 'include' : 'same-origin'
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw await createApiErrorFromResponse(response)
    }

    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      return {} as T
    }

    return response.json()
  }

  private resolveBaseURL(): string {
    return this.baseURLOverride ?? env.VITE_API_URL
  }

  private async request<T>(url: string, config: RequestConfig = {}): Promise<T> {
    const { skipAuth = false, headers = {}, ...fetchConfig } = config

    const fullUrl = url.startsWith('http') ? url : `${this.resolveBaseURL()}${url}`

    const send = async (): Promise<Response> => {
      const requestHeaders: HeadersInit = {
        ...this.defaultHeaders,
        ...(headers as Record<string, string>),
      }

      if (!skipAuth && usesBearerAuth()) {
        const token = await getAuthToken()
        if (token && token !== 'session-cookie') {
          requestHeaders['Authorization'] = `Bearer ${token}`
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)

      try {
        const response = await fetch(fullUrl, {
          ...fetchConfig,
          headers: requestHeaders,
          credentials: this.fetchCredentials(),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        return response
      } catch (e) {
        clearTimeout(timeoutId)
        throw e
      }
    }

    try {
      let response = await send()

      if (response.status === 401 && !skipAuth) {
        if (isBackendSessionMode()) {
          this.redirectToLogin()
          throw new ApiError('Session expired. Please sign in again.', 401)
        }

        const refreshed = await authClient.updateToken(30)
        if (refreshed) {
          response = await send()
        } else {
          this.redirectToLogin()
          throw new ApiError('Session expired. Please sign in again.', 401)
        }
      }

      return await this.handleResponse<T>(response)
    } catch (error) {
      // Normalize an aborted (timed-out) request into a 408 ApiError.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError('Request timeout', 408, 'TIMEOUT')
      }
      throw error
    }
  }

  /** Redirect to the login page, preserving the current path for return. */
  private redirectToLogin(): void {
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/login')) return
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`
  }

  async get<T>(url: string, config?: RequestConfig): Promise<T> {
    return this.request<T>(url, { ...config, method: 'GET' })
  }

  async post<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>(url, {
      ...config,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>(url, {
      ...config,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async patch<T>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>(url, {
      ...config,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete<T>(url: string, config?: RequestConfig): Promise<T> {
    return this.request<T>(url, { ...config, method: 'DELETE' })
  }
}

/**
 * Default client — points at the gateway / primary microservice.
 *
 * Intentionally created WITHOUT a `baseURL` so each request resolves
 * `env.VITE_API_URL` live (see getBaseURL). This lets runtime config
 * (/config.json → applyRuntimeConfig, which runs in bootstrap() AFTER this
 * module is imported) override the baked build-time value. Passing
 * `baseURL: env.VITE_API_URL` here would snapshot the stale build-time URL and
 * silently defeat the runtime override.
 */
export const httpClient = new HttpClient({})

/**
 * Factory for additional bounded-context clients (multi-microservice FE).
 *
 * @example
 * export const catalogClient = createHttpClient({ baseURL: env.VITE_CATALOG_API_URL })
 */
export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  return new HttpClient(config)
}

/** Optional secondary service client when `VITE_SECONDARY_API_URL` is set. */
export const secondaryHttpClient = env.VITE_SECONDARY_API_URL
  ? createHttpClient({ baseURL: env.VITE_SECONDARY_API_URL })
  : null
