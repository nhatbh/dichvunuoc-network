import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/solid-router';
import { FEATURE_FLAGS, getFeatureFlag } from '@/shared/lib/feature-flags';
import { authGuard } from '@/shared/lib/route-guards';

export const Route = createFileRoute('/gis_/editor')({
  beforeLoad: async () => {
    await authGuard();
    if (!getFeatureFlag(FEATURE_FLAGS.NEW_EDITOR)) {
      throw redirect({ to: '/gis' });
    }
  },
  component: lazyRouteComponent(() => import('@/pages/gis/editor'), 'GisEditorPage'),
});
