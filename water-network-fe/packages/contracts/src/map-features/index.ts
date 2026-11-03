import { z } from 'zod';

export const NetworkFeatureKind = z.enum(['pipe', 'node', 'facility', 'component']);
export type NetworkFeatureKind = z.infer<typeof NetworkFeatureKind>;

export const NetworkFeatureProps = z.object({
  kind: NetworkFeatureKind,
  name: z.string().optional(),
  status: z.string().optional(),
  connectedFeatureIds: z.array(z.string()).optional(), // pipe → node-ids; node → pipe-ids (bidirectional topology)
});
export type NetworkFeatureProps = z.infer<typeof NetworkFeatureProps>;

// GeoJSON geometry, coordinates in EPSG:4326 (lon/lat).
export const NetworkGeometry = z.object({
  type: z.enum(['Point', 'LineString', 'Polygon']),
  coordinates: z.unknown(),
});

export const NetworkFeature = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: NetworkGeometry,
  properties: NetworkFeatureProps,
});
export type NetworkFeature = z.infer<typeof NetworkFeature>;

export const MapFeatureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(NetworkFeature),
});
export type MapFeatureCollection = z.infer<typeof MapFeatureCollection>;

// A search hit: enough to list and to fit the map (bbox in EPSG:4326).
export const FeatureSearchResult = z.object({
  id: z.string(),
  name: z.string(),
  kind: NetworkFeatureKind,
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type FeatureSearchResult = z.infer<typeof FeatureSearchResult>;

export const FeatureSearchResults = z.object({
  results: z.array(FeatureSearchResult),
});
export type FeatureSearchResults = z.infer<typeof FeatureSearchResults>;
