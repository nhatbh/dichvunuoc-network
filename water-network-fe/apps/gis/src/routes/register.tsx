import { createFileRoute, lazyRouteComponent } from '@tanstack/solid-router'

export const Route = createFileRoute('/register')({
  component: lazyRouteComponent(() => import('@/pages/auth/register'), 'RegisterPage'),
})
