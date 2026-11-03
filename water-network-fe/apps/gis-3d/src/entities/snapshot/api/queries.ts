import { queryOptions } from '@tanstack/solid-query';
import { httpClient } from '@/shared/api/http-client';
import { snapshotSchema, type Snapshot } from '../model/types';

// Fetch then validate against the BE contract at the boundary. A payload that
// drifts from @wn/contracts throws here instead of corrupting the UI silently.
export async function fetchSnapshot(id: string): Promise<Snapshot> {
  const raw = await httpClient.get<unknown>(`/snapshot/${id}`);
  return snapshotSchema.parse(raw);
}

export const snapshotQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['snapshot', id] as const,
    queryFn: () => fetchSnapshot(id),
    staleTime: 1000 * 30,
  });
