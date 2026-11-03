# GIS — Biên tập mạng lưới: Sửa đỉnh kiểu draw.io (vertex handles)

- **Ngày**: 2026-07-02
- **Codebase**: `water-network/water-network-fe/apps/gis`
- **Trạng thái**: Design — chờ review
- **Thuộc**: Pha 2 (sửa line trực quan) — lát đầu tiên
- **Nối tiếp**: [[gis-editor-interaction]] (Pha 0+1 đã LIVE)

## 1. Vấn đề

Editor OL hiện dùng **OL Modify mặc định**: draft pipe chỉ vẽ đường nét đứt, **không hiện chấm đỉnh** nào cho tới khi rê chuột lên đúng đỉnh/đoạn. Người dùng không thấy đỉnh ở đâu, cũng không biết chèn thêm đỉnh ở đâu → "khó nhìn". Yêu cầu: trải nghiệm **draw.io** — luôn thấy đỉnh, có điểm ảo giữa đoạn để thêm.

## 2. Hành vi mong muốn (draw.io)

Khi **chọn một tuyến ống** (draft `pipe`, op `add` hoặc `mod`):
- **Đỉnh thật**: luôn hiện, **chấm đặc** (vòng accent); **kéo** → di chuyển đỉnh.
- **Điểm ảo**: **chấm mờ** tại trung điểm mỗi đoạn; **kéo** điểm ảo (trên đoạn) → **chèn đỉnh mới** ngay tại đó rồi kéo tiếp.
- **Xoá đỉnh**: **chuột phải trên đỉnh → "Xoá đỉnh"** (chỉ khi còn > 2 đỉnh); hoặc **Alt+click** đỉnh (OL native).
- Handle **tự vẽ lại** sau mỗi lần sửa (cập nhật trung điểm sau khi thả — live-update mid-drag để bản sau).

**Look đã chốt (Variant A "Vòng accent"):**
- Đỉnh thật: circle `radius 4.4`, `fill` = nền theme (`#0C1015` tối / `#fff` sáng), `stroke` = accent, `strokeWidth 2.2`.
- Điểm ảo: circle `radius 3.2`, `color` = accent, `opacity 0.33`.
- Hover: dùng chỉ báo điểm-đang-sửa sẵn có của OL Modify (không cần handle-hover riêng ở v1).

## 3. Kiến trúc (Phương án A — overlay hiển thị + OL Modify)

Tách trách nhiệm: **OL Modify lo tương tác** (kéo đỉnh / chèn khi kéo trên đoạn / Alt+click xoá — đã bền vững, có snapping), **app lo hiển thị** qua một lớp overlay chỉ-vẽ. Overlay nằm trên layer riêng `handles`, KHÔNG bắt sự kiện (Modify hit-test trên layer `draft`), nên hai thứ không giẫm chân nhau.

### 3.1 Hàm thuần (test được) — thêm vào `editor/model.ts`

```ts
export interface VertexHandle { x: number; y: number; kind: 'vertex' | 'mid'; idx: number }
/** Đỉnh thật (idx = chỉ số đỉnh) + trung điểm mỗi đoạn (idx = chỉ số đoạn = đỉnh trước nó). */
export function buildHandles(pts: Pt[]): VertexHandle[]
/** Chỉ số đỉnh gần điểm nhất trong bán kính tol (px), hoặc null. */
export function nearestVertex(pts: Pt[], p: Pt, tol: number): number | null
```
- `buildHandles`: với N đỉnh → N handle `vertex` (idx 0..N-1) + (N−1) handle `mid` (idx i = trung điểm đoạn i→i+1).
- `nearestVertex`: min khoảng cách Euclid tới các đỉnh, trả idx nếu < tol.

### 3.2 `ol-canvas.tsx` — lớp overlay + Modify

- Memo `selectedPipe()` → draft `pipe` đang chọn có `pts` (hoặc null). (Selection string id → draft; nếu là base pipe thì chưa có draft `mod` → không hiện handle cho tới khi vào chế độ sửa tạo `mod` — ngoài phạm vi lát này.)
- `createEffect`: khi `selectedPipe()` đổi hoặc `pts` của nó đổi → `port.setFeatures('handles', fc(buildHandles(pts).map(pointFeat with prop hk)), handleStyle)` + `setLayerVisible('handles', true)`; khi không có → `setFeatures('handles', fc([]))`.
- `handleStyle`: đọc `p.hk` → `vertex` (vòng accent) / `mid` (chấm mờ accent).
- Modify: giữ nguyên `setModifyMode(true)` cho tool `select`. Đảm bảo **Alt+click xoá đỉnh** (OL Modify default `deleteCondition` = click + altKey; nếu bản OL này khác thì set tường minh trong adapter — xem 3.3).
- Sau `onModifyComplete` (đã có) → `onUpdate(pts)` → drafts đổi → memo `selectedPipe().pts` đổi → overlay tự vẽ lại. Không cần cơ chế mới cho v1.

### 3.3 `@wn/map-runtime` (nếu cần)

- Kiểm tra `deleteCondition` mặc định của OL Modify trong bản đang dùng. Nếu **không** phải Alt+click, thêm trong adapter: `new Modify({ source, deleteCondition: (e) => primaryAction(e) && altKeyOnly(e) })`. Đây là thay đổi nhỏ, chỉ trong `openlayers/*`, không đổi hợp đồng port.
- Live-update trung điểm khi đang kéo (mid-drag) cần `onModifyChange` → **để bản sau**, không làm ở lát này.

### 3.4 `editor/actions.ts` — action "Xoá đỉnh"

```ts
{ id: 'delete-vertex', label: 'Xoá đỉnh', icon: 'IcTrash', group: 'geom',
  enabledFor: (t, ctx) => t.kind === 'pipe' && !!targetDraft(t)?.pts && !!ctx.clickPt
    && (targetDraft(t)!.pts!.length > 2)
    && nearestVertex(targetDraft(t)!.pts!, ctx.clickPt!, 12) !== null,
  run: (t, ctx) => { const d = targetDraft(t)!; const i = nearestVertex(d.pts!, ctx.clickPt!, 12)!;
    const pts = d.pts!.filter((_, k) => k !== i);
    ctx.onUpdate(d.id, { pts, lenM: Math.round(edPolyLen(pts) * ED_U2M) }) } }
```
Xuất hiện trong menu chuột phải khi bấm gần một đỉnh của tuyến ống nháp.

## 4. Data flow

Chọn pipe → memo `selectedPipe` → effect vẽ overlay `handles` (đỉnh + trung điểm). Kéo đỉnh/đoạn (OL Modify) → `onModifyComplete` → `onUpdate(pts)` → drafts signal → overlay vẽ lại. Chuột phải gần đỉnh → menu có "Xoá đỉnh" → `runAction('delete-vertex')` → `onUpdate` bỏ đỉnh → overlay vẽ lại. Alt+click đỉnh → OL Modify xoá → `onModifyComplete` → cập nhật.

## 5. Kiểm thử

- **Unit (vitest)**: `buildHandles` (số lượng + vị trí trung điểm + idx đúng), `nearestVertex` (trong/ngoài tol, chọn đỉnh gần nhất), action `delete-vertex` (`enabledFor` gần đỉnh & >2 đỉnh; `run` bỏ đúng đỉnh + tính lại `lenM`).
- **Browser verify (Playwright, như lát Pha 0+1)**: chọn tuyến ống → thấy chấm đỉnh đặc + chấm ảo mờ; kéo đỉnh di chuyển; kéo điểm ảo chèn đỉnh; chuột phải gần đỉnh → "Xoá đỉnh" hoạt động; Alt+click xoá.

## 6. Ngoài phạm vi (lát sau của Pha 2)

- Live-update trung điểm **trong khi** kéo (cần `onModifyChange` ở port).
- Handle-hover phóng to riêng (v1 dựa chỉ báo của OL Modify).
- Sửa đỉnh cho **base pipe** trực tiếp (phải qua tạo draft `mod` trước — luồng riêng).
- Extend/trim/nối 2 đầu ống, đảo chiều nâng cao (các lát khác của Pha 2).

## 7. Rủi ro

- **Overlay che tương tác**: nếu layer `handles` bắt chuột sẽ chặn Modify. Giảm thiểu: layer chỉ render, Modify hit-test trên `draft`; verify kéo vẫn được.
- **deleteCondition khác bản OL**: xác minh Alt+click; set tường minh nếu cần.
- **Trung điểm không live** khi kéo: chấp nhận ở v1 (cập nhật sau khi thả); ghi rõ để tránh hiểu nhầm là lỗi.
