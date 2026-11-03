/* GIS — Biên tập: lõi hành động dùng chung. Mọi lệnh là một EditorAction; menu chuột phải,
   thanh nổi, command palette, phím tắt, ribbon đều gọi runAction() → không nhánh logic song song. */
import { ED_U2M, edDmaAt, edOffsetPts, edPolyLen, newDraftId, type CanvasSel, type Draft, type DraftKind, type Hit, type Pt } from './model';
import type { GisData } from '../lib/gis-data';
import type { EditorDefaults } from './canvas';

export interface ActionCtx {
  G: GisData;
  drafts: Draft[];
  defaults: EditorDefaults;
  offsetDist: number;
  clickPt?: Pt;
  onAdd: (f: Draft) => void;
  onUpdate: (id: string, patch: Partial<Draft>) => void;
  onRemove: (id: string) => void;
  onDeleteAt: (hit: Hit) => void;
  onSelect: (s: CanvasSel) => void;
  onMulti: (ids: string[]) => void;
  onMatch: (hit: Hit) => void;
  onAttachEam: (id: string, kind: DraftKind) => void;
  setStatus: (s: string | null) => void;
  toast: (msg: string, kind?: string) => void;
  setTool: (t: string) => void;
  zoomExtent: () => void;
}

export type ActionTarget =
  | { kind: 'empty'; pt: Pt }
  | { kind: 'pipe'; hit: Hit }
  | { kind: 'point'; hit: Hit }
  | { kind: 'multi'; ids: string[] };

export interface EditorAction {
  id: string;
  label: string;
  icon: string;
  kbd?: string;
  group?: string;
  danger?: boolean;
  quick?: boolean;
  enabledFor: (t: ActionTarget, ctx: ActionCtx) => boolean;
  run: (t: ActionTarget, ctx: ActionCtx) => void;
}

/** CanvasSel tương ứng một hit. */
function hitSel(hit: Hit): CanvasSel {
  return hit.kind === 'draft' ? hit.f.id : { base: hit.base };
}
/** Draft đang trỏ tới (chỉ khi target là draft, không phải base). */
function targetDraft(t: ActionTarget): Draft | null {
  if ((t.kind === 'pipe' || t.kind === 'point') && t.hit.kind === 'draft') return t.hit.f;
  return null;
}

export const EDITOR_ACTIONS: EditorAction[] = [
  {
    id: 'edit',
    label: 'Sửa thuộc tính',
    icon: 'IcPencil',
    kbd: 'Enter',
    group: 'edit',
    quick: true,
    enabledFor: (t) => t.kind === 'pipe' || t.kind === 'point',
    run: (t, ctx) => {
      if (t.kind === 'pipe' || t.kind === 'point') ctx.onSelect(hitSel(t.hit));
    },
  },
  {
    id: 'reverse',
    label: 'Đảo chiều tuyến',
    icon: 'IcRefresh',
    group: 'geom',
    quick: true,
    enabledFor: (t) => t.kind === 'pipe' && !!targetDraft(t)?.pts,
    run: (t, ctx) => {
      const d = targetDraft(t);
      if (!d || !d.pts) return;
      const pts = [...d.pts].reverse() as Pt[];
      ctx.onUpdate(d.id, { pts, lenM: Math.round(edPolyLen(pts) * ED_U2M) });
    },
  },
  {
    id: 'split-here',
    label: 'Tách ống tại đây',
    icon: 'IcGitBranch',
    kbd: 'SP',
    group: 'geom',
    quick: true,
    enabledFor: (t, ctx) => t.kind === 'pipe' && !!ctx.clickPt,
    run: (t, ctx) => {
      if (t.kind !== 'pipe' || !ctx.clickPt) return;
      const [x, y] = ctx.clickPt;
      const onPipe = t.hit.kind === 'draft' ? t.hit.f.id : t.hit.base.id;
      const dma = edDmaAt(ctx.G, x, y);
      ctx.onAdd({ id: newDraftId(), op: 'add', kind: 'node', geom: 'point', x, y, dma, ntype: 'Nút tách', z: 12, eam: null, splitOf: onPipe });
      ctx.setStatus('Đã chèn nút tách trên ' + onPipe);
    },
  },
  {
    id: 'offset',
    label: 'Vẽ song song…',
    icon: 'IcOffset',
    group: 'geom',
    enabledFor: (t) => t.kind === 'pipe',
    run: (t, ctx) => {
      const d = targetDraft(t);
      let pts: Pt[] | null = null;
      let src: { dn?: number; material?: string; trunk?: boolean } | null = null;
      if (d && d.pts) { pts = d.pts; src = d; }
      else if (t.kind === 'pipe' && t.hit.kind === 'base') { const bp = ctx.G.pipeBy[t.hit.base.id]; if (bp) { pts = bp.pts as unknown as Pt[]; src = bp; } }
      if (!pts) return;
      const op = edOffsetPts(pts, (ctx.offsetDist || 2) / ED_U2M);
      ctx.onAdd({ id: newDraftId(), op: 'add', kind: 'pipe', geom: 'line', pts: op, dn: src?.dn ?? 200, material: src?.material ?? 'HDPE', year: 2026, cond: 'good', trunk: !!src?.trunk, dma: edDmaAt(ctx.G, op[0]![0], op[0]![1]), lenM: Math.round(edPolyLen(op) * ED_U2M), eam: null });
      ctx.setStatus('Đã tạo ống song song offset ' + (ctx.offsetDist || 2) + ' m');
    },
  },
  {
    id: 'duplicate',
    label: 'Nhân bản',
    icon: 'IcCopy',
    kbd: '⌘D',
    group: 'edit',
    enabledFor: (t) => !!targetDraft(t),
    run: (t, ctx) => {
      const d = targetDraft(t);
      if (!d) return;
      const id = newDraftId();
      const clone: Draft = d.pts
        ? { ...d, id, pts: d.pts.map((p) => [p[0] + 14, p[1] + 14] as Pt) }
        : { ...d, id, x: (d.x ?? 0) + 14, y: (d.y ?? 0) + 14 };
      ctx.onAdd(clone);
      ctx.onSelect(id);
    },
  },
  {
    id: 'match',
    label: 'Lấy mẫu thuộc tính',
    icon: 'IcCopy',
    kbd: 'MA',
    group: 'edit',
    enabledFor: (t) => t.kind === 'pipe' || t.kind === 'point',
    run: (t, ctx) => { if (t.kind === 'pipe' || t.kind === 'point') ctx.onMatch(t.hit); },
  },
  {
    id: 'attach-eam',
    label: 'Gắn EAM',
    icon: 'IcTag',
    group: 'edit',
    enabledFor: (t) => !!targetDraft(t),
    run: (t, ctx) => { const d = targetDraft(t); if (d) ctx.onAttachEam(d.id, d.kind); },
  },
  {
    id: 'batch-edit',
    label: 'Sửa hàng loạt…',
    icon: 'IcRows',
    kbd: 'Enter',
    group: 'edit',
    enabledFor: (t) => t.kind === 'multi' && t.ids.length > 0,
    run: (t, ctx) => { if (t.kind === 'multi') ctx.onMulti(t.ids); },
  },
  {
    id: 'delete',
    label: 'Đánh dấu xoá',
    icon: 'IcTrash',
    kbd: 'Del',
    group: 'danger',
    danger: true,
    quick: true,
    enabledFor: (t) => t.kind === 'pipe' || t.kind === 'point',
    run: (t, ctx) => {
      if (t.kind === 'pipe' || t.kind === 'point') ctx.onDeleteAt(t.hit);
    },
  },
  {
    id: 'delete-all',
    label: 'Xoá tất cả',
    icon: 'IcTrash',
    kbd: 'Del',
    group: 'danger',
    danger: true,
    enabledFor: (t) => t.kind === 'multi' && t.ids.length > 0,
    run: (t, ctx) => {
      if (t.kind !== 'multi') return;
      t.ids.forEach((id) => { if (!id.startsWith('base:')) ctx.onRemove(id); });
    },
  },
  {
    id: 'draw-here',
    label: 'Vẽ tuyến ống từ đây',
    icon: 'IcPipe',
    kbd: 'L',
    group: 'draw',
    enabledFor: (t) => t.kind === 'empty',
    run: (_t, ctx) => ctx.setTool('pipe'),
  },
  {
    id: 'zoom-extent',
    label: 'Phóng tới toàn mạng',
    icon: 'IcExpand',
    kbd: 'ZE',
    group: 'view',
    enabledFor: (t) => t.kind === 'empty',
    run: (_t, ctx) => ctx.zoomExtent(),
  },
];

const BY_ID = new Map(EDITOR_ACTIONS.map((a) => [a.id, a]));

export function actionsForTarget(t: ActionTarget, ctx: ActionCtx): EditorAction[] {
  return EDITOR_ACTIONS.filter((a) => a.enabledFor(t, ctx));
}

export function runAction(id: string, t: ActionTarget, ctx: ActionCtx): void {
  const a = BY_ID.get(id);
  if (a && a.enabledFor(t, ctx)) a.run(t, ctx);
}
