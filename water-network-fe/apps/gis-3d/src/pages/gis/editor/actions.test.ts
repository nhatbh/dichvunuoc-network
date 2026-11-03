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

describe('selection actions', () => {
  const valveDraft: Draft = { id: 'DRF-V', op: 'add', kind: 'valve', geom: 'point', x: 1, y: 1, dma: 'DMA-01' };
  const pipe2: Draft = { id: 'DRF-002', op: 'add', kind: 'pipe', geom: 'line', pts: [[0, 0], [5, 5]], dma: 'DMA-01' };
  const drafts = [pipeDraft, pipe2, valveDraft];
  const onPipe: ActionTarget = { kind: 'pipe', hit: { kind: 'draft', f: pipeDraft } };
  const empty: ActionTarget = { kind: 'empty', pt: [0, 0] };
  const ids = (t: ActionTarget, ctx: ActionCtx) => actionsForTarget(t, ctx).map((a) => a.id);

  it('offers deselect only when something is selected, on any target', () => {
    expect(ids(empty, makeCtx({ drafts }))).not.toContain('deselect');
    const deselect = vi.fn();
    const ctx = makeCtx({ drafts, sel: 'DRF-001', deselect });
    expect(ids(empty, ctx)).toContain('deselect');
    expect(ids(onPipe, ctx)).toContain('deselect');
    runAction('deselect', empty, ctx);
    expect(deselect).toHaveBeenCalled();
  });

  it('select-this / add / remove depend on whether the target is selected', () => {
    const none = makeCtx({ drafts });
    expect(ids(onPipe, none)).toContain('select-this');
    expect(ids(onPipe, none)).not.toContain('add-to-selection');
    const other = makeCtx({ drafts, sel: 'DRF-V' });
    expect(ids(onPipe, other)).toContain('add-to-selection');
    runAction('add-to-selection', onPipe, other);
    expect(other.onMulti).toHaveBeenCalledWith(['DRF-V', 'DRF-001']);
    const both = makeCtx({ drafts, multiSel: ['DRF-001', 'DRF-V'] });
    expect(ids(onPipe, both)).toContain('remove-from-selection');
    runAction('remove-from-selection', onPipe, both);
    expect(both.onSelect).toHaveBeenCalledWith('DRF-V'); // one left → single selection
  });

  it('select-all, invert and select-same-kind work on live drafts', () => {
    const ctx = makeCtx({ drafts, sel: 'DRF-001' });
    runAction('select-all', empty, ctx);
    expect(ctx.onMulti).toHaveBeenCalledWith(['DRF-001', 'DRF-002', 'DRF-V']);
    runAction('invert-selection', empty, ctx);
    expect(ctx.onMulti).toHaveBeenLastCalledWith(['DRF-002', 'DRF-V']);
    runAction('select-same-kind', onPipe, ctx);
    expect(ctx.onMulti).toHaveBeenLastCalledWith(['DRF-001', 'DRF-002']);
  });

  it('zoom-to frames a feature or the multi-selection when the host supports it', () => {
    expect(ids(onPipe, makeCtx())).not.toContain('zoom-to');
    const zoomTo = vi.fn();
    runAction('zoom-to', onPipe, makeCtx({ zoomTo }));
    expect(zoomTo).toHaveBeenCalledWith(onPipe);
  });
});
