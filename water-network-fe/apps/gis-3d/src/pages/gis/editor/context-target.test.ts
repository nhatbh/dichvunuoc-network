import { describe, it, expect } from 'vitest';
import { buildContextTarget } from './context-target';
import type { Hit, Draft } from './model';

const pipeDraft: Draft = {
  id: 'DRF-P1',
  op: 'add',
  kind: 'pipe',
  geom: 'line',
  pts: [[0, 0], [10, 0]],
  dma: 'DMA-01',
};

const valveDraft: Draft = {
  id: 'DRF-V1',
  op: 'add',
  kind: 'valve',
  geom: 'point',
  x: 5,
  y: 5,
  dma: 'DMA-01',
};

const pipeHit: Hit = { kind: 'draft', f: pipeDraft };
const valveHit: Hit = { kind: 'draft', f: valveDraft };
const basePipeHit: Hit = { kind: 'base', base: { type: 'pipe', id: 'P-001', geom: 'line', pts: [[0, 0], [10, 0]] } };

const noHit = (_id: string): Hit | null => null;
const hitMap: Record<string, Hit> = {
  'DRF-P1': pipeHit,
  'DRF-V1': valveHit,
  'P-001': basePipeHit,
};
const hitFor = (id: string): Hit | null => hitMap[id] ?? null;

describe('buildContextTarget', () => {
  it('pipe draft → { kind: "pipe", hit }', () => {
    const result = buildContextTarget({ featureId: 'DRF-P1' }, [5, 5], [], hitFor);
    expect(result.kind).toBe('pipe');
    if (result.kind === 'pipe') {
      expect(result.hit).toBe(pipeHit);
    }
  });

  it('base pipe → { kind: "pipe", hit }', () => {
    const result = buildContextTarget({ featureId: 'P-001' }, [5, 5], [], hitFor);
    expect(result.kind).toBe('pipe');
  });

  it('point (valve draft) → { kind: "point", hit }', () => {
    const result = buildContextTarget({ featureId: 'DRF-V1' }, [5, 5], [], hitFor);
    expect(result.kind).toBe('point');
    if (result.kind === 'point') {
      expect(result.hit).toBe(valveHit);
    }
  });

  it('featureId present but hit not found → { kind: "empty", pt }', () => {
    const result = buildContextTarget({ featureId: 'UNKNOWN-ID' }, [3, 7], [], noHit);
    expect(result.kind).toBe('empty');
    if (result.kind === 'empty') {
      expect(result.pt).toEqual([3, 7]);
    }
  });

  it('no featureId + multiSel → { kind: "multi", ids }', () => {
    const result = buildContextTarget({ featureId: null }, [0, 0], ['DRF-P1', 'DRF-V1'], noHit);
    expect(result.kind).toBe('multi');
    if (result.kind === 'multi') {
      expect(result.ids).toEqual(['DRF-P1', 'DRF-V1']);
    }
  });

  it('no featureId + empty multiSel → { kind: "empty", pt }', () => {
    const result = buildContextTarget({ featureId: null }, [12, 34], [], noHit);
    expect(result.kind).toBe('empty');
    if (result.kind === 'empty') {
      expect(result.pt).toEqual([12, 34]);
    }
  });
});

describe('buildContextTarget — multi-selection', () => {
  it('right-click on a member of a multi-selection targets the whole selection', () => {
    const t = buildContextTarget({ featureId: 'DRF-P1' }, [5, 5], ['DRF-P1', 'DRF-V1'], hitFor);
    expect(t).toEqual({ kind: 'multi', ids: ['DRF-P1', 'DRF-V1'] });
  });
  it('right-click on a base asset outside the selection targets just that asset', () => {
    const t = buildContextTarget({ featureId: 'P-001' }, [5, 5], ['DRF-P1', 'DRF-V1'], hitFor);
    expect(t.kind).toBe('pipe');
  });
});
