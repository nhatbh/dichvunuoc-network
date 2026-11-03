/**
 * Logger Utility
 *
 * Centralized logging utility that can be extended with external services
 * (e.g., Sentry, LogRocket) in production.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

class LoggerImpl implements Logger {
  private isDevelopment = import.meta.env.MODE === 'development'

  private log(level: LogLevel, ...args: unknown[]): void {
    if (!this.isDevelopment && level === 'debug') {
      return // Don't log debug messages in production
    }

    const timestamp = new Date().toISOString()
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`

    switch (level) {
      case 'debug':
        console.debug(prefix, ...args)
        break
      case 'info':
        console.info(prefix, ...args)
        break
      case 'warn':
        console.warn(prefix, ...args)
        break
      case 'error':
        console.error(prefix, ...args)
        // In production, you could send errors to an error tracking service
        // if (import.meta.env.PROD) {
        //   errorTrackingService.captureException(new Error(String(args[0])))
        // }
        break
    }
  }

  debug(...args: unknown[]): void {
    this.log('debug', ...args)
  }

  info(...args: unknown[]): void {
    this.log('info', ...args)
  }

  warn(...args: unknown[]): void {
    this.log('warn', ...args)
  }

  error(...args: unknown[]): void {
    this.log('error', ...args)
  }
}

// Export singleton instance
export const logger = new LoggerImpl()

// Export type for convenience
export type { Logger }
