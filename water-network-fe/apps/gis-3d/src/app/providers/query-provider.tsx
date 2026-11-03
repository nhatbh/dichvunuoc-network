/**
 * Query Provider (Solid).
 *
 * Wraps the app in TanStack Solid Query. `QueryClient` is created once at
 * module scope (acceptable because the app is SPA & singleton).
 *
 * Error presentation is centralized here: the HTTP client throws `ApiError`
 * (no toasts), and the query/mutation caches surface them via `toastApiError`.
 * Opt out per request with `meta: { skipErrorToast: true }`.
 */

import type { JSX } from 'solid-js'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { SolidQueryDevtools } from '@tanstack/solid-query-devtools'
import { toastApiError } from '@/shared/api/error-handler'

function shouldSkipToast(meta: Record<string, unknown> | undefined): boolean {
  return meta?.skipErrorToast === true
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      toastApiError(error, { showToast: !shouldSkipToast(query.meta) })
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      toastApiError(error, { showToast: !shouldSkipToast(mutation.meta) })
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 3,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 1 },
  },
})

export function QueryProvider(props: { children: JSX.Element }) {
  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
      {import.meta.env.MODE === 'development' && <SolidQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
