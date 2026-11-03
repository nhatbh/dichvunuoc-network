import { z } from 'zod';
import { NetworkFeatureKind, NetworkGeometry, NetworkFeatureProps } from '../map-features/index.js';

/** Command request: create one feature in the active draft (CQRS, §6.3). */
export const CreateDraftFeatureRequest = z.object({
  kind: NetworkFeatureKind,
  geometry: NetworkGeometry,
  correlationId: z.string(),
});
export type CreateDraftFeatureRequest = z.infer<typeof CreateDraftFeatureRequest>;

/** Command request: replace a draft feature's geometry (CQRS). Last-write-wins (no version yet). */
export const UpdateDraftFeatureGeometryRequest = z.object({
  geometry: NetworkGeometry,
  correlationId: z.string(),
});
export type UpdateDraftFeatureGeometryRequest = z.infer<typeof UpdateDraftFeatureGeometryRequest>;

/** Command request: split a pipe at a point into two pipes. Mock computes the geometry. */
export const SplitPipeRequest = z.object({
  atPoint: NetworkGeometry,            // Point (EPSG:4326), already on the pipe line
  correlationId: z.string(),
});
export type SplitPipeRequest = z.infer<typeof SplitPipeRequest>;

/** Command request: connect a node to a pipe at a point. Mock moves the node to the junction,
 *  splits the pipe if the point is interior, and writes bidirectional connectedFeatureIds. */
export const ConnectNodeToPipeRequest = z.object({
  nodeId: z.string(),                  // the draft node to attach (click 1)
  atPoint: NetworkGeometry,            // Point (EPSG:4326), already on the pipe line (click 2)
  correlationId: z.string(),
});
export type ConnectNodeToPipeRequest = z.infer<typeof ConnectNodeToPipeRequest>;

/** A feature living in the draft plane (server-assigned id, status 'draft'). */
export const DraftNetworkFeature = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: NetworkGeometry,
  properties: NetworkFeatureProps,
});
export type DraftNetworkFeature = z.infer<typeof DraftNetworkFeature>;

export const DraftFeatureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(DraftNetworkFeature),
});
export type DraftFeatureCollection = z.infer<typeof DraftFeatureCollection>;
