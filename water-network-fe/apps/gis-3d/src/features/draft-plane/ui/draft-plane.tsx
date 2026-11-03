import { createEffect } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import type { FeatureCollection } from 'geojson';
import { draftFeaturesQueryOptions } from '@/entities/draft-feature';
import { useMapRuntimeContext } from '@/shared/lib/map-runtime';

/** Headless: pushes draft features (server state) onto the map's 'draft' layer. */
export function DraftPlane(props: { snapshotId: string }) {
  const { port } = useMapRuntimeContext();
  const draft = useQuery(() => draftFeaturesQueryOptions(props.snapshotId));

  createEffect(() => {
    const p = port();
    const data = draft.data;
    if (p && data) p.setFeatures('draft', data as unknown as FeatureCollection);
  });

  return null;
}
