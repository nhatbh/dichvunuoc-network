import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/shared/lib/toast'
import {
  ApiError,
  createApiErrorFromResponse,
  getErrorMessage,
  handleApiError,
  isApiErrorWithStatus,
  isNetworkError,
  isValidationError,
  NetworkError,
  toastApiError,
  ValidationError,
} from './error-handler'

// `vi.mock` is hoisted above the imports above, so `toast` resolves to this stub.
vi.mock('@/shared/lib/toast', () => ({
  toast: { error: vi.fn() },
}))

const toastError = vi.mocked(toast.error)

describe('toastApiError', () => {
  beforeEach(() => {
    toastError.mockClear()
  })

  it('does not throw for any error type', () => {
    expect(() => toastApiError(new ApiError('boom', 500))).not.toThrow()
    expect(() => toastApiError('plain string')).not.toThrow()
    expect(() => toastApiError(undefined)).not.toThrow()
  })

  it('surfaces a 404 ApiError with a Not Found toast', () => {
    toastApiError(new ApiError('Missing', 404))
    expect(toastError).toHaveBeenCalledWith('Not Found', 'Missing')
  })

  it('runs onUnauthorized for 401 but never redirects itself', () => {
    const onUnauthorized = vi.fn()
    toastApiError(new ApiError('nope', 401), { onUnauthorized })
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(toastError).toHaveBeenCalledWith('Authentication Required', 'Please sign in to continue')
  })

  it('runs onForbidden for 403', () => {
    const onForbidden = vi.fn()
    toastApiError(new ApiError('denied', 403), { onForbidden })
    expect(onForbidden).toHaveBeenCalledOnce()
  })

  it('routes 5xx to a Server Error toast', () => {
    toastApiError(new ApiError('down', 503))
    expect(toastError).toHaveBeenCalledWith('Server Error', 'down')
  })

  it('respects showToast: false', () => {
    toastApiError(new ApiError('quiet', 500), { showToast: false })
    expect(toastError).not.toHaveBeenCalled()
  })

  it('prefers a custom handler over the default switch', () => {
    const custom = vi.fn()
    toastApiError(new ApiError('teapot', 418), { customHandlers: { 418: custom } })
    expect(custom).toHaveBeenCalledOnce()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows the first field error for a ValidationError', () => {
    toastApiError(new ValidationError('invalid', { email: ['Email is required'] }))
    expect(toastError).toHaveBeenCalledWith('Validation Error', 'Email is required')
  })
})

describe('handleApiError', () => {
  beforeEach(() => toastError.mockClear())

  it('rethrows the original error after handling', () => {
    const err = new ApiError('boom', 500)
    expect(() => handleApiError(err, { showToast: false })).toThrow(err)
  })

  it('throws a generic Error for non-Error inputs', () => {
    expect(() => handleApiError('weird', { showToast: false })).toThrow('Unknown error occurred')
  })
})

describe('createApiErrorFromResponse', () => {
  it('extracts message and status from a JSON error body', async () => {
    const response = new Response(JSON.stringify({ message: 'Bad input', code: 'E_BAD' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
    const error = await createApiErrorFromResponse(response)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(400)
    expect(error.message).toBe('Bad input')
    expect(error.code).toBe('E_BAD')
  })

  it('falls back to status text for non-JSON responses', async () => {
    const response = new Response('nope', { status: 500, statusText: 'Server Error' })
    const error = await createApiErrorFromResponse(response)
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('Server Error')
  })
})

describe('error type guards', () => {
  it('isApiErrorWithStatus matches status code', () => {
    expect(isApiErrorWithStatus(new ApiError('x', 404), 404)).toBe(true)
    expect(isApiErrorWithStatus(new ApiError('x', 500), 404)).toBe(false)
    expect(isApiErrorWithStatus(new Error('x'), 404)).toBe(false)
  })

  it('isNetworkError recognizes fetch failures', () => {
    expect(isNetworkError(new NetworkError())).toBe(true)
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new ApiError('x', 500))).toBe(false)
  })

  it('isValidationError recognizes 422 ApiError', () => {
    expect(isValidationError(new ApiError('x', 422))).toBe(true)
    expect(isValidationError(new ValidationError('x', {}))).toBe(true)
    expect(isValidationError(new ApiError('x', 400))).toBe(false)
  })

  it('getErrorMessage extracts readable text', () => {
    expect(getErrorMessage(new ApiError('api', 500))).toBe('api')
    expect(getErrorMessage(new Error('std'))).toBe('std')
    expect(getErrorMessage('string error')).toBe('string error')
    expect(getErrorMessage(null)).toBe('An unexpected error occurred')
  })
})
