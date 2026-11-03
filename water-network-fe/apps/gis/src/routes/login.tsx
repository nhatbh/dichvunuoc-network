import { createFileRoute, lazyRouteComponent } from '@tanstack/solid-router'
import { z } from 'zod'

const loginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  component: lazyRouteComponent(() => import('@/pages/auth/login'), 'LoginPage'),
})
