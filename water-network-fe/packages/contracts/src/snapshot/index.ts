import { z } from 'zod';
import { IsoDateTime } from '../common/index.js';

/**
 * Example bounded context (`snapshot/`) mirroring the BE
 * `PublishedNetworkSnapshot` read model. Phase 0 ships one context to fix the
 * organisation pattern + contract test; the rest land per MFE in later phases.
 */

export const SnapshotStatus = z.enum(['draft', 'published', 'superseded']);
export type SnapshotStatus = z.infer<typeof SnapshotStatus>;

export const PublishedNetworkSnapshot = z.object({
  snapshotId: z.string().uuid(),
  version: z.number().int().positive(),
  status: SnapshotStatus,
  /** Canonical CRS is runtime config, not hardcoded — see open decisions. */
  crs: z.string(),
  publishedAt: IsoDateTime.nullable(),
  featureCount: z.number().int().nonnegative(),
});
export type PublishedNetworkSnapshot = z.infer<typeof PublishedNetworkSnapshot>;
