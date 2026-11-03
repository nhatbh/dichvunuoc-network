import { describe, expect, it } from 'vitest';
import {
  CreateDraftFeatureRequest,
  UpdateDraftFeatureGeometryRequest,
  DraftNetworkFeature,
  DraftFeatureCollection,
  SplitPipeRequest,
  ConnectNodeToPipeRequest,
} from './index.js';
import { aDraftFeature, aDraftFeatureCollection } from '../testing/index.js';

describe('draft contracts', () => {
  it('accepts a valid create request (pipe + LineString)', () => {
    const req = {
      kind: 'pipe',
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.81, 21.01]] },
      correlationId: 'c-1',
    };
    expect(CreateDraftFeatureRequest.parse(req).kind).toBe('pipe');
  });

  it('rejects a request missing correlationId', () => {
    const bad = { kind: 'node', geometry: { type: 'Point', coordinates: [105.8, 21] } };
    expect(CreateDraftFeatureRequest.safeParse(bad).success).toBe(false);
  });

  it('builds a draft feature with status draft', () => {
    const f = aDraftFeature({ id: 'draft-1' });
    expect(DraftNetworkFeature.parse(f).id).toBe('draft-1');
    expect(f.properties.status).toBe('draft');
  });

  it('builds a parseable draft collection', () => {
    const c = aDraftFeatureCollection({ count: 2 });
    expect(DraftFeatureCollection.parse(c).features).toHaveLength(2);
  });

  it('accepts a valid update-geometry request', () => {
    const req = {
      geometry: { type: 'LineString', coordinates: [[105.8, 21], [105.82, 21.02]] },
      correlationId: 'c-2',
    };
    expect(UpdateDraftFeatureGeometryRequest.parse(req).correlationId).toBe('c-2');
  });

  it('rejects an update-geometry request missing geometry', () => {
    const bad = { correlationId: 'c-3' };
    expect(UpdateDraftFeatureGeometryRequest.safeParse(bad).success).toBe(false);
  });

  it('accepts a valid split request (Point atPoint + correlationId)', () => {
    const req = {
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
      correlationId: 'c-split',
    };
    expect(SplitPipeRequest.parse(req).correlationId).toBe('c-split');
  });

  it('rejects a split request missing atPoint', () => {
    expect(SplitPipeRequest.safeParse({ correlationId: 'c-x' }).success).toBe(false);
  });

  it('accepts a valid connect request (nodeId + Point atPoint + correlationId)', () => {
    const req = {
      nodeId: 'node-1',
      atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
      correlationId: 'c-connect',
    };
    expect(ConnectNodeToPipeRequest.parse(req).nodeId).toBe('node-1');
  });

  it('rejects a connect request missing nodeId', () => {
    expect(
      ConnectNodeToPipeRequest.safeParse({
        atPoint: { type: 'Point', coordinates: [105.81, 21.01] },
        correlationId: 'c-x',
      }).success,
    ).toBe(false);
  });
});
