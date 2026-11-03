# Kế hoạch: Editor "Biên tập mạng lưới" trên OpenLayers (nền bản đồ thật) + dữ liệu thật

**Ngày:** 2026-07-01
**Bối cảnh:** Editor SVG synthetic đã port xong & chạy (uncommitted). User yêu cầu: (1) viết lại editor **thuần OpenLayers** với nền tiles thật; (2) dữ liệu thật — **TẠM MOCK** (2026-07-01: chốt làm nền tiles thật trước, dữ liệu mạng vẫn mock nổi trên tiles; Pha B dữ-liệu-thật GÁC LẠI).

---

## 🗺️ PHƯƠNG ÁN TỔNG QUAN (mock data tạm)

**Một câu:** giữ nguyên toàn bộ "bộ não" editor (Draft/rule/change-set/UI), chỉ thay **mặt vẽ** từ SVG tự vẽ sang **OpenLayers có nền bản đồ thật**; dữ liệu mạng vẫn mock, chiếu lên tiles thật qua affine px↔4326.

```
┌───────────────────────── EDITOR SHELL (tái dùng) ─────────────────────────┐
│ ribbon · palette · command line · status bar · branch gate  (chrome.tsx)  │
│ properties · batch · change-set · rule engine        (panels.tsx+model.ts)│
│ state/undo-redo/validate/commit                 (EditorWorkspace giữ nguyên)│
└───────────────┬───────────────────────────────────────────────────────────┘
                │  tool, drafts, selection, callbacks (onAdd/onUpdate/…)
        ┌───────▼────────  ol-canvas.tsx (MỚI — thay canvas.tsx) ────────────┐
        │  MapEnginePort (OpenLayers adapter)                                │
        │   • Basemap tiles THẬT: Carto / OSM / Vệ tinh                      │
        │   • Layer ngữ cảnh (ống/van/nút/DMA gốc — mock) style mờ          │
        │   • Layer DRAFT (add/mod/del)                                      │
        │   • Interactions: Draw / Modify / FeaturePoint / DragBox / Snap    │
        └───────┬────────────────────────────────────────────────────────────┘
                │  geometry 4326  ⇄  px  (affine pxToLonLat ⇄ lonLatToPx)
        ┌───────▼────────  DỮ LIỆU (mock, giữ nguyên) ──────────────────────┐
        │  BFF water-network-gis-bff → /api/gis/full (seed synthetic)        │
        │  toạ độ px synthetic, neo Hà Nội qua affine (Pha B mới đổi 4326)   │
        └────────────────────────────────────────────────────────────────────┘
```

**Nguyên tắc chốt:**
1. **Model Draft vẫn theo px** → `model.ts`/rules/chrome/panels **KHÔNG đổi**; ol-canvas dịch qua lại 4326↔px ở biên.
2. **Nền thật, data mock** → ống mock "nổi" trên bản đồ Hà Nội (chưa khớp phố — đúng bản chất, tới Pha B mới khớp).
3. **Đủ parity** → mở rộng `@wn/map-runtime` port (DragBox/OSNAP-modes/ORTHO), giữ backward-compat cho viewer.

**3 khối việc lớn:**
| Khối | Nội dung | Chạm |
|---|---|---|
| **1. Port** | thêm DragBox chọn-vùng · OSNAP-modes chi tiết · ORTHO · affine nghịch `lonLatToPx` | `packages/map-runtime` (dùng chung) |
| **2. ol-canvas** | controller OL: mount+basemap, render context/draft, ánh xạ tool→interaction, 4326↔px | `apps/gis/.../editor/ol-canvas.tsx` (mới) |
| **3. Wire** | thay `<EditorCanvas>`→`<EditorOLCanvas>` trong `EditorWorkspace`, bỏ prop chỉ-SVG | `screens/editor.tsx` |

**Ngoài phạm vi (gác lại):** Pha B — dữ liệu mạng lưới thật + refactor toạ độ px→4326 (chờ nguồn dữ liệu B0).

---

**Tham khảo trước đó:** plan editor gis-core cũ trên OL (`2026-06-16-gis-core-editor-topology-modify.md`, `...-connect-node-pipe.md`, `...-split-pipe.md`) — gis-core đã bị thay bằng rebuild nhưng ý tưởng OL editing tái dùng được.

## Khảo sát hạ tầng (đã xác minh)
- `@wn/map-runtime` `MapEnginePort` đã có: `setDrawMode('LineString'|'Point')`+`onDrawComplete`, `setModifyMode`+`onModifyComplete`, `setFeaturePointMode`+`onFeaturePointPick` (đặt điểm trên feature → van/tách ống), `setFeatures/setLayerStyle/setSelection/onFeatureClick/onPointerMove/setLayerVisible/setBasemap/fitToBbox/setView`.
- **Snap tích hợp sẵn** trong `ol-map-adapter` (`#syncSnap` dựng Snap trên mọi vector source khi draw/modify) → OSNAP nút/đỉnh/tim-ống gần như free.
- `network-map-ol.tsx` đã có sẵn: mount runtime, basemap picker (Carto/OSM/Vệ tinh), FeatureCollection builders `pxToLonLat`, focus theo bbox — TÁI DÙNG.
- Affine `pixel-affine.ts` chỉ có chiều xuôi `pxToLonLat`; **cần thêm `lonLatToPx`** (nghịch, đại số thuần) để đổi geometry vẽ trên OL về px cho model Draft.

## Tái dùng nguyên vẹn (KHÔNG sửa)
- `editor/model.ts` — types Draft, rule engine `edRules`, templates, geometry, `edDmaAt`, `genImportFeatures`.
- `editor/chrome.tsx` — ribbon, palette, command line, status bar, branch gate, COGO.
- `editor/panels.tsx` — PropBody, BatchBody, ChangeSetPane, EamModal, ImportToEditorModal.
- `screens/editor.tsx` `EditorWorkspace` — toàn bộ state/undo-redo/commit/validate; chỉ **thay `<EditorCanvas>` → `<EditorOLCanvas>`** và điều chỉnh vài prop.

---

## Pha A — Editor trên OpenLayers (nền thật) — MỤC TIÊU: ĐỦ PARITY với editor SVG
> Quyết định 2026-07-01: làm **đủ parity ngay** → chấp nhận mở rộng package dùng chung `@wn/map-runtime` (thêm bước A0) thay vì rút gọn.

**A0. Mở rộng `@wn/map-runtime` port (package dùng chung — làm TRƯỚC):**
- `DragBox` chọn vùng: thêm `setBoxSelectMode(enabled)` + `onBoxSelect(cb: (featureIds: string[], extent) => void)` (dùng `ol/interaction/DragBox`).
- OSNAP chi tiết: cho bật/tắt snap theo nguồn/loại (nút / đỉnh / tim-ống) — tham số hoá `#syncSnap` (hiện bật tất). Thêm `setSnapModes({node,vertex,edge})`.
- ORTHO (khoá góc 45°): thêm tuỳ chọn cho draw (dùng `geometryFunction`/`ol/interaction/Draw` với ràng buộc, hoặc hậu xử lý coords). `setDrawConstraint('ortho'|null)`.
- Preview realtime khi draw (đo chiều dài đang vẽ): dùng `onDrawChange`/style sketch nếu cần.
- Cập nhật `testing/fake-port.ts` cho các API mới + test adapter.
- ⚠️ Đây là package dùng chung (viewer cũng dùng) — thêm API mới **không phá vỡ** API cũ; chạy full test map-runtime + apps/gis.

**A1. Affine nghịch** — `packages/map-runtime/src/pixel-affine.ts`: thêm `pxFromLon/pxFromLat/lonLatToPx`, export ở `index.ts`, + test (round-trip pxToLonLat∘lonLatToPx ≈ identity).

**A2. `editor/ol-canvas.tsx`** (thay `canvas.tsx`, cùng "hợp đồng" prop):
- Mount `createMapRuntime` như network-map-ol; view neo Hà Nội; basemap picker.
- Render **layer ngữ cảnh** (ống/van/nút/DMA gốc) từ dữ liệu — tái dùng FC builders của network-map-ol; style mờ (ctxPipe) + đánh dấu del/mod theo drafts.
- Render **layer draft** (add/mod) style add/mod/del như thiết kế.
- Toạ độ đọc: `onPointerMove` → lonLat → `lonLatToPx` → hiển thị X/Y px ở status bar (giữ nguyên UX).

**A3. Ánh xạ công cụ → tương tác OL:**
- `select`: `onFeatureClick` → chọn draft/gốc; `setSelection`.
- `pipe`: `setDrawMode('LineString')` → `onDrawComplete(geom)` → coords lonLat→px → tạo Draft pipe (reuse `defaults`, `edDmaAt`, `edPolyLen`).
- `valve/hydrant/node`: `setDrawMode('Point')` (Snap tự bắt) → Draft point; nếu đặt trên tuyến dùng `setFeaturePointMode` để lấy `onFeaturePointPick(featureId, point)` → `onPipe`.
- `split`: `setFeaturePointMode` trên layer ống → chèn nút tách tại điểm bắt.
- reshape (kéo đỉnh): `setModifyMode(true)` + `onModifyComplete(id, geom)` → cập nhật Draft.pts.
- `delete`: `onFeatureClick` khi tool=delete → onDeleteAt.

**A4. Thao tác CAD (ĐỦ PARITY — dùng port mở rộng ở A0):**
- `offset` (song song): tính JS từ ống đang chọn (reuse `edOffsetPts`) → thêm Draft.
- `merge` (gộp): JS từ 2 draft ống chung đầu (logic đã có).
- `match` (sao chép thuộc tính): 2 lần `onFeatureClick` (nguồn→đích).
- `window` (chọn vùng nhiều): dùng `setBoxSelectMode`+`onBoxSelect` (A0) → multiSel → sửa hàng loạt.
- OSNAP chi tiết (nút/đỉnh/tim): dùng `setSnapModes` (A0), map thẳng từ palette hiện có.
- ORTHO: `setDrawConstraint('ortho')` (A0) theo status-bar toggle.

**A5. Wire** vào `EditorWorkspace`: thay canvas, bỏ các prop chỉ dành SVG (viewBox/focusKey→dùng `fitToBbox`), giữ toàn bộ đường commit/rule/changeset.

**A6. Kiểm thử/deploy:** unit test affine nghịch + smoke render ol-canvas (mock port qua `testing/fake-port`); build; deploy gis-dev.

**Rủi ro Pha A (đã chọn ĐỦ PARITY):** phải mở rộng package dùng chung `@wn/map-runtime` (A0: DragBox/OSNAP-modes/ORTHO). Rủi ro = chạm package viewer cũng dùng → giữ backward-compat, chạy full test map-runtime + gis. Đổi lại editor OL đạt **parity ~100%** với editor SVG ngay bản đầu.

---

## Pha B — Dữ liệu mạng lưới thật (CẦN INPUT)

Hiện dữ liệu là mock tự sinh (px synthetic → affine neo HN). Muốn khớp thực địa cần:
- **B0 (chặn):** Nguồn dữ liệu thật là gì? (a) export GIS sẵn có của đơn vị (Shapefile/GeoJSON/GDB)? (b) dữ liệu khảo sát RTK? (c) DMA/tuyến ống thật từ hệ thống nào? — **cần bạn cung cấp/định nghĩa.**
- **B1:** Đổi mô hình toạ độ: bỏ affine synthetic, lưu **EPSG:4326 thật** trong seed BFF (`water-network-gis-bff`). Model Draft chuyển từ px → lon/lat (ảnh hưởng `edPolyLen` theo mét thật, `edDmaAt` theo polygon thật, tolerance snap theo mét). Đây là refactor sâu hơn Pha A.
- **B2:** Pipeline import (GeoJSON/Shapefile → seed) + kiểm định topology.
- **B3:** Editor lưu/commit theo geo thật; đồng bộ Hydraulic/DMA/EAM như thiết kế.

**Rủi ro Pha B:** phụ thuộc nguồn dữ liệu ngoài; refactor toạ độ chạm nhiều nơi. Nên làm SAU khi Pha A ổn.

### Pha B — thiết kế chi tiết (B0 đã chốt 2026-07-01: **GeoJSON, lấy từ hệ thống/API nội bộ**)

**Pipeline hiện tại (mock):** `scripts/gen-gis-seed.mjs` đọc `_design/gis-data.js` (synthetic px) → affine px→4326 → FeatureCollections (pipe LineString / valve·node·hydrant Point / dma Polygon) → `gis-seed.json` (BFF) + `gis-full.json` (FE `/full`). ⚠️ FE `GisData.pipes.pts` HIỆN là **px**; OL viewer/editor đổi px↔4326 qua affine.

**Hai hướng tích hợp dữ liệu thật:**
- **B-nhanh (interim):** giữ FE model theo px, dùng `lonLatToPx` đổi 4326 thật→px khi seed. Nhanh, KHÔNG đụng FE, nhưng px thành vô nghĩa + affine phải neo đúng vùng thật (đổi LON0/LAT0). Chấp nhận tạm.
- **B-chuẩn (đề xuất):** refactor bỏ px, FE/BFF/editor lưu **EPSG:4326 thật**. Chạm: `gis-data.tsx` (pts→lon/lat), `edPolyLen`→mét thật (dùng `ol/sphere` hoặc haversine), `edDmaAt`→point-in-polygon thật, tolerance snap theo mét, ol-canvas bỏ `lonLatToPx` (geometry đã là 4326). Lớn hơn nhưng đúng.

**Mapping GeoJSON→seed (contract — CẦN field từ nguồn):**
| Seed field | Từ GeoJSON | Bắt buộc |
|---|---|---|
| geometry | LineString(ống) / Point(van·nút·trụ·nguồn) / Polygon(DMA), EPSG:4326 | ✅ |
| id, code | `id`/`properties.code` | ✅ |
| kind/assetType | pipe·valve·hydrant·node·dma·pump·reservoir·plant | ✅ |
| dma | `properties.dma` (mã vùng) | nên có |
| pipe: dn, material, cond, trunk, year, status | `properties.*` | dn/material nên có |
| valve: dn, vkind(gate/butterfly/boundary/air), state(open/closed) | `properties.*` | vkind nên có |
| node: z (cao độ) | `properties.z` | tuỳ |

**Import pipeline mới (khi có nguồn):** `scripts/import-gis-geojson.mjs` — fetch API (hoặc đọc file) → validate schema → map theo bảng trên → emit `gis-seed.json` (+ `gis-full.json` FE). Thay `_design/gis-data.js` làm nguồn. BFF (`water-network-gis-bff`) reload seed.

**⛔ CẦN từ bạn để bắt đầu code Pha B:**
1. **Endpoint API** (URL) + **cách auth** (token/basic/none) của hệ thống chứa GeoJSON, HOẶC **1 file GeoJSON mẫu**.
2. **1 feature mẫu mỗi loại** (ống/van/nút/DMA) để chốt tên `properties.*` thật (dn/material/dma/… tên field gì).
Không có (1)+(2) thì mọi code import/refactor là đoán mò → dễ phải làm lại. Có sample là tôi wire được ngay.

---

## Quyết định đã chốt (2026-07-01)
- Pha A: **ĐỦ PARITY** ngay → gồm A0 mở rộng `@wn/map-runtime` port.
- Data: mock tạm; Pha B (dữ liệu thật) gác lại chờ B0.

## Tiến độ
- ✅ **Khối 1 — mở rộng port (A0+A1) XONG 2026-07-01** (`packages/map-runtime`, đã build dist):
  - Affine nghịch `lonLatToPx`/`lonToPx`/`latToPx` (+ test round-trip).
  - Port `MapEnginePort` thêm: `setBoxSelectMode`/`onBoxSelect` (DragBox), `setSnapModes` (SnapModes node/vertex/edge → OL Snap vertex/edge), `setDrawConstraint('ortho'|null)` (geometryFunction khoá 45°). Types `SnapModes`/`DrawConstraint` export ở index.
  - Adapter OL cài đặt đầy đủ; `fake-port.ts` cập nhật + `emitBoxSelect`; giữ backward-compat.
  - Verify: map-runtime tsc sạch + 35 test PASS; apps/gis tsc KHÔNG lỗi mới (18 pre-existing) + 129 test PASS.
- ✅ **Khối 2 — `editor/ol-canvas.tsx` XONG 2026-07-01**: controller OL cùng hợp đồng prop với EditorCanvas. Mount `createMapRuntime` + basemap picker (Carto/OSM/Vệ tinh) + zoom/fit; render layer `ctx` (pipe/valve/node/dma mock, style mờ + đánh dấu del/mod) & layer `draft` (add, style add/mod/imported + halo chọn) qua StyleSpec; pointer readout lonLat→px. Ánh xạ tool→interaction: select=Modify+click, pipe=Draw LineString(+ortho), valve/hydrant/node/split=Draw Point (split/onPipe = nearestPipe px), window=DragBox→onMulti, delete/match/merge/offset=onFeatureClick (offset side theo lastPointerPx). Đổi geometry OL 4326→px bằng `lonLatToPx`. snap/snapModes→`setSnapModes`; focusKey→`fitToBbox`.
- ✅ **Khối 3 — wire XONG 2026-07-01**: `screens/editor.tsx` thay `<EditorCanvas>`→`<EditorOLCanvas>` (canvas.tsx GIỮ làm nguồn type + fallback). tsc editor sạch, build OK, 129 test PASS.
- ✅ **Verify trình duyệt 2026-07-01**: login→editor→bản trắng → **nền bản đồ Hà Nội THẬT (Carto Light)** + mạng overlay; vẽ ống DN200 → panel thuộc tính + change set cập nhật; **0 console error**.

### Còn tinh chỉnh (parity phụ, không chặn)
- GRID snap của status-bar chưa nối OL (grid là app-side; OL không có) — chấp nhận.
- Preview đo chiều dài realtime khi đang vẽ (OL Draw có sketch nhưng chưa gắn số đo) — bổ sung sau nếu cần.
- Overlay hint/painter/locked của EditorWorkspace nằm đè lên map (absolute) — OK, có thể tinh chỉnh vị trí tránh trùng basemap picker.

## Thứ tự đề xuất
1. User rà plan + trả lời **B0** (nguồn dữ liệu thật) — B0 chỉ chặn Pha B, KHÔNG chặn Pha A.
2. Pha A (editor OL nền thật, đủ parity): A0 port → A1 affine nghịch → A2–A5 ol-canvas + wire → A6 test/deploy. Data mock nổi trên tiles thật.
3. Pha B khi có nguồn dữ liệu (refactor toạ độ px→4326 thật).

## Câu hỏi chặn còn lại
- **B0 (cho Pha B):** Dữ liệu mạng lưới thật lấy từ đâu / định dạng gì? (Shapefile/GeoJSON/GDB export? RTK? nguồn hệ thống nào?)
- Ước lượng công sức Pha A (đủ parity): A0 port ~1 phần, A2–A5 ol-canvas ~phần lớn, A6 test/deploy. Nhiều hơn đáng kể so với port SVG vừa làm.
