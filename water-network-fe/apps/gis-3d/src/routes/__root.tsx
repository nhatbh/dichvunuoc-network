import { Outlet, createRootRoute } from '@tanstack/solid-router'
import { Suspense } from 'solid-js'
import { Spinner } from '@/shared/ui/spinner'

function RootComponent() {
  return (
    <Suspense
      fallback={
        <div class="flex items-center justify-center min-h-screen">
          <Spinner />
        </div>
      }
    >
      <Outlet />
    </Suspense>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
