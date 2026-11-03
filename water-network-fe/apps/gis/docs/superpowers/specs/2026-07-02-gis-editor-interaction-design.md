# GIS — Biên tập mạng lưới: Nâng cấp tương tác editor

- **Ngày**: 2026-07-02
- **Codebase**: `water-network/water-network-fe/apps/gis`
- **Trạng thái**: Design — chờ review
- **Phạm vi**: Menu chuột phải ngữ cảnh + thanh công cụ nổi (A), sửa line trực quan (B),
  giảm ma sát thao tác (C), trí tuệ mạng nước (Tier 1), năng suất biên tập (Tier 2),
  CAD precision (Tier 3).

## 1. Bối cảnh & vấn đề

Editor hiện tại (`src/pages/gis/editor/*`) chạy theo mô hình **"chọn tool rồi click"**:
11 công cụ trên ribbon/palette (`ED_TOOLS` trong `model.ts`), canvas thật là OpenLayers
(`ol-canvas.tsx`) qua `@wn/map-runtime`. Đã có: vẽ ống, đặt van/trụ/nút, tách/gộp/offset,
match thuộc tính, xoá, chọn khung → sửa hàng loạt, sửa đỉnh (modify), undo/redo, dòng lệnh
kiểu CAD, snap/ortho/grid, rule engine (`edRules`), EAM, COGO, import, change set/commit.

**Điểm đau**:
- Muốn làm gì cũng phải sang thanh công cụ đổi tool trước → nhiều thao tác thừa.
- Không có menu chuột phải; `MapEnginePort` chưa có hook `contextmenu`.
- Thiếu thao tác line nâng cao (đảo chiều, thêm/xoá đỉnh chủ đích, extend/trim, nối đầu).
- Thiếu các tính năng đặc thù cấp nước (phân tích cô lập/đóng van, truy vết, quick-fix rule).

**Triết lý chốt**: **Select-first**. Mặc định luôn ở tool "Chọn"; phần lớn thao tác thực hiện
qua chuột phải + thanh nổi + command palette. Ribbon trở thành phụ (chủ yếu để vẽ mới).

## 2. Nguyên tắc kiến trúc

### 2.1 Lõi hành động dùng chung — `editor/actions.ts`

Vấn đề: nếu menu, thanh nổi, palette, phím tắt, ribbon mỗi cái tự gọi logic riêng thì trùng
lặp và lệch hành vi. Giải pháp: **một registry action duy nhất**.

```ts
export interface ActionCtx {
  G: GisData
  drafts: Draft[]
  defaults: EditorDefaults
  offsetDist: number
  clickPt?: Pt            // toạ độ chuột phải (world px)
  // dispatch trở lại workspace:
  onAdd: (f: Draft) => void
  onUpdate: (id: string, patch: Partial<Draft>) => void
  onRemove: (id: string) => void
  onDeleteAt: (hit: Hit) => void
  onSelect: (s: CanvasSel) => void
  onMulti: (ids: string[]) => void
  setStatus: (s: string | null) => void
  toast: (msg: string, kind?: string) => void
  setTool: (t: string) => void
}

export type ActionTarget =
  | { kind: 'empty'; pt: Pt }
  | { kind: 'pipe'; hit: Hit }
  | { kind: 'point'; hit: Hit }      // valve/hydrant/node
  | { kind: 'multi'; ids: string[] }

export interface EditorAction {
  id: string
  label: string
  icon: string                       // tên icon (dùng thunk khi render — SolidJS)
  kbd?: string                       // phím tắt hiển thị
  group?: string                     // để gom nhóm + kẻ separator
  danger?: boolean
  quick?: boolean                    // có xuất hiện trên thanh nổi không
  enabledFor: (t: ActionTarget, ctx: ActionCtx) => boolean
  run: (t: ActionTarget, ctx: ActionCtx) => void
}

export const EDITOR_ACTIONS: EditorAction[]
export function actionsForTarget(t: ActionTarget, ctx: ActionCtx): EditorAction[]
```

**5 lối vào cùng gọi 1 action**: Ribbon · Menu chuột phải · Thanh nổi · Command palette (⌘K)
· Phím tắt. Menu/thanh nổi render bằng `actionsForTarget()` nên tự lọc lệnh hợp lệ theo ngữ cảnh.

Các action ban đầu bọc lại logic **đã có** trong `ol-canvas.tsx`/`editor.tsx` (split, offset,
match, delete, merge, batch, EAM…) — không viết lại, chỉ đổi lối gọi. Undo/redo giữ nguyên
(`pushHist` trong workspace) vì mọi mutation vẫn đi qua `onAdd/onUpdate/onRemove`.

### 2.2 Mở rộng `@wn/map-runtime` — chuột phải

Thêm vào `MapEnginePort` (giữ nguyên "zero `ol` types cross the port"):

```ts
/** Chuột phải: hit-test tại pixel, trả feature (nếu trúng) + toạ độ lon/lat. */
onContextMenu(cb: (ev: { featureId: string | null; coordinate: Coordinate; pixel: [number, number] }) => void): () => void
```

Adapter OpenLayers dùng `map.forEachFeatureAtPixel` + `getEventCoordinate`, `preventDefault`
sự kiện `contextmenu` gốc. Cập nhật `fake-port.ts` (thêm `emitContextMenu`) + test port.

Tô màu chuyên đề (Tier 2) và nhãn tái dùng `StyleSpec`/`setLayerStyle` sẵn có — **không** thêm
API mới cho việc này.

### 2.3 Module mới (tách bạch, test độc lập)

| Module | Trách nhiệm |
|---|---|
| `editor/actions.ts` | Registry action + `enabledFor` (2.1) |
| `editor/network-trace.ts` | Đồ thị pipe/node/valve; isolation trace + upstream/downstream |
| `editor/quick-fix.ts` | Mở rộng `RuleIssue` với `fix(ctx)`; sinh draft sửa vi phạm |
| `editor/shortcuts.ts` | Bảng phím tắt → action id; đăng ký/gỡ listener |
| `editor/ui/context-menu.tsx` | Menu Portal, render từ `actionsForTarget` |
| `editor/ui/floating-toolbar.tsx` | Thanh nổi cạnh selection (action `quick`) |
| `editor/ui/command-palette.tsx` | ⌘K fuzzy + bảng phím tắt (`?`) |
| `editor/ui/attribute-table.tsx` | Bảng thuộc tính draft (sort/lọc/sửa inline) |

⚠️ **SolidJS (không phải React)**: menu/palette/thanh nổi là overlay → **bắt buộc `<Portal>`**;
helper icon dùng **thunk `() => JSX.Element`**, không tái dùng node JSX. (Tránh regress icon
trống + modal lệch đã từng gặp.)

## 3. Giai đoạn

Mỗi pha ship + test độc lập. Pha 0 là tiền đề.

### Pha 0 — Nền tảng
- `actions.ts` với `enabledFor`, bọc các lệnh hiện có.
- Hook `onContextMenu` cho port + adapter OL + `fake-port` + test.
- `shortcuts.ts`; nối Ribbon hiện tại vào lõi action (hành vi không đổi — kiểm chứng bằng e2e cũ).

### Pha 1 — Bề mặt tương tác (A + C)
- `ContextMenu` (Portal) với 4 ngữ cảnh: nền trống · ống · điểm · chọn nhiều.
- `FloatingToolbar` nổi phía trên selection: 5–6 action `quick` + nút `⋯` mở menu đầy đủ.
- `CommandPalette` ⌘K (fuzzy tìm mọi action) + overlay bảng phím tắt khi nhấn `?`.
- Tooltip hover hiện ID/DN/vật liệu; lệnh "lặp lại lệnh trước" (Space/Enter).

**Nội dung menu theo ngữ cảnh** (đã duyệt qua mockup):
- *Nền trống*: Vẽ ống từ đây · Đặt van/trụ/nút tại đây ▸ · Nhập toạ độ (COGO) · Phóng toàn mạng ·
  Bật/tắt lớp ▸ · Dán.
- *Ống*: Sửa thuộc tính · Tách tại điểm bấm · Vẽ song song… · Đảo chiều · Thêm/xoá đỉnh ·
  Chèn van/nút lên ống ▸ · Lấy mẫu (match) · Nhân bản · Gắn EAM · Đánh dấu xoá.
- *Điểm*: Sửa thuộc tính · Đổi loại ▸ · Di chuyển tới toạ độ… · Lấy mẫu · Gắn EAM · Xoá.
- *Chọn nhiều*: Sửa hàng loạt · Gán mẫu cho tất cả ▸ · Gắn EAM hàng loạt · Đảo chiều tất cả ·
  Lấy mẫu 1→gán nhóm · Xoá tất cả.

### Pha 2 — Sửa line trực quan (B)
- Khi chọn tuyến: hiện tay cầm đỉnh + điểm giữa "thêm đỉnh"; kéo có snap (đã có modify — bổ sung
  affordance thêm/xoá đỉnh).
- Xoá đỉnh (chuột phải trên đỉnh / phím) · đảo chiều tuyến.
- Extend/Trim tới giao điểm · nối 2 đầu ống rời (tạo đoạn nối/tê).
- Nhãn chiều dài + hướng (bearing) sống động khi sửa (tái dùng `edPolyLen`, `edBearing`).

### Pha 3 — Trí tuệ mạng nước (Tier 1)
- `network-trace.ts`: dựng đồ thị từ `G.pipes/nodes/valves`; **isolation trace** (tập van tối
  thiểu để cô lập 1 tuyến + đếm đoạn/đối tượng ảnh hưởng); **upstream/downstream trace**.
- Kết quả trace tô sáng qua layer riêng (`setFeatures('trace', …)`).
- `quick-fix.ts`: mỗi `RuleIssue` (dangling, thiếu van biên, chênh DN) gắn `fix()` → nút "Sửa
  ngay" trong bảng vi phạm và trong menu: tự nối đầu ống, tự đặt van biên tại ranh DMA, tự chèn
  côn thu tại điểm chênh DN.
- Auto-connect: khi kéo/thả đầu ống chạm ống khác → tự tách + tạo nút tê (không để dangling).

### Pha 4 — Năng suất (Tier 2)
- Chọn theo thuộc tính (DN/vật liệu/DMA/điều kiện) → nạp vào multi-select.
- `AttributeTable`: bảng draft, sort/lọc/sửa inline, click hàng → chọn + phóng tới đối tượng.
- Công cụ đo (khoảng cách/diện tích) — layer tạm, không tạo draft.
- Nhãn (DN/vật liệu/ID) + tô màu chuyên đề (theo DN/tình trạng/tuổi) qua `StyleSpec`.

### Pha 5 — CAD precision (Tier 3)
- Nhập động khi vẽ: gõ chiều dài + góc/bearing đặt đỉnh chính xác.
- Trim/Extend; di chuyển/xoay/nhân bản mảng (offset array).
- Thêm OSNAP: điểm giữa, vuông góc, giao điểm, gần nhất (mở rộng `SnapModes`).
- Diff overlay với bản gốc (tô thêm/sửa/xoá).
- Auto-save draft (localStorage) + khôi phục khi mở lại.

## 4. Data flow

Chuột phải trên canvas → adapter `onContextMenu` → `ol-canvas` dựng `ActionTarget` (hit-test
draft/base + `clickPt`) → `EditorWorkspace` mở `ContextMenu` với `actionsForTarget(target, ctx)`
→ chọn lệnh → `action.run(target, ctx)` → mutation qua `onAdd/onUpdate/onRemove` (đã có
`pushHist` cho undo) → rule engine `edRules` chạy lại (memo) → change set cập nhật.

Thanh nổi, palette, phím tắt đi qua **cùng** `action.run`. Không có nhánh logic song song.

## 5. Kiểm thử (TDD)

- **Unit (vitest)**: `actions.ts` (`enabledFor` đúng ngữ cảnh, `run` sinh draft đúng),
  `network-trace.ts` (isolation cho mạng mẫu, upstream/downstream), `quick-fix.ts` (mỗi fix
  giải quyết đúng issue), `shortcuts.ts`.
- **Port (vitest)**: `onContextMenu` phát đúng `{featureId, coordinate}`; fake-port emit.
- **E2E (Playwright, `apps/gis/e2e`)**: chuột phải → menu đúng nội dung theo ngữ cảnh; thanh nổi
  hiện khi chọn; ⌘K chạy 1 action; isolation trace tô sáng; quick-fix xoá được 1 lỗi.
- Regress: e2e ribbon/tool hiện có phải vẫn xanh sau khi nối vào lõi action.

## 6. Ngoài phạm vi (YAGNI đợt này)

- Multi-user real-time / spatial edit-lock, comment pins (để đợt sau).
- Import CAD (DWG/DXF) — đã có spec riêng ở `water-network-be`.
- Undo tree phân nhánh (giữ undo/redo tuyến tính hiện có).

## 7. Rủi ro

- **Chạm `@wn/map-runtime`** ảnh hưởng MFE khác (ioc…). Giảm thiểu: chỉ *thêm* method, không đổi
  method cũ; cập nhật `fake-port` + test cùng lúc.
- **SolidJS overlay**: sai Portal/thunk → icon trống/menu lệch. Có lưu ý mục 2.3, kiểm bằng e2e.
- **Phạm vi lớn**: 6 pha — cắt ship theo pha, mỗi pha một plan riêng.
