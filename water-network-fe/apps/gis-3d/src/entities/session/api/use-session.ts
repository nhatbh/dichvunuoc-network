/**
 * Session hook (Solid).
 *
 * Returns reactive accessors so callers can use them in JSX without forcing
 * a re-evaluation. The shape mirrors the previous TanStack Query-style
 * fields (`data`, `isLoading`, `isPending`, ...) to ease consumer migration.
 */

import { createMemo, type Accessor } from 'solid-js'
import { useSessionContext } from '@/entities/session/ui/session-provider'
import type { AuthSessionData } from '@/shared/lib/client-auth'

export interface SessionQueryLike {
  data: Accessor<AuthSessionData | null>
  isLoading: Accessor<boolean>
  error: Accessor<Error | null>
  isPending: Accessor<boolean>
  isError: Accessor<boolean>
  isSuccess: Accessor<boolean>
}

export function useSession(): SessionQueryLike {
  const ctx = useSessionContext()
  return {
    data: ctx.session,
    isLoading: ctx.isLoading,
    error: ctx.error,
    isPending: ctx.isLoading,
    isError: createMemo(() => !!ctx.error()),
    isSuccess: createMemo(() => !ctx.isLoading() && !ctx.error()),
  }
}
