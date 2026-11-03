# GIS Editor — Tương tác Pha 0 + Pha 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây nền tảng "lõi hành động dùng chung" + hook chuột phải cho bản đồ, rồi dựng bề mặt tương tác select-first (menu chuột phải ngữ cảnh, thanh công cụ nổi, command palette, phím tắt) cho editor `apps/gis`.

**Architecture:** Mọi lệnh biên tập là một `EditorAction` trong registry `editor/actions.ts`; menu/thanh nổi/palette/phím tắt/ribbon đều gọi `action.run(target, ctx)` — không có nhánh logic song song. Bản đồ OpenLayers được bổ sung hook `onContextMenu` qua `@wn/map-runtime` (giữ nguyên ranh giới "zero ol types cross the port"). UI overlay dùng SolidJS `<Portal>`.

**Tech Stack:** SolidJS, TypeScript, OpenLayers (qua `@wn/map-runtime`), Vitest (+ `@solidjs/testing-library`), Playwright.

## Global Constraints

- **SolidJS, KHÔNG phải React**: overlay (menu/palette/thanh nổi) BẮT BUỘC `<Portal>`; helper trả JSX dùng thunk `() => JSX.Element`, không tái dùng node JSX; icon render qua `<Icon name={...} size={...} />` từ `lib/icons.tsx`.
- **Map port thuần**: KHÔNG import `ol` ngoài `packages/map-runtime/src/openlayers/*`. Method mới chỉ *thêm*, không đổi chữ ký cũ.
- **Fake-port là nguồn sự thật test double**: mỗi method mới trên `MapEnginePort` phải có default trong `packages/map-runtime/src/testing/fake-port.ts`.
- **Toạ độ model theo px**: Draft giữ px; geometry OL trả `EPSG:4326` → đổi về px bằng `lonLatToPx` trước khi vào model.
- **Đơn vị**: `ED_U2M = 1.15` (px→mét); id draft qua `newDraftId()`.
- **Commit**: conventional commits, scope `gis` hoặc `map-runtime`.
- **Test lệnh**: `apps/gis` → `npm run test -- <path>`; `packages/map-runtime` → `npm run test -- <path>` trong package đó. E2E: `npm run e2e -- <spec>` trong `apps/gis`.

---

## File Structure

**packages/map-runtime** (Pha 0):
- Modify: `src/port/map-engine-port.ts` — thêm khai báo `onContextMenu`.
- Modify: `src/port/types.ts` — thêm type `ContextMenuEvent`.
- Modify: `src/openlayers/ol-map-adapter.ts` — impl `onContextMenu` (hit-test + preventDefault).
- Modify: `src/testing/fake-port.ts` — default `onContextMenu` + `emitContextMenu`.
- Test: `src/port/map-engine-port.test.ts`, `src/openlayers/ol-map-adapter.test.ts`.

**apps/gis** (Pha 0 + 1):
- Create: `src/pages/gis/editor/actions.ts` — registry + `ActionCtx`/`ActionTarget`/`EditorAction` + `actionsForTarget`.
- Create: `src/pages/gis/editor/actions.test.ts`.
- Create: `src/pages/gis/editor/shortcuts.ts` — bảng phím → action id.
- Create: `src/pages/gis/editor/shortcuts.test.ts`.
- Create: `src/pages/gis/editor/ui/context-menu.tsx` — menu Portal.
- Create: `src/pages/gis/editor/ui/floating-toolbar.tsx` — thanh nổi.
- Create: `src/pages/gis/editor/ui/command-palette.tsx` — ⌘K + `?` help.
- Modify: `src/pages/gis/editor/ol-canvas.tsx` — phát `onContextMenu`, hover tooltip.
- Modify: `src/pages/gis/screens/editor.tsx` — dựng `ActionCtx`, gắn menu/thanh nổi/palette.
- Test: các `*.test.tsx` tương ứng + `e2e/editor-context-menu.spec.ts`.

---

## PHA 0 — NỀN TẢNG

### Task 1: Type + interface + fake-port cho `onContextMenu`

**Files:**
- Modify: `packages/map-runtime/src/port/types.ts`
- Modify: `packages/map-runtime/src/port/map-engine-port.ts:39` (sau `onModifyComplete`)
- Modify: `packages/map-runtime/src/testing/fake-port.ts`
- Test: `packages/map-runtime/src/port/map-engine-port.test.ts`

**Interfaces:**
- Produces: `ContextMenuEvent = { featureId: string | null; coordinate: Coordinate; pixel: [number, number] }`; `MapEnginePort.onContextMenu(cb: (ev: ContextMenuEvent) => void): () => void`; `FakeMapEnginePort.emitContextMenu(ev: ContextMenuEvent): void`.

- [ ] **Step 1: Viết test thất bại** (thêm vào `map-engine-port.test.ts`)

```ts
import { createFakePort } from '../testing/fake-port.js';

it('onContextMenu subscribes and unsubscribes', () => {
  const p = createFakePort();
  const seen: Array<{ featureId: string | null; pixel: [number, number] }> = [];
  const off = p.onContextMenu((ev) => seen.push({ featureId: ev.featureId, pixel: ev.pixel }));
  p.emitContextMenu({ featureId: 'P-1', coordinate: { lon: 10, lat: 20 }, pixel: [5, 6] });
  off();
  p.emitContextMenu({ featureId: 'P-2', coordinate: { lon: 0, lat: 0 }, pixel: [1, 1] });
  expect(seen).toEqual([{ featureId: 'P-1', pixel: [5, 6] }]);
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd packages/map-runtime && npm run test -- src/port/map-engine-port.test.ts`
Expected: FAIL — `onContextMenu`/`emitContextMenu` không tồn tại trên fake-port.

- [ ] **Step 3: Thêm type vào `types.ts`**

```ts
/** Chuột phải trên bản đồ: feature bị trúng (null nếu nền trống) + toạ độ + pixel. */
export interface ContextMenuEvent {
  featureId: string | null;
  coordinate: Coordinate;
  pixel: [number, number];
}
```

- [ ] **Step 4: Khai báo trong `map-engine-port.ts`** (ngay sau dòng `onModifyComplete(...)`)

```ts
  /** Chuột phải: hit-test tại pixel; cb nhận feature (null nếu trống) + toạ độ lon/lat + pixel. Trả unsubscribe. */
  onContextMenu(cb: (event: ContextMenuEvent) => void): () => void;
```

Cập nhật import đầu file: `import type { ... , ContextMenuEvent } from './types.js';`

- [ ] **Step 5: Thêm default + emit vào `fake-port.ts`**

Thêm khai báo emit vào interface `FakeMapEnginePort`:

```ts
  /** Fire all `onContextMenu` subscribers. */
  emitContextMenu(event: ContextMenuEvent): void;
```

Trong `createFakePort()` thêm set + method + emit (cạnh `boxSubs`):

```ts
  const ctxMenuSubs = new Set<(e: ContextMenuEvent) => void>();
```
```ts
    onContextMenu: vi.fn((cb: (e: ContextMenuEvent) => void) => {
      ctxMenuSubs.add(cb);
      return () => ctxMenuSubs.delete(cb);
    }),
```
```ts
    emitContextMenu: (e) => ctxMenuSubs.forEach((cb) => cb(e)),
```

Cập nhật import: `import type { Coordinate, ContextMenuEvent, Viewport } from '../port/types.js';`

- [ ] **Step 6: Chạy test — kỳ vọng PASS**

Run: `cd packages/map-runtime && npm run test -- src/port/map-engine-port.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/map-runtime/src/port packages/map-runtime/src/testing
git commit -m "feat(map-runtime): add onContextMenu port hook + fake-port double"
```

---

### Task 2: Impl `onContextMenu` trong OL adapter

**Files:**
- Modify: `packages/map-runtime/src/openlayers/ol-map-adapter.ts`
- Test: `packages/map-runtime/src/openlayers/ol-map-adapter.test.ts`

**Interfaces:**
- Consumes: `ContextMenuEvent` (Task 1).
- Produces: `OlMapAdapter.onContextMenu` hoạt động; đăng ký listener `contextmenu` trong `mount()`.

- [ ] **Step 1: Viết test thất bại** (thêm vào `ol-map-adapter.test.ts`, theo pattern các test `on*` sẵn có)

```ts
it('onContextMenu returns an unsubscribe function', () => {
  const adapter = new OlMapAdapter(baseOpts);
  const off = adapter.onContextMenu(() => {});
  expect(typeof off).toBe('function');
  off();
});
```
(`baseOpts` dùng đúng biến options mà các test khác trong file đang dùng — xem đầu file.)

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd packages/map-runtime && npm run test -- src/openlayers/ol-map-adapter.test.ts`
Expected: FAIL — `adapter.onContextMenu is not a function`.

- [ ] **Step 3: Thêm field + method + listener**

Thêm field (cạnh `#boxSubs`):

```ts
  #ctxMenuSubs = new Set<(e: ContextMenuEvent) => void>();
```

Cập nhật import types: thêm `ContextMenuEvent` vào dòng `import type { ... } from '../port/types.js';`.

Trong `mount()`, sau listener `pointermove`, thêm:

```ts
    this.#map.getViewport().addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (!this.#map) return;
      const pixel = this.#map.getEventPixel(e);
      const coord = this.#map.getEventCoordinate(e);
      const hit = this.#map.forEachFeatureAtPixel(pixel, (f) => f.getId());
      const [lon, lat] = toLonLat(coord, this.#view.getProjection());
      this.#ctxMenuSubs.forEach((cb) =>
        cb({
          featureId: hit != null ? String(hit) : null,
          coordinate: { lon: lon ?? 0, lat: lat ?? 0 },
          pixel: [pixel[0] ?? 0, pixel[1] ?? 0],
        }),
      );
    });
```

Thêm method (cạnh `onBoxSelect`):

```ts
  onContextMenu(cb: (e: ContextMenuEvent) => void): () => void {
    this.#ctxMenuSubs.add(cb);
    return () => this.#ctxMenuSubs.delete(cb);
  }
```

Trong `destroy()`, thêm: `this.#ctxMenuSubs.clear();`

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd packages/map-runtime && npm run test -- src/openlayers/ol-map-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Build package (đảm bảo `dist` cho app dùng)**

Run: `cd packages/map-runtime && npm run build`
Expected: build OK, không lỗi type.

- [ ] **Step 6: Commit**

```bash
git add packages/map-runtime/src/openlayers packages/map-runtime/dist
git commit -m "feat(map-runtime): OL adapter fires onContextMenu with hit-tested feature"
```

---

### Task 3: Registry `actions.ts` — hạ tầng + action `edit`/`delete`/`reverse`

**Files:**
- Create: `apps/gis/src/pages/gis/editor/actions.ts`
- Test: `apps/gis/src/pages/gis/editor/actions.test.ts`

**Interfaces:**
- Consumes: `Draft`, `Hit`, `CanvasSel`, `Pt`, `edPolyLen`, `ED_U2M` từ `./model`; `GisData` từ `../lib/gis-data`.
- Produces:
  - `ActionCtx`, `ActionTarget`, `EditorAction` (như spec §2.1).
  - `EDITOR_ACTIONS: EditorAction[]`.
  - `actionsForTarget(t: ActionTarget, ctx: ActionCtx): EditorAction[]` — lọc theo `enabledFor`.
  - `runAction(id: string, t: ActionTarget, ctx: ActionCtx): void` — tra action theo id rồi `run`.

- [ ] **Step 1: Viết test thất bại** (`actions.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { EDITOR_ACTIONS, actionsForTarget, runAction, type ActionCtx, type ActionTarget } from './actions';
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
    setStatus: vi.fn(),
    toast: vi.fn(),
    setTool: vi.fn(),
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
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/actions.test.ts`
Expected: FAIL — module `./actions` chưa tồn tại.

- [ ] **Step 3: Viết `actions.ts`**

```ts
/* GIS — Biên tập: lõi hành động dùng chung. Mọi lệnh là một EditorAction; menu chuột phải,
   thanh nổi, command palette, phím tắt, ribbon đều gọi runAction() → không nhánh logic song song. */
import { ED_U2M, edPolyLen, type CanvasSel, type Draft, type DraftKind, type Hit, type Pt } from './model';
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
  setStatus: (s: string | null) => void;
  toast: (msg: string, kind?: string) => void;
  setTool: (t: string) => void;
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

/** ID của feature trong một hit (draft id hoặc base id). */
function hitId(hit: Hit): string {
  return hit.kind === 'draft' ? hit.f.id : hit.base.id;
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
];

const BY_ID = new Map(EDITOR_ACTIONS.map((a) => [a.id, a]));

export function actionsForTarget(t: ActionTarget, ctx: ActionCtx): EditorAction[] {
  return EDITOR_ACTIONS.filter((a) => a.enabledFor(t, ctx));
}

export function runAction(id: string, t: ActionTarget, ctx: ActionCtx): void {
  const a = BY_ID.get(id);
  if (a && a.enabledFor(t, ctx)) a.run(t, ctx);
}
```
_(Ghi chú: nếu `IcRefresh`/`IcPencil` chưa có trong `lib/icons.tsx` thì Task 5 sẽ thêm; test này không render icon nên không phụ thuộc.)_

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/actions.test.ts`
Expected: PASS (3 describe, 5 assertion).

- [ ] **Step 5: Commit**

```bash
git add apps/gis/src/pages/gis/editor/actions.ts apps/gis/src/pages/gis/editor/actions.test.ts
git commit -m "feat(gis): editor action registry core (edit/reverse/delete)"
```

---

### Task 4: Bổ sung action `split-here`, `offset`, `duplicate`, `match`, `attach-eam`, và nhóm multi

**Files:**
- Modify: `apps/gis/src/pages/gis/editor/actions.ts`
- Modify: `apps/gis/src/pages/gis/editor/actions.test.ts`

**Interfaces:**
- Consumes: `edDmaAt`, `edOffsetPts`, `newDraftId` từ `./model`; `ctx.clickPt` cho `split-here`.
- Produces: thêm action id `split-here`, `offset`, `duplicate`, `match`, `attach-eam`, `batch-edit`, `delete-all` vào `EDITOR_ACTIONS`. `ActionCtx` thêm 2 callback: `onMatch(hit)`, `onAttachEam(id, kind)`.

- [ ] **Step 1: Viết test thất bại** (thêm vào `actions.test.ts`)

```ts
import { edOffsetPts } from './model';

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
```

Cập nhật `makeCtx` thêm 2 mock:

```ts
    onMatch: vi.fn(),
    onAttachEam: vi.fn(),
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/actions.test.ts`
Expected: FAIL — action id chưa có + `onMatch`/`onAttachEam` chưa trên `ActionCtx`.

- [ ] **Step 3: Mở rộng `ActionCtx` + thêm import**

Trong `actions.ts`, thêm import:

```ts
import { ED_U2M, edDmaAt, edOffsetPts, edPolyLen, newDraftId, type CanvasSel, type Draft, type DraftKind, type Hit, type Pt } from './model';
```

Thêm 2 field vào `ActionCtx`:

```ts
  onMatch: (hit: Hit) => void;
  onAttachEam: (id: string, kind: DraftKind) => void;
```

- [ ] **Step 4: Thêm action vào `EDITOR_ACTIONS`** (chèn trước phần `danger`)

```ts
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
```

Và trong nhóm `danger`, thêm action `delete-all`:

```ts
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
```

- [ ] **Step 5: Chạy test — kỳ vọng PASS**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/actions.test.ts`
Expected: PASS (thêm 3 test mới).

- [ ] **Step 6: Commit**

```bash
git add apps/gis/src/pages/gis/editor/actions.ts apps/gis/src/pages/gis/editor/actions.test.ts
git commit -m "feat(gis): editor actions — split/offset/duplicate/match/eam + multi ops"
```

---

### Task 5: `shortcuts.ts` — bảng phím → action id + icon còn thiếu

**Files:**
- Create: `apps/gis/src/pages/gis/editor/shortcuts.ts`
- Create: `apps/gis/src/pages/gis/editor/shortcuts.test.ts`
- Modify: `apps/gis/src/pages/gis/lib/icons.tsx` (bổ sung icon còn thiếu nếu chưa có)

**Interfaces:**
- Produces: `SHORTCUTS: { key: string; actionId: string; label: string }[]`; `resolveShortcut(e: KeyboardEvent): string | null` — trả action id khớp, `null` nếu không.

- [ ] **Step 1: Viết test thất bại** (`shortcuts.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { resolveShortcut, SHORTCUTS } from './shortcuts';

const ev = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

describe('resolveShortcut', () => {
  it('maps Enter to edit', () => {
    expect(resolveShortcut(ev({ key: 'Enter' }))).toBe('edit');
  });
  it('maps Delete/Backspace to delete', () => {
    expect(resolveShortcut(ev({ key: 'Delete' }))).toBe('delete');
    expect(resolveShortcut(ev({ key: 'Backspace' }))).toBe('delete');
  });
  it('maps ⌘/Ctrl+D to duplicate', () => {
    expect(resolveShortcut(ev({ key: 'd', metaKey: true }))).toBe('duplicate');
    expect(resolveShortcut(ev({ key: 'd', ctrlKey: true }))).toBe('duplicate');
  });
  it('returns null for unmapped keys', () => {
    expect(resolveShortcut(ev({ key: 'q' }))).toBeNull();
  });
  it('every shortcut points at a real action id', () => {
    const ids = new Set(SHORTCUTS.map((s) => s.actionId));
    expect(ids.has('edit')).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/shortcuts.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `shortcuts.ts`**

```ts
/* GIS — Biên tập: bảng phím tắt → action id. Editor đăng ký 1 listener keydown, tra resolveShortcut. */
export interface Shortcut {
  key: string;      // hiển thị cho bảng trợ giúp
  actionId: string;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { key: 'Enter', actionId: 'edit', label: 'Sửa thuộc tính đối tượng đang chọn' },
  { key: '⌘/Ctrl+D', actionId: 'duplicate', label: 'Nhân bản' },
  { key: 'R', actionId: 'reverse', label: 'Đảo chiều tuyến' },
  { key: 'Del / ⌫', actionId: 'delete', label: 'Đánh dấu xoá' },
];

/** Khớp một KeyboardEvent với action id, hoặc null. Không xử lý khi đang gõ trong input. */
export function resolveShortcut(e: KeyboardEvent): string | null {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && (e.key === 'd' || e.key === 'D')) return 'duplicate';
  if (e.key === 'Enter') return 'edit';
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  if (e.key === 'r' || e.key === 'R') return 'reverse';
  return null;
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Đảm bảo icon tồn tại**

Run: `cd apps/gis && node -e "const i=require('fs').readFileSync('src/pages/gis/lib/icons.tsx','utf8'); ['IcPencil','IcRefresh','IcTrash','IcGitBranch','IcOffset','IcCopy','IcTag','IcRows'].forEach(n=>console.log(n, i.includes(n)))"`
Với icon nào in ra `false`: thêm vào `ICONS` map trong `icons.tsx` bằng cách map sang một icon có sẵn gần nghĩa (ví dụ `IcRefresh: IcRefresh` nếu đã có, hoặc alias `IcRows: IcGridSq`, `IcTag: IcNode`). Giữ nguyên pattern `export const IcX: IconComponent = (p) => (...)` của file. **KHÔNG** tạo node JSX tái dùng — mỗi icon là hàm.

- [ ] **Step 6: Commit**

```bash
git add apps/gis/src/pages/gis/editor/shortcuts.ts apps/gis/src/pages/gis/editor/shortcuts.test.ts apps/gis/src/pages/gis/lib/icons.tsx
git commit -m "feat(gis): editor keyboard shortcut resolver + missing action icons"
```

---

## PHA 1 — BỀ MẶT TƯƠNG TÁC

### Task 6: Component `ContextMenu` (Portal)

**Files:**
- Create: `apps/gis/src/pages/gis/editor/ui/context-menu.tsx`
- Test: `apps/gis/src/pages/gis/editor/ui/context-menu.test.tsx`

**Interfaces:**
- Consumes: `EditorAction` (Task 3).
- Produces: component `ContextMenu(props: { open: boolean; x: number; y: number; label?: string; actions: EditorAction[]; onPick: (id: string) => void; onClose: () => void })`.

- [ ] **Step 1: Viết test thất bại** (`context-menu.test.tsx`)

```tsx
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { ContextMenu } from './context-menu';
import type { EditorAction } from '../actions';

const noop = () => {};
const acts: EditorAction[] = [
  { id: 'edit', label: 'Sửa thuộc tính', icon: 'IcPencil', enabledFor: () => true, run: noop },
  { id: 'delete', label: 'Đánh dấu xoá', icon: 'IcTrash', danger: true, enabledFor: () => true, run: noop },
];

describe('ContextMenu', () => {
  it('renders one row per action and fires onPick', () => {
    const onPick = vi.fn();
    render(() => <ContextMenu open x={10} y={10} label="Ống P-1" actions={acts} onPick={onPick} onClose={noop} />);
    expect(screen.getByText('Sửa thuộc tính')).toBeTruthy();
    fireEvent.click(screen.getByText('Đánh dấu xoá'));
    expect(onPick).toHaveBeenCalledWith('delete');
  });

  it('renders nothing when closed', () => {
    render(() => <ContextMenu open={false} x={0} y={0} actions={acts} onPick={noop} onClose={noop} />);
    expect(screen.queryByText('Sửa thuộc tính')).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/context-menu.test.tsx`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `context-menu.tsx`**

```tsx
/* GIS — Biên tập: menu chuột phải. Overlay dùng <Portal> (SolidJS). Render từ danh sách
   EditorAction đã lọc theo ngữ cảnh; kẻ separator giữa các nhóm `group`. */
import { For, Show, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Icon } from '../../lib/icons';
import type { EditorAction } from '../actions';

export function ContextMenu(props: {
  open: boolean;
  x: number;
  y: number;
  label?: string;
  actions: EditorAction[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    const onDown = () => props.onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    onCleanup(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); });
  });

  return (
    <Show when={props.open}>
      <Portal>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div
          class="fixed z-[70] min-w-[212px] rounded-lg border border-line bg-[var(--surface)] p-1.5"
          style={{ left: `${props.x}px`, top: `${props.y}px`, 'box-shadow': 'var(--toast-shadow)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Show when={props.label}>
            <div class="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted2)]">{props.label}</div>
          </Show>
          <For each={props.actions}>
            {(a, i) => (
              <>
                <Show when={i() > 0 && props.actions[i() - 1]!.group !== a.group}>
                  <div class="my-1 h-px bg-[var(--line)]" />
                </Show>
                <button
                  onClick={() => { props.onPick(a.id); props.onClose(); }}
                  class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--surface2)]"
                  classList={{ 'text-[color:var(--danger,#D1242F)]': a.danger, 'text-[color:var(--text2)]': !a.danger }}
                >
                  <span class="w-4 text-center opacity-85"><Icon name={a.icon} size={14} /></span>
                  <span class="flex-1">{a.label}</span>
                  <Show when={a.kbd}><span class="font-mono text-[10px] text-[color:var(--muted2)]">{a.kbd}</span></Show>
                </button>
              </>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/context-menu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis/src/pages/gis/editor/ui/context-menu.tsx apps/gis/src/pages/gis/editor/ui/context-menu.test.tsx
git commit -m "feat(gis): context menu component (Portal, grouped actions)"
```

---

### Task 7: Nối chuột phải vào canvas + mở menu trong workspace

**Files:**
- Modify: `apps/gis/src/pages/gis/editor/ol-canvas.tsx`
- Modify: `apps/gis/src/pages/gis/screens/editor.tsx`
- Test: `apps/gis/e2e/editor-context-menu.spec.ts`

**Interfaces:**
- Consumes: `ContextMenu` (Task 6); `actionsForTarget`/`runAction`/`ActionCtx`/`ActionTarget` (Task 3–4); `onContextMenu` port (Task 2).
- Produces: prop mới `onContextMenu: (t: ActionTarget, screenXY: [number, number]) => void` trên `EditorOLCanvas`; workspace giữ signal `ctxMenu` + render `<ContextMenu>`.

- [ ] **Step 1: Viết e2e thất bại** (`editor-context-menu.spec.ts`) — theo pattern các spec trong `apps/gis/e2e` (mở editor với một branch nháp).

```ts
import { test, expect } from '@playwright/test';

test('right-click on empty canvas shows context menu with draw action', async ({ page }) => {
  await page.goto('/'); // TODO điều hướng tới editor branch nháp theo helper e2e hiện có
  const canvas = page.locator('.ol-viewport').first();
  await canvas.click({ button: 'right', position: { x: 300, y: 200 } });
  await expect(page.getByText('Vẽ tuyến ống từ đây')).toBeVisible();
});
```
_(Điều hướng: dùng đúng bước mở editor mà spec `editor-ribbon.spec.ts` hiện dùng — copy phần setup của nó.)_

- [ ] **Step 2: Chạy e2e — kỳ vọng FAIL**

Run: `cd apps/gis && npm run e2e -- editor-context-menu.spec.ts`
Expected: FAIL — chưa có menu.

- [ ] **Step 3: Thêm action `draw-here` + `empty` context vào `actions.ts`** (để menu nền trống có nội dung)

```ts
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
    run: (_t, ctx) => ctx.setStatus('zoom-extent'),
  },
```
Thêm test unit nhanh vào `actions.test.ts`:
```ts
it('empty target offers draw-here', () => {
  const ids = actionsForTarget({ kind: 'empty', pt: [0, 0] }, makeCtx()).map((a) => a.id);
  expect(ids).toContain('draw-here');
});
```
Run: `cd apps/gis && npm run test -- src/pages/gis/editor/actions.test.ts` → PASS.

- [ ] **Step 4: Phát `onContextMenu` từ `ol-canvas.tsx`**

Thêm prop vào interface `EditorOLCanvas`:

```ts
  onContextMenu: (t: ActionTarget, screenXY: [number, number]) => void
```
Import: `import { type ActionTarget } from './actions'`.

Thêm effect đăng ký (cạnh effect `onPointerMove`):

```ts
  createEffect(() => {
    const p = port()
    if (!p) return
    const off = p.onContextMenu((ev) => {
      const [x, y] = lonLatToPx(ev.coordinate.lon, ev.coordinate.lat)
      const px: Pt = [Math.round(x), Math.round(y)]
      const rect = containerRef?.getBoundingClientRect?.()
      const screenXY: [number, number] = [(rect?.left ?? 0) + ev.pixel[0], (rect?.top ?? 0) + ev.pixel[1]]
      let target: ActionTarget
      if (ev.featureId) {
        const hit = hitFor(ev.featureId)
        if (hit) {
          const isPipe = hit.kind === 'draft' ? hit.f.kind === 'pipe' : hit.base.type === 'pipe'
          target = isPipe ? { kind: 'pipe', hit } : { kind: 'point', hit }
        } else target = { kind: 'empty', pt: px }
      } else if (props.multiSel.length) target = { kind: 'multi', ids: props.multiSel }
      else target = { kind: 'empty', pt: px }
      props.onContextMenu(target, screenXY)
    })
    onCleanup(off)
  })
```
_(Ghi chú: `containerRef` là biến ref của div bản đồ — kiểm tra tên biến thực tế đầu component; nếu là `containerRef` từ `createMapRuntime`, dùng `containerRef`.)_

- [ ] **Step 5: Dựng `ActionCtx` + render menu trong `editor.tsx`**

Trong `EditorWorkspace`, thêm signal:

```ts
  const [ctxMenu, setCtxMenu] = createSignal<{ open: boolean; x: number; y: number; target: ActionTarget | null }>({ open: false, x: 0, y: 0, target: null })
```

Thêm hàm dựng ctx + xử lý match/eam (tái dùng `onPaint`/`onAttach` sẵn có):

```ts
  const actionCtx = (clickPt?: Pt): ActionCtx => ({
    G, drafts: drafts(), defaults: defaults(), offsetDist: offsetDist(), clickPt,
    onAdd, onUpdate, onRemove, onDeleteAt, onSelect: onSelectCanvas, onMulti,
    setStatus, toast: props.toast, setTool: setToolFromRibbon,
    onMatch: (hit) => onPaint(hit),
    onAttachEam: (id, kind) => onAttach(id, kind),
  })
  const openCtxMenu = (t: ActionTarget, xy: [number, number]) => setCtxMenu({ open: true, x: xy[0], y: xy[1], target: t })
  const pickCtxAction = (id: string) => {
    const m = ctxMenu()
    if (!m.target) return
    if (id === 'zoom-extent') { setFocusKey((n) => n + 1); return }
    runAction(id, m.target, actionCtx(m.target.kind === 'empty' ? m.target.pt : undefined))
  }
```

Import: `import { actionsForTarget, runAction, type ActionCtx, type ActionTarget } from '../editor/actions'` và `import { ContextMenu } from '../editor/ui/context-menu'`.

Truyền prop cho canvas: `onContextMenu={openCtxMenu}`.

Render menu (cuối JSX, cạnh các modal):

```tsx
      <ContextMenu
        open={ctxMenu().open}
        x={ctxMenu().x}
        y={ctxMenu().y}
        label={ctxMenu().target ? ctxTargetLabel(ctxMenu().target!) : undefined}
        actions={ctxMenu().target ? actionsForTarget(ctxMenu().target!, actionCtx()) : []}
        onPick={pickCtxAction}
        onClose={() => setCtxMenu((m) => ({ ...m, open: false }))}
      />
```

Thêm helper nhãn:

```ts
  const ctxTargetLabel = (t: ActionTarget): string => {
    if (t.kind === 'multi') return t.ids.length + ' đối tượng đã chọn'
    if (t.kind === 'empty') return 'Vị trí trên bản đồ'
    const id = t.hit.kind === 'draft' ? t.hit.f.id : t.hit.base.id
    return (t.kind === 'pipe' ? 'Tuyến ống · ' : 'Đối tượng · ') + id
  }
```

- [ ] **Step 6: Chạy e2e — kỳ vọng PASS**

Run: `cd apps/gis && npm run e2e -- editor-context-menu.spec.ts`
Expected: PASS.

- [ ] **Step 7: Chạy typecheck + toàn bộ unit**

Run: `cd apps/gis && npm run typecheck && npm run test`
Expected: xanh.

- [ ] **Step 8: Commit**

```bash
git add apps/gis/src/pages/gis/editor apps/gis/src/pages/gis/screens/editor.tsx apps/gis/e2e/editor-context-menu.spec.ts
git commit -m "feat(gis): wire right-click context menu into editor (select-first)"
```

---

### Task 8: `FloatingToolbar` — thanh nổi cạnh selection

**Files:**
- Create: `apps/gis/src/pages/gis/editor/ui/floating-toolbar.tsx`
- Test: `apps/gis/src/pages/gis/editor/ui/floating-toolbar.test.tsx`
- Modify: `apps/gis/src/pages/gis/screens/editor.tsx`

**Interfaces:**
- Consumes: `EditorAction` (chỉ action `quick`).
- Produces: `FloatingToolbar(props: { open: boolean; x: number; y: number; actions: EditorAction[]; onPick: (id: string) => void; onMore: () => void })`.

- [ ] **Step 1: Viết test thất bại** (`floating-toolbar.test.tsx`)

```tsx
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { FloatingToolbar } from './floating-toolbar';
import type { EditorAction } from '../actions';

const noop = () => {};
const acts: EditorAction[] = [
  { id: 'edit', label: 'Sửa', icon: 'IcPencil', quick: true, enabledFor: () => true, run: noop },
  { id: 'reverse', label: 'Đảo chiều', icon: 'IcRefresh', quick: true, enabledFor: () => true, run: noop },
];

describe('FloatingToolbar', () => {
  it('renders quick actions and fires onPick / onMore', () => {
    const onPick = vi.fn(); const onMore = vi.fn();
    render(() => <FloatingToolbar open x={10} y={10} actions={acts} onPick={onPick} onMore={onMore} />);
    fireEvent.click(screen.getByTitle('Sửa'));
    expect(onPick).toHaveBeenCalledWith('edit');
    fireEvent.click(screen.getByTitle('Thêm lệnh'));
    expect(onMore).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/floating-toolbar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Viết `floating-toolbar.tsx`**

```tsx
/* GIS — Biên tập: thanh công cụ nổi cạnh selection (chỉ action `quick`) + nút ⋯ mở menu đầy đủ. */
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Icon } from '../../lib/icons';
import type { EditorAction } from '../actions';

export function FloatingToolbar(props: {
  open: boolean;
  x: number;
  y: number;
  actions: EditorAction[];
  onPick: (id: string) => void;
  onMore: () => void;
}) {
  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed z-[65] flex items-center gap-0.5 rounded-lg border border-line bg-[var(--surface)] p-1"
          style={{ left: `${props.x}px`, top: `${props.y}px`, transform: 'translate(-50%,-120%)', 'box-shadow': 'var(--card-shadow)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <For each={props.actions.filter((a) => a.quick)}>
            {(a) => (
              <button
                title={a.label}
                onClick={() => props.onPick(a.id)}
                class="flex h-7 w-8 items-center justify-center rounded-md hover:bg-[var(--surface2)]"
                classList={{ 'text-[color:var(--danger,#D1242F)]': a.danger, 'text-[color:var(--text2)]': !a.danger }}
              >
                <Icon name={a.icon} size={14} />
              </button>
            )}
          </For>
          <div class="mx-0.5 h-5 w-px bg-[var(--line)]" />
          <button title="Thêm lệnh" onClick={() => props.onMore()} class="flex h-7 w-8 items-center justify-center rounded-md text-[color:var(--text2)] hover:bg-[var(--surface2)]">
            <Icon name="IcDots" size={14} />
          </button>
        </div>
      </Portal>
    </Show>
  );
}
```
_(Nếu `IcDots` chưa có, alias trong `icons.tsx` như Task 5 Step 5.)_

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/floating-toolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gắn thanh nổi vào workspace**

Trong `editor.tsx`: tính vị trí từ selection (dùng toạ độ px của draft/base → nhưng thanh nổi cần screen px). Đơn giản hoá đợt này: hiện thanh nổi tại vị trí chuột phải/last-click bằng cách tái dùng vị trí menu — HOẶC ẩn thanh nổi khi chưa có toạ độ màn hình. Cài đặt tối thiểu: hiện `FloatingToolbar` khi `sel()` là draft/base, đặt tại tâm màn hình canvas trên cùng selection. Bổ sung signal:

```ts
  const [floatXY, setFloatXY] = createSignal<[number, number] | null>(null)
```
Canvas báo screen-xy của selection qua callback mới `onSelectScreenXY` (thêm prop, phát trong effect selection dùng `port().getView()` + project — hoặc, đợt này, đặt `floatXY` = vị trí click gần nhất từ `onCoord`→screen). Để tránh phình, đợt này gắn thanh nổi **mở từ nút ⋯ của context menu** là chính; vị trí bám selection để Pha 2 hoàn thiện. Render:

```tsx
      <Show when={floatXY() && (typeof sel() === 'string' || (sel() && typeof sel() === 'object'))}>
        {(xy) => (
          <FloatingToolbar
            open
            x={floatXY()![0]}
            y={floatXY()![1]}
            actions={selActions()}
            onPick={(id) => runAction(id, selTarget()!, actionCtx())}
            onMore={() => setCtxMenu({ open: true, x: floatXY()![0], y: floatXY()![1], target: selTarget() })}
          />
        )}
      </Show>
```
Thêm helper `selTarget()` (dựng `ActionTarget` từ `sel()`) và `selActions()` = `actionsForTarget(selTarget(), actionCtx()).filter(a=>a.quick)`.

_(Định vị chính xác bám đối tượng là mục Pha 2; đợt này chấp nhận vị trí theo lần tương tác gần nhất.)_

- [ ] **Step 6: Typecheck + test**

Run: `cd apps/gis && npm run typecheck && npm run test`
Expected: xanh.

- [ ] **Step 7: Commit**

```bash
git add apps/gis/src/pages/gis/editor/ui/floating-toolbar.tsx apps/gis/src/pages/gis/editor/ui/floating-toolbar.test.tsx apps/gis/src/pages/gis/screens/editor.tsx
git commit -m "feat(gis): floating quick-action toolbar for selection"
```

---

### Task 9: `CommandPalette` (⌘K) + bảng phím tắt (`?`)

**Files:**
- Create: `apps/gis/src/pages/gis/editor/ui/command-palette.tsx`
- Test: `apps/gis/src/pages/gis/editor/ui/command-palette.test.tsx`
- Modify: `apps/gis/src/pages/gis/screens/editor.tsx`

**Interfaces:**
- Consumes: `EDITOR_ACTIONS`, `SHORTCUTS`.
- Produces: `CommandPalette(props: { open: boolean; actions: EditorAction[]; onRun: (id: string) => void; onClose: () => void })` với ô tìm fuzzy đơn giản (lọc theo `label` chứa query, không phân biệt hoa thường).

- [ ] **Step 1: Viết test thất bại** (`command-palette.test.tsx`)

```tsx
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { CommandPalette } from './command-palette';
import type { EditorAction } from '../actions';

const noop = () => {};
const acts: EditorAction[] = [
  { id: 'reverse', label: 'Đảo chiều tuyến', icon: 'IcRefresh', enabledFor: () => true, run: noop },
  { id: 'offset', label: 'Vẽ song song', icon: 'IcOffset', enabledFor: () => true, run: noop },
];

describe('CommandPalette', () => {
  it('filters by query and runs the picked command', async () => {
    const onRun = vi.fn();
    render(() => <CommandPalette open actions={acts} onRun={onRun} onClose={noop} />);
    const input = screen.getByPlaceholderText('Tìm lệnh…') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'song' } });
    expect(screen.queryByText('Đảo chiều tuyến')).toBeNull();
    fireEvent.click(screen.getByText('Vẽ song song'));
    expect(onRun).toHaveBeenCalledWith('offset');
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/command-palette.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Viết `command-palette.tsx`**

```tsx
/* GIS — Biên tập: command palette ⌘K. Lọc EDITOR_ACTIONS theo query (label chứa chuỗi). */
import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Icon } from '../../lib/icons';
import type { EditorAction } from '../actions';

export function CommandPalette(props: {
  open: boolean;
  actions: EditorAction[];
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = createSignal('');
  createEffect(() => {
    if (!props.open) { setQ(''); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  const filtered = createMemo(() => {
    const s = q().trim().toLowerCase();
    return s ? props.actions.filter((a) => a.label.toLowerCase().includes(s)) : props.actions;
  });
  return (
    <Show when={props.open}>
      <Portal>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div class="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={props.onClose}>
          <div class="w-full max-w-[520px] overflow-hidden rounded-xl border border-line bg-[var(--surface)]" style={{ 'box-shadow': '0 24px 64px -16px rgba(0,0,0,0.5)' }} onClick={(e) => e.stopPropagation()}>
            <input
              autofocus
              value={q()}
              onInput={(e) => setQ(e.currentTarget.value)}
              placeholder="Tìm lệnh…"
              class="w-full border-b border-line bg-transparent px-4 py-3 text-[13px] text-[color:var(--text)] outline-none"
            />
            <div class="max-h-[320px] overflow-y-auto py-1">
              <For each={filtered()}>
                {(a) => (
                  <button onClick={() => { props.onRun(a.id); props.onClose(); }} class="flex w-full items-center gap-3 px-4 py-2 text-left text-[12.5px] text-[color:var(--text2)] hover:bg-[var(--surface2)]">
                    <span class="w-4 text-center opacity-85"><Icon name={a.icon} size={14} /></span>
                    <span class="flex-1">{a.label}</span>
                    <Show when={a.kbd}><span class="font-mono text-[10px] text-[color:var(--muted2)]">{a.kbd}</span></Show>
                  </button>
                )}
              </For>
              <Show when={filtered().length === 0}><div class="px-4 py-6 text-center text-[12px] text-[color:var(--muted)]">Không có lệnh khớp</div></Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/command-palette.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gắn ⌘K vào workspace**

Trong `editor.tsx`, thêm signal + listener:

```ts
  const [paletteOpen, setPaletteOpen] = createSignal(false)
```
Trong effect keydown undo/redo sẵn có, thêm:
```ts
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPaletteOpen((o) => !o) }
```
Render:
```tsx
      <CommandPalette
        open={paletteOpen()}
        actions={EDITOR_ACTIONS.filter((a) => a.enabledFor(paletteTarget(), actionCtx()))}
        onRun={(id) => runAction(id, paletteTarget(), actionCtx())}
        onClose={() => setPaletteOpen(false)}
      />
```
`paletteTarget()` = `selTarget()` nếu có selection, ngược lại `{ kind: 'empty', pt: coord() ?? [0,0] }`.
Import `EDITOR_ACTIONS` từ `../editor/actions` và `CommandPalette`.

- [ ] **Step 6: Typecheck + test + e2e regress**

Run: `cd apps/gis && npm run typecheck && npm run test && npm run e2e -- editor-ribbon.spec.ts editor-context-menu.spec.ts`
Expected: xanh (ribbon cũ không vỡ).

- [ ] **Step 7: Commit**

```bash
git add apps/gis/src/pages/gis/editor/ui/command-palette.tsx apps/gis/src/pages/gis/editor/ui/command-palette.test.tsx apps/gis/src/pages/gis/screens/editor.tsx
git commit -m "feat(gis): command palette (⌘K) over editor action registry"
```

---

### Task 10: Bảng phím tắt (`?`) + "lặp lại lệnh trước"

**Files:**
- Create: `apps/gis/src/pages/gis/editor/ui/shortcut-help.tsx`
- Test: `apps/gis/src/pages/gis/editor/ui/shortcut-help.test.tsx`
- Modify: `apps/gis/src/pages/gis/screens/editor.tsx`

**Interfaces:**
- Consumes: `SHORTCUTS` (Task 5), `runAction` (Task 3).
- Produces: `ShortcutHelp(props: { open: boolean; onClose: () => void })`; workspace nhớ `lastActionId` và chạy lại khi nhấn Space.

- [ ] **Step 1: Viết test thất bại** (`shortcut-help.test.tsx`)

```tsx
import { render, screen } from '@solidjs/testing-library';
import { describe, it, expect } from 'vitest';
import { ShortcutHelp } from './shortcut-help';

describe('ShortcutHelp', () => {
  it('lists every shortcut when open', () => {
    render(() => <ShortcutHelp open onClose={() => {}} />);
    expect(screen.getByText('Đảo chiều tuyến')).toBeTruthy();
  });
  it('renders nothing when closed', () => {
    render(() => <ShortcutHelp open={false} onClose={() => {}} />);
    expect(screen.queryByText('Đảo chiều tuyến')).toBeNull();
  });
});
```
_(Chuỗi 'Đảo chiều tuyến' khớp `label` trong `SHORTCUTS`.)_

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/shortcut-help.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Viết `shortcut-help.tsx`**

```tsx
/* GIS — Biên tập: overlay bảng phím tắt (nhấn ?). */
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { SHORTCUTS } from '../shortcuts';

export function ShortcutHelp(props: { open: boolean; onClose: () => void }) {
  return (
    <Show when={props.open}>
      <Portal>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div class="fixed inset-0 z-[80] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={props.onClose}>
          <div class="w-full max-w-[420px] rounded-xl border border-line bg-[var(--surface)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 class="mb-3 text-[14px] font-semibold text-[color:var(--text)]">Phím tắt</h3>
            <For each={SHORTCUTS}>
              {(s) => (
                <div class="flex items-center justify-between py-1.5 text-[12.5px] text-[color:var(--text2)]">
                  <span>{s.label}</span>
                  <span class="font-mono text-[11px] text-[color:var(--muted)]">{s.key}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `cd apps/gis && npm run test -- src/pages/gis/editor/ui/shortcut-help.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gắn `?` + lặp lệnh vào workspace**

Trong `editor.tsx`: signal `const [helpOpen, setHelpOpen] = createSignal(false)` và `let lastActionId: string | null = null`. Trong `pickCtxAction`/`onRun` gán `lastActionId = id`. Trong effect keydown thêm:

```ts
      if (e.key === '?' ) { e.preventDefault(); setHelpOpen((o) => !o) }
      if (e.key === ' ' && lastActionId && selTarget()) { e.preventDefault(); runAction(lastActionId, selTarget()!, actionCtx()) }
```
_(Bỏ qua khi focus đang ở input — kiểm tra `document.activeElement?.tagName !== 'INPUT'` trước khi xử lý `?`/Space.)_
Render `<ShortcutHelp open={helpOpen()} onClose={() => setHelpOpen(false)} />`.

- [ ] **Step 6: Typecheck + test**

Run: `cd apps/gis && npm run typecheck && npm run test`
Expected: xanh.

- [ ] **Step 7: Commit**

```bash
git add apps/gis/src/pages/gis/editor/ui/shortcut-help.tsx apps/gis/src/pages/gis/editor/ui/shortcut-help.test.tsx apps/gis/src/pages/gis/screens/editor.tsx
git commit -m "feat(gis): shortcut help overlay (?) + repeat-last-command (Space)"
```

---

### Task 11: Hover tooltip trên canvas (ID/DN/vật liệu)

**Files:**
- Modify: `apps/gis/src/pages/gis/editor/ol-canvas.tsx`
- Test: `apps/gis/e2e/editor-context-menu.spec.ts` (thêm 1 assertion hover)

**Interfaces:**
- Consumes: `port().onPointerMove` + hit-test qua `hitFor` (đã có trong ol-canvas).
- Produces: một `<div>` tooltip tuyệt đối trong `ol-canvas` hiển thị `id · DN · material` khi trỏ vào feature ở tool `select`.

- [ ] **Step 1: Thêm signal tooltip trong `ol-canvas.tsx`**

```ts
  const [tip, setTip] = createSignal<{ x: number; y: number; text: string } | null>(null)
```

- [ ] **Step 2: Cập nhật effect `onPointerMove`** để hit-test và set tooltip (chỉ khi `props.tool === 'select'`):

```ts
    const off = p.onPointerMove((c) => {
      if (!c) { setTip(null); return }
      const [x, y] = lonLatToPx(c.lon, c.lat)
      lastPx = [Math.round(x), Math.round(y)]
      props.onCoord(lastPx[0], lastPx[1])
      if (props.tool !== 'select') { setTip(null); return }
      const pipe = nearestPipe(lastPx[0], lastPx[1], 8)
      if (pipe) {
        const bp = G.pipeBy[pipe]
        const rect = containerRef?.getBoundingClientRect?.()
        setTip({ x: (rect ? 0 : 0) + 0, y: 0, text: pipe + (bp ? ` · DN${bp.dn} · ${bp.material ?? ''}` : '') })
      } else setTip(null)
    })
```
_(Vị trí tooltip: đặt theo con trỏ — nếu port không cấp pixel trong pointermove, đặt tooltip ở góc canvas kèm nội dung; định vị bám con trỏ hoàn thiện ở Pha 2. Đợt này ưu tiên hiển thị đúng nội dung.)_

- [ ] **Step 3: Render tooltip** (trong JSX `ol-canvas`, sau div zoom):

```tsx
      <Show when={tip()}>
        {(t) => (
          <div class="pointer-events-none absolute left-3 bottom-3 z-10 rounded-md border border-line bg-[var(--surface)]/92 px-2.5 py-1 text-[11px] font-mono text-[color:var(--text2)] backdrop-blur">{t().text}</div>
        )}
      </Show>
```

- [ ] **Step 4: Typecheck + e2e**

Run: `cd apps/gis && npm run typecheck && npm run e2e -- editor-context-menu.spec.ts`
Expected: xanh.

- [ ] **Step 5: Commit**

```bash
git add apps/gis/src/pages/gis/editor/ol-canvas.tsx apps/gis/e2e/editor-context-menu.spec.ts
git commit -m "feat(gis): hover tooltip showing pipe id/DN/material in select tool"
```

---

## Self-Review

**Spec coverage (Pha 0 + Pha 1):**
- Lõi action dùng chung `actions.ts` → Task 3, 4, 7 (draw/zoom). ✅
- Hook `onContextMenu` port + adapter + fake-port → Task 1, 2. ✅
- `shortcuts.ts` → Task 5. ✅
- Menu chuột phải 4 ngữ cảnh (empty/pipe/point/multi) → Task 6 (component) + Task 7 (wire, dựng target theo 4 loại). ✅
- Thanh công cụ nổi → Task 8. ✅
- Command palette ⌘K → Task 9. ✅
- Bảng phím tắt `?` + "lặp lại lệnh trước" (Space) → Task 10. ✅
- Tooltip hover ID/DN/vật liệu → Task 11. ✅
- Nối Ribbon vào lõi action (Pha 0) → hiện Ribbon vẫn gọi `setTool` trực tiếp; action `draw-here` đã đi qua `setTool`. Chuyển toàn bộ ribbon sang runAction là dọn dẹp không bắt buộc để menu chạy — để lại cuối Pha 1 (không chặn).

**Placeholder scan:** Còn 2 `TODO` cố ý trong e2e (điều hướng mở editor) vì phụ thuộc helper e2e hiện có — engineer copy setup từ `editor-ribbon.spec.ts`. Mọi bước code khác đều có code đầy đủ.

**Type consistency:** `ActionCtx`/`ActionTarget`/`EditorAction` khai báo ở Task 3, mở rộng ở Task 4 (`onMatch`,`onAttachEam`) — mọi task sau dùng đúng tên. `runAction(id, target, ctx)`, `actionsForTarget(target, ctx)` đồng nhất. `onContextMenu` event `{ featureId, coordinate, pixel }` đồng nhất Task 1→2→7.
