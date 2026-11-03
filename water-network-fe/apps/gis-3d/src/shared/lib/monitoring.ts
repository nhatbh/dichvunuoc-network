/**
 * Error Monitoring & Tracking
 *
 * Centralized error monitoring that integrates with Sentry in production.
 * Falls back to logger in development.
 *
 * FSD Rule: This is in the Shared layer, accessible to all layers.
 */

import { logger } from './logger'

// Type definition for error context
export interface ErrorContext {
  [key: string]: unknown
  userId?: string
  url?: string
  component?: string
  action?: string
}

/**
 * Initialize error monitoring
 * Call this once in your app initialization
 */
export async function initMonitoring(): Promise<void> {
  // Only initialize in production
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    try {
      // Dynamic import to avoid loading Sentry in development
      const Sentry = await import('@sentry/solid')

      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',

        // Set tracesSampleRate to 1.0 to capture 100% of transactions
        // In production, lower this value to reduce costs
        tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE
          ? parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE)
          : 0.1,

        // Capture unhandled promise rejections
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({
            maskAllText: true,
            blockAllMedia: true,
          }),
        ],

        // Session Replay sample rate
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,

        // Filter out known non-critical errors
        beforeSend(event, hint) {
          // Filter out cancelled requests
          if (hint.originalException instanceof Error) {
            if (
              hint.originalException.name === 'AbortError' ||
              hint.originalException.message.includes('cancelled')
            ) {
              return null
            }
          }
          return event
        },
      })

      logger.info('Sentry monitoring initialized')
    } catch (error) {
      logger.error('Failed to initialize Sentry:', error)
    }
  } else {
    logger.info('Sentry monitoring disabled (development mode or VITE_SENTRY_ENABLED=false)')
  }
}

/**
 * Capture an exception and send it to monitoring service
 * @param error - The error to capture
 * @param context - Additional context about the error
 */
export async function captureException(
  error: Error | unknown,
  context?: ErrorContext
): Promise<void> {
  // Always log to console in development
  logger.error('Exception captured:', error, context)

  // Send to Sentry in production
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    try {
      const Sentry = await import('@sentry/solid')

      if (context) {
        Sentry.setContext('additional_info', context)
      }

      if (error instanceof Error) {
        Sentry.captureException(error)
      } else {
        Sentry.captureException(new Error(String(error)))
      }
    } catch (e) {
      logger.error('Failed to capture exception in Sentry:', e)
    }
  }
}

/**
 * Capture a message (non-error event)
 * @param message - The message to capture
 * @param level - Severity level (info, warning, error)
 * @param context - Additional context
 */
export async function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: ErrorContext
): Promise<void> {
  // Log message based on level
  if (level === 'error') {
    logger.error('Message captured:', message, context)
  } else if (level === 'warning') {
    logger.warn('Message captured:', message, context)
  } else {
    logger.info('Message captured:', message, context)
  }

  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    try {
      const Sentry = await import('@sentry/solid')

      if (context) {
        Sentry.setContext('additional_info', context)
      }

      Sentry.captureMessage(message, level)
    } catch (e) {
      logger.error('Failed to capture message in Sentry:', e)
    }
  }
}

/**
 * Set user context for error tracking
 * @param user - User information
 */
export async function setUser(user: {
  id: string
  email?: string
  username?: string
}): Promise<void> {
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    try {
      const Sentry = await import('@sentry/solid')
      Sentry.setUser(user)
    } catch (e) {
      logger.error('Failed to set user in Sentry:', e)
    }
  }
}

/**
 * Clear user context (e.g., on logout)
 */
export async function clearUser(): Promise<void> {
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    try {
      const Sentry = await import('@sentry/solid')
      Sentry.setUser(null)
    } catch (e) {
      logger.error('Failed to clear user in Sentry:', e)
    }
  }
}

/**
 * Add breadcrumb for debugging context
 * @param message - Breadcrumb message
 * @param category - Breadcrumb category
 * @param level - Severity level
 */
export async function addBreadcrumb(
  message: string,
  category: string = 'custom',
  level: 'info' | 'warning' | 'error' = 'info'
): Promise<void> {
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    try {
      const Sentry = await import('@sentry/solid')
      Sentry.addBreadcrumb({
        message,
        category,
        level,
        timestamp: Date.now() / 1000,
      })
    } catch (e) {
      logger.error('Failed to add breadcrumb in Sentry:', e)
    }
  }
}

/**
 * Start a performance transaction
 * @param name - Transaction name
 * @param op - Operation type
 */
export async function startTransaction(name: string, op: string = 'custom'): Promise<unknown> {
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    try {
      const Sentry = await import('@sentry/solid')
      // Use startSpan instead of deprecated startTransaction
      return Sentry.startSpan({ name, op }, span => span)
    } catch (e) {
      logger.error('Failed to start transaction in Sentry:', e)
    }
  }

  // Return a no-op object in development
  return {
    finish: () => {},
    setStatus: () => {},
    setTag: () => {},
  }
}

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.token_refresh'
  | 'auth.session_expired'
  | 'auth.permission_denied'
  | 'auth.role_check'

export interface AuditEvent {
  type: AuditEventType
  userId?: string
  detail?: string
  metadata?: Record<string, unknown>
  timestamp: number
}

export async function logAuditEvent(
  type: AuditEventType,
  detail?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  logger.info(`[AUDIT] ${type}${detail ? `: ${detail}` : ''}`, metadata)

  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED === 'true') {
    await captureMessage(`[AUDIT] ${type}`, 'info', {
      action: type,
      detail,
      ...metadata,
    })
  }
}
