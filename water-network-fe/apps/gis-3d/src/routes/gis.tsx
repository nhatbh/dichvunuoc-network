import { createFileRoute, redirect } from '@tanstack/solid-router'
import { GisRuntimePage } from '@/pages/gis/gis-runtime-page'
import { isDesignEditorApi } from '@/shared/config/editor-api'
import { authGuard } from '@/shared/lib/route-guards'

export const Route = createFileRoute('/gis')({
  beforeLoad: async () => {
    await authGuard()
    // The current dev VPS serves the Design workflow, while its deployed GIS
    // image predates canonical /bootstrap and /map. Land local VPS mode in the
    // working editor instead of presenting a known 404 state.
    if (isDesignEditorApi() && window.location.hash !== '#import') {
      throw redirect({ to: '/gis/editor' })
    }
  },
  component: GisRuntimePage,
})
