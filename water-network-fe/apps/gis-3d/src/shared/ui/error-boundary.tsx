/**
 * Solid ErrorBoundary wrapper.
 *
 * Uses Solid's native `<ErrorBoundary>` and forwards errors to Sentry via
 * the shared monitoring layer.
 */

import { ErrorBoundary as SolidErrorBoundary, type JSX } from 'solid-js'
import { captureException } from '@/shared/lib/monitoring'

interface ErrorBoundaryProps {
  children: JSX.Element
  fallback?: (error: Error, reset: () => void) => JSX.Element
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <SolidErrorBoundary
      fallback={(error: Error, reset: () => void) => {
        void captureException(error, { component: 'ErrorBoundary' })
        if (props.fallback) return props.fallback(error, reset)
        return (
          <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div class="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
              <div class="text-center">
                <div class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
                  <svg
                    class="h-6 w-6 text-red-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h2 class="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h2>
                <p class="text-gray-600 mb-6">
                  We're sorry, but something unexpected happened. Please try again or refresh the
                  page.
                </p>
                {import.meta.env.MODE === 'development' && (
                  <div class="mb-6 p-4 bg-red-50 rounded border border-red-200">
                    <p class="text-sm font-mono text-red-800 break-all">{String(error)}</p>
                  </div>
                )}
                <div class="flex gap-4 justify-center">
                  <button
                    type="button"
                    onClick={reset}
                    class="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    class="rounded-md bg-secondary px-4 py-2 text-secondary-foreground hover:bg-secondary/80"
                  >
                    Refresh Page
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  )
}
