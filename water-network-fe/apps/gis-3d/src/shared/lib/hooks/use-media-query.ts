/**
 * Media query accessors for Solid, backed by `@solid-primitives/media`.
 *
 * Note: returns reactive **accessors**, not raw booleans. Consumers should call
 * the function in JSX (e.g. `<Show when={isMobile()}>...</Show>`).
 */

import { createMediaQuery } from '@solid-primitives/media'
import { createMemo, type Accessor } from 'solid-js'

export function useMediaQuery(query: string): Accessor<boolean> {
  return createMediaQuery(query)
}

export function useIsMobile(): Accessor<boolean> {
  return useMediaQuery('(max-width: 768px)')
}

export function useIsTablet(): Accessor<boolean> {
  return useMediaQuery('(max-width: 1024px)')
}

export function useIsDesktop(): Accessor<boolean> {
  return useMediaQuery('(min-width: 1025px)')
}

export function useBreakpoint(): Accessor<'mobile' | 'tablet' | 'desktop'> {
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  return createMemo(() => {
    if (isMobile()) return 'mobile'
    if (isTablet()) return 'tablet'
    return 'desktop'
  })
}

export function usePrefersReducedMotion(): Accessor<boolean> {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

export function usePrefersDarkMode(): Accessor<boolean> {
  return useMediaQuery('(prefers-color-scheme: dark)')
}
