import { describe, it, expect, vi } from 'vitest';
import { actionsForTarget, runAction, type ActionCtx, type ActionTarget } from './actions';
import type { Draft } from './model';

function makeCtx(over: Partial<ActionCtx> = {}): ActionCtx {
  return {
    G: {} as ActionCtx['G'],
    drafts: [],
    defaults: { pipe: { dn: 200, material: 'HDPE', trunk: false, cond: 'good' }, valve: { dn: 200, vkind: 'gate' } },
    offsetDist: 2,
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onDeleteAt: vi.fn(),
    onSelect: vi.fn(),
    onMulti: vi.fn(),
    onMatch: vi.fn(),
    onAttachEam: vi.fn(),
    setStatus: vi.fn(),
    toast: vi.fn(),
    setTool: vi.fn(),
    zoomExtent: vi.fn(),
    ...over,
  };
}
const pipeDraft: Draft = { id: 'DRF-001', op: 'add', kind: 'pipe', geom: 'line', pts: [[0, 0], [10, 0]], dma: 'DMA-01' };

describe('actionsForTarget', () => {
  it('offers edit + delete + reverse on a pipe draft', () => {
    const t: ActionTarget = { kind: 'pipe', hit: { kind: 'draft', f: pipeDraft } };
    const ids = actionsForTarget(t, makeCtx()).map((a) => a.id);
    expect(ids).toContain('edit');
    expect(ids).toContain('delete');
    expect(ids).toContain('reverse');
  });

  it('does NOT offer reverse on empty target', () => {
    const t: ActionTarget = { kind: 'empty', pt: [5, 5] };
    const ids = actionsForTarget(t, makeCtx()).map((a) => a.id);
    expect(ids).not.toContain('reverse');
  });
});

describe('runAction', () => {
  it('edit selects the draft', () => {
    const ctx = makeCtx();
    runAction('edit', { kind: 'pipe', hit: { kind: 'draft', f: pipeDraft } }, ctx);
    expect(ctx.onSelect).toHaveBeenCalledWith('DRF-001');
  });

  it('reverse flips draft pts via onUpdate', () => {
    const ctx = makeCtx({ drafts: [pipeDraft] });
    runAction('reverse', { kind: 'pipe', hit: { kind: 'draft', f: pipeDraft } }, ctx);
    expect(ctx.onUpdate).toHaveBeenCalledWith('DRF-001', expect.objectContaining({ pts: [[10, 0], [0, 0]] }));
  });

  it('delete routes to onDeleteAt with the hit', () => {
    const ctx = makeCtx();
    const hit = { kind: 'draft', f: pipeDraft } as const;
    runAction('delete', { kind: 'pipe', hit }, ctx);
    expect(ctx.onDeleteAt).toHaveBeenCalledWith(hit);
  });
});

it('split-here adds a split node at clickPt on the pipe', () => {
  const G = { dmas: [] } as unknown as ActionCtx['G'];
  const ctx = makeCtx({ G, clickPt: [5, 0], drafts: [pipeDraft] });
  runAction('split-here', { kind: 'pipe', hit: { kind: 'draft', f: pipeDraft } }, ctx);
  expect(ctx.onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: 'node', ntype: 'Nút tách', splitOf: 'DRF-001', x: 5, y: 0 }));
});

it('duplicate clones a point draft offset by +14px and selects it', () => {
  const vd: Draft = { id: 'DRF-V1', op: 'add', kind: 'valve', geom: 'point', x: 20, y: 30, dma: 'DMA-01' };
  const ctx = makeCtx({ drafts: [vd] });
  runAction('duplicate', { kind: 'point', hit: { kind: 'draft', f: vd } }, ctx);
  expect(ctx.onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: 'valve', x: 34, y: 44 }));
});

it('batch-edit and delete-all are enabled only for multi target', () => {
  const multi: ActionTarget = { kind: 'multi', ids: ['a', 'b'] };
  const ids = actionsForTarget(multi, makeCtx()).map((a) => a.id);
  expect(ids).toContain('batch-edit');
  expect(ids).toContain('delete-all');
});

it('delete-all removes draft ids but skips base: ids', () => {
  const ctx = makeCtx();
  runAction('delete-all', { kind: 'multi', ids: ['base:P-001', 'DRF-001', 'DRF-002'] }, ctx);
  expect(ctx.onRemove).toHaveBeenCalledWith('DRF-001');
  expect(ctx.onRemove).toHaveBeenCalledWith('DRF-002');
  expect(ctx.onRemove).not.toHaveBeenCalledWith('base:P-001');
});

it('empty target offers draw-here', () => {
  const ids = actionsForTarget({ kind: 'empty', pt: [0, 0] }, makeCtx()).map((a) => a.id);
  expect(ids).toContain('draw-here');
});

it('draw-here calls setTool("pipe")', () => {
  const ctx = makeCtx();
  runAction('draw-here', { kind: 'empty', pt: [0, 0] }, ctx);
  expect(ctx.setTool).toHaveBeenCalledWith('pipe');
});

it('zoom-extent is enabled for empty target', () => {
  const ids = actionsForTarget({ kind: 'empty', pt: [0, 0] }, makeCtx()).map((a) => a.id);
  expect(ids).toContain('zoom-extent');
});

it('draw-here and zoom-extent NOT enabled for pipe target', () => {
  const t: ActionTarget = { kind: 'pipe', hit: { kind: 'draft', f: pipeDraft } };
  const ids = actionsForTarget(t, makeCtx()).map((a) => a.id);
  expect(ids).not.toContain('draw-here');
  expect(ids).not.toContain('zoom-extent');
});

it('zoom-extent calls ctx.zoomExtent()', () => {
  const ctx = makeCtx();
  runAction('zoom-extent', { kind: 'empty', pt: [0, 0] }, ctx);
  expect(ctx.zoomExtent).toHaveBeenCalledTimes(1);
});
