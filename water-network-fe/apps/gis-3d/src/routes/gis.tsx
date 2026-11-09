import { createFileRoute } from '@tanstack/solid-router'
import { GisRuntimePage } from '@/pages/gis/gis-runtime-page'
import { authGuard } from '@/shared/lib/route-guards'

export const Route = createFileRoute('/gis')({
  beforeLoad: async () => {
    await authGuard()
  },
  component: GisRuntimePage,
})
