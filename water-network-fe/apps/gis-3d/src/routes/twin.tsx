import { createFileRoute } from '@tanstack/solid-router'
import { TwinPage } from '@/pages/twin/twin-page'
import { authGuard } from '@/shared/lib/route-guards'

export const Route = createFileRoute('/twin')({
  beforeLoad: async () => {
    await authGuard()
  },
  component: TwinPage,
})
