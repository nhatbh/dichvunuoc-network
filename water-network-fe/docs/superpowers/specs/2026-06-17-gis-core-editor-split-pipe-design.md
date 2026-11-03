# GIS Core — Editor Split pipe (design)

- **Ngày**: 2026-06-17
- **Trạng thái**: Đã thống nhất design, chờ review spec trước khi viết implementation plan
- **Story**: US-002 GIS Core (Viewer + Editor) — **slice 2.3b-2** (lát topology đầu tiên, tách ra từ "2.3 Editor core")
- **Mô hình**: fleet-SPA, FE độc lập hoàn toàn với BE (auth `mock`, data MSW) —
  xem `docs/decisions/0009-fe-fleet-via-core-template.md` + `0010-shell-platform-app-catalog.md`
- **Tham chiếu**: spec 2.3b `2026-06-16-gis-core-editor-topology-modify-design.md` (snap + geometry-modify
  đã ship, merged `8b318d2`); spec 2.3a digitize (`d56228f`); shared test factory `createFakePort` (`4baadd2`).

---

## 1. Bối cảnh & mục tiêu

"2.3 Editor core" = digitize (2.3a) + **topology** + attribute-edit. Topology vốn gộp snap +
geometry-modify + split + connect + classify-crossing. 2.3b đã làm **tầng tương tác map**
(snap + geometry-modify): cố định seam modify/update (`setModifyMode`/`onModifyComplete`, command
PATCH geometry, `ol/Modify`+`ol/Snap` trong adapter). 2.3b để lại **tầng topology domain** cho 2.3b-2.

Bản thân topology domain (split + connect + classify-crossing) là **3 thao tác độc lập** khác nhau cả
hình học, command lẫn UI. Theo kỷ luật lát-mỏng, **chẻ tiếp**: slice này (**2.3b-2**) chỉ làm
**Split pipe**. Connect node↔pipe → 2.3b-3; classify-crossing → 2.3b-4.

**Mục tiêu slice (Done khi):**

1. Toolbar có chế độ **Split**: bật → click lên 1 pipe **draft** tại vị trí cần cắt.
2. Click → adapter hit-test pipe + chiếu điểm click lên line → gọi **command `SplitPipe`**
   (MSW mock, CQRS, POST) → working-set thay pipe gốc bằng **2 pipe** → đọc lại qua query →
   plane `draft` re-render 2 pipe.
3. Split là thao tác **lặp** (như Modify): không reset mode sau mỗi lần cắt.
4. Tất cả gates xanh (typecheck/lint/test/size); `ol` (hit-test + closestPoint) **chỉ** nằm trong
   adapter lazy → vẫn ở chunk `ol-map-adapter-*`, `index` không phình.

**Trong phạm vi:** chế độ Split (pick 1 điểm trên 1 pipe) · 2 port-method generic
`setFeaturePointMode`/`onFeaturePointPick` · command `SplitPipe` mock (POST) · contract
`SplitPipeRequest` · output **đúng 2 pipe** (không node).

> **Ngoài phạm vi (slice sau):** node/junction tại điểm cắt (Connect, 2.3b-3) · connect node↔pipe
> (2.3b-3) · classify-crossing (2.3b-4) · sửa published / copy-on-write / lineage (2.4) ·
> optimistic-concurrency (`expectedStreamVersion`/`409`), panel `422` (2.4) · undo split ·
> snap toggle UI + tolerance config · split nhiều pipe một lần · attribute-edit (2.3c) ·
> continuity Viewer↔Editor (2.5) · BE thật / Keycloak thật.

## 2. Quyết định kiến trúc cốt lõi

**(a) Chỉ pipe `draft` cắt được; `published` read-only.** Hit-test trong split chỉ nhắm **draft
source**. Nhất quán với 2.3b ("chỉ draft sửa được"). Không đẻ override/lineage (2.4).

**(b) Split geometry tính ở MSW mock, KHÔNG ở FE.** Command `SplitPipe { atPoint }`; mock đọc
working-set, tìm segment, tách `coordinates` thành 2 → thay pipe gốc bằng 2 pipe. FE giữ mỏng,
**không** ôm geometry-domain. Khớp đúng DDD/CQRS của BE (pattern 2.3a/2.3b: command là seam, mock
giữ working-set + áp thay đổi).

**(c) Port-method domain-agnostic — giữ invariant.** Split là khái niệm domain → **không** lộ ra port.
Port chỉ thêm 2 method generic "pick 1 điểm trên 1 feature" (`setFeaturePointMode`/`onFeaturePointPick`);
gis-core map `(featureId, point)` → `SplitPipe`. Tổng quát hoá nằm ở **tên domain-agnostic + tái dùng**
(Connect 2.3b-3 dùng lại để pick điểm trên pipe), **không** ở method nhiều tham số (tránh over-generalize,
giữ kỷ luật "+2 method/slice" như 2.3a/2.3b).

**(d) Output đúng 2 pipe, KHÔNG tạo node.** Điểm cắt là endpoint trùng nhau của 2 pipe. Khái niệm
junction/node là mối quan tâm của Connect (2.3b-3).

**(e) Split là thao tác lặp — KHÔNG reset mode sau mỗi lần cắt.** Như Modify (2.3b §2d), khác digitize.
Giữ mode để cắt tiếp tới khi user tự tắt.

## 3. `@wn/map-runtime` — port thêm đúng 2 method generic

```typescript
// packages/map-runtime/src/port/map-engine-port.ts (append vào interface)
/** Bật/tắt chế độ "pick 1 điểm trên 1 feature": click tới sẽ hit-test feature (draft)
 *  và trả điểm click đã được chiếu (snap) lên hình học của feature đó. */
setFeaturePointMode(enabled: boolean): void;
/** Đăng ký pick; cb nhận (featureId, point lon/lat đã nằm trên feature). Trả unsubscribe. */
onFeaturePointPick(cb: (featureId: string, point: Coordinate) => void): () => void;
```

- **Kiểu `point`**: dùng `Coordinate` (`{ lon, lat }`, EPSG:4326) — nhất quán với `onPointerMove`
  (point là 1 vị trí, không phải hình học tuỳ ý). gis-core gói thành GeoJSON Point cho command (§6).
- **Adapter (`openlayers/ol-map-adapter.ts`)**:
  - `setFeaturePointMode(true)` → gắn click handler: `forEachFeatureAtPixel` trên **draft layer** lấy
    pipe dưới con trỏ → `geometry.getClosestPoint(clickCoord3857)` (chiếu lên line) → transform
    3857→4326 → gọi các sub đã đăng ký qua `onFeaturePointPick(featureId, point)`. Click không trúng
    pipe nào → no-op.
  - `setFeaturePointMode(false)` → gỡ click handler.
  - Loại trừ lẫn nhau với draw/modify do gis-core điều phối qua store mode (§6); adapter không tự ràng.
  - `featureId` lấy từ `olFeature.getId()` — `setFeatures` đã `setId` từ 2.3b (tái dùng).
  - `ol` (forEachFeatureAtPixel, getClosestPoint, transform) **chỉ** trong adapter lazy → chunk
    `ol-map-adapter-*`, không rò `index`.
- **`createFakePort`** (`packages/map-runtime/src/testing/fake-port.ts`): thêm `setFeaturePointMode: vi.fn()`,
  `onFeaturePointPick` (wire vào Set + emit), và helper `emitFeaturePointPick(id, point)`. Vì đã có
  factory dùng chung (`4baadd2`), **chỉ sửa 1 chỗ** — 11 test fake tự cập nhật.

## 4. `@wn/contracts` — command split pipe

```typescript
// packages/contracts/src/draft/index.ts (append)
export const SplitPipeRequest = z.object({
  atPoint: NetworkGeometry,            // Point (EPSG:4326), đã nằm trên line pipe
  correlationId: z.string(),           // envelope command; chưa dùng expectedStreamVersion
});
export type SplitPipeRequest = z.infer<typeof SplitPipeRequest>;
```

Response tái dùng `DraftNetworkFeature` — trả **mảng 2** `DraftNetworkFeature` (2 pipe mới, id mới,
`kind='pipe'`, props kế thừa pipe gốc). Build contracts để gis-core thấy export. Không cần builder mới
(tái dùng `aDraftFeature`).

## 5. MSW — handler split

`POST /snapshot/:snapshotId/draft/features/:featureId/split` trên working-set draft in-memory
(đã có từ 2.3a; reset giữa test):

- Parse `SplitPipeRequest`; tìm feature `:featureId` trong working-set.
- Validate: feature tồn tại (không → `404`); feature là pipe/LineString (không → `400`).
- Tìm **segment chứa `atPoint`** bằng "closest segment" (chống lệch floating-point nhỏ); tách
  `coordinates`: `pipeA = [p0..pi, atPoint]`, `pipeB = [atPoint, pi+1..pn]`.
- Guard **degenerate**: `atPoint` trùng vertex đầu/cuối (một nhánh thành điểm đơn) → `400`.
- Thay pipe gốc bằng **2 pipe id mới** (props kế thừa), trả `200` mảng `[pipeA, pipeB]`.
- Last-write-wins (không version).

Handler test: POST tạo pipe → split → GET thấy **2 pipe** (id gốc biến mất); split id không tồn tại
→ 404; split tại endpoint → 400; body sai schema → 400/422.

## 6. `apps/gis-core` — thay đổi FSD (tái dùng tối đa, không slice FSD mới)

```
apps/gis-core/src/
  features/digitize/
    model/digitize-store.ts     # mở rộng: mode 'pipe' | 'node' | 'modify' | 'split' | null
    ui/digitize-toolbar.tsx     # thêm nút Split (toggle mode 'split')
  entities/draft-feature/
    api/commands.ts             # thêm splitPipe(snapshotId, pipeId, req)
    model/types.ts              # re-export SplitPipeRequest
  features/draft-plane/         # KHÔNG đổi (vẫn setFeatures('draft', …) sau refetch)
  shared/lib/query-keys.ts      # KHÔNG đổi (vẫn group draftFeatures)
```

- **`digitize-store`**: `mode` thêm `'split'`. Mode là single-value signal → Pipe/Node/Modify/Split
  tự loại trừ nhau.
- **`DigitizeToolbar`**: thêm nút **Split** toggle `mode='split'`. `createEffect` map `mode → side-effect`:
  - `'pipe'|'node'` → `setDrawMode('LineString'|'Point')`; `setModifyMode(false)`; `setFeaturePointMode(false)`.
  - `'modify'` → `setDrawMode(null)`; `setModifyMode(true)`; `setFeaturePointMode(false)`.
  - `'split'` → `setDrawMode(null)`; `setModifyMode(false)`; `setFeaturePointMode(true)`.
  - `null` → tất cả off.
  - Đăng ký `port.onFeaturePointPick((id, pt) => splitPipe.mutate({ pipeId: id, atPoint: { type: 'Point', coordinates: [pt.lon, pt.lat] } }))`;
    `onSuccess` → `invalidate(draftFeatures(snapshotId))`. **Không** reset mode sau split (§2e).
- **entity command**: `splitPipe(snapshotId, pipeId, req)` sinh `correlationId`, POST `.../split`.
  `model/types` re-export `SplitPipeRequest`.

## 7. Data flow

```
DigitizeToolbar click 'Split'
  → digitize-store.setMode('split')
    → createEffect: setDrawMode(null); setModifyMode(false); setFeaturePointMode(true)
      → adapter: +click handler (hit-test draft + closestPoint)
  → user click lên pipe draft → adapter hit-test + chiếu điểm → onFeaturePointPick(featureId, point 4326)
    → splitPipe.mutate({ pipeId, atPoint: Point(point) , correlationId })
      → MSW POST /snapshot/:id/draft/features/:pipeId/split → 200 [pipeA, pipeB] (working-set thay)
      → onSuccess: queryClient.invalidate(draftFeatures(snapshotId))
        → draftFeaturesQuery refetch (GET) → DraftPlane: port.setFeatures('draft', collection)  // 2 pipe
  → mode không reset → user cắt tiếp
```

Đọc `published` (bối cảnh) vẫn theo `DEFAULT_BBOX` cố định (viewport-driven reload là non-goal).

## 8. CRS, error & loading

- **CRS**: mọi geometry qua ranh giới app là EPSG:4326. Adapter đọc click (3857) → `getClosestPoint`
  (3857) → transform về 4326 trước khi qua port. `atPoint` trong command là Point 4326.
- **Error**: command lỗi → toast (envelope lỗi hiện có); `400` (degenerate / không phải pipe) +
  `404` (id sai) → toast thông báo, **không** vỡ map; `409`/`422` chưa xử lý (2.4). Đổi mode khi đang
  split → `setFeaturePointMode(false)` gỡ handler sạch.
- **Loading/empty**: draft rỗng → click không trúng pipe → no-op (vô hại). Mutation pending → giữ mode,
  không chặn map; double-click hiếm → last-write-wins.

## 9. Rủi ro then chốt

- **Chọn segment khi `atPoint` lệch line**: dùng "closest segment" thay so khớp tuyệt đối → robust với
  floating-point sau transform 3857↔4326.
- **`setFeatures` rebuild draft source sau refetch** (giống 2.3b §9): split không giữ sketch tạm (gesture
  click đã xong trước refetch), `ol/Modify` không active trong split mode → an toàn hơn 2.3b. Known-acceptable
  cho mock; optimize (patch-by-id / optimistic) để 2.4.
- **ol-containment invariant**: toàn bộ hit-test/closestPoint/transform trong `ol-map-adapter.ts`; gis-core
  chỉ thấy `(featureId, Coordinate)` — không rò `ol`.

## 10. Non-goals

node/junction tại điểm cắt + connect node↔pipe (2.3b-3); classify-crossing (2.3b-4); sửa published /
copy-on-write / lineage (2.4); attribute-edit + bulk (2.3c); optimistic-concurrency
`expectedStreamVersion`/`409`, panel `422`; undo split; snap toggle UI + tolerance; split nhiều pipe
một lần; select-then-split (split là pick-trực-tiếp, không cần selection riêng); continuity không-unmount
+ deep-link (2.5); BE thật / Keycloak thật.

## 11. Testing

| Lớp | Đối tượng |
|---|---|
| Contract (zod) | `SplitPipeRequest` parse hợp lệ/không hợp lệ (atPoint là Point, correlationId) |
| Port contract | `createFakePort` cài `setFeaturePointMode`/`onFeaturePointPick` + `emitFeaturePointPick`; assert đăng ký/huỷ (1 chỗ trong factory) |
| Adapter smoke (jsdom) | `setFeaturePointMode(true)` + click trúng pipe → cb nhận `(id, point 4326 trên line)`; click trượt → no-op; `false` gỡ handler |
| MSW handler | POST split → GET thấy 2 pipe (id gốc mất); split tại endpoint → 400; không phải pipe → 400; id sai → 404; body sai → lỗi |
| Entity | `splitPipe` mutation (POST body `atPoint` Point + correlationId) |
| Component | `DigitizeToolbar`: nút Split toggle `setFeaturePointMode`; `onFeaturePointPick` → mutate; loại trừ với draw/modify (Pipe/Node/Modify ↔ Split) |
| Integration | `GisEditorPage`: bật Split → pick (mock port `emitFeaturePointPick`) → 1 pipe thành 2 trên plane |
| Size | hit-test/closestPoint cưỡi chunk `ol-map-adapter-*`; `index` không phình |

Component/integration test dùng **Appendix A test prelude** + `createFakePort` (auth isolation +
re-impl `createMapRuntime` trên Solid gis-core + strip AbortSignal) như test render runtime của 2.2/2.3a/2.3b.

## 12. Self-review

- **Spec coverage**: §port pick → §3 (2 method generic). §command split mock → §4 + §5. §toolbar mode
  'split' + không reset → §2e + §6. §output 2 pipe không node → §2d + §5. §rủi ro segment/refetch → §9. ✓
- **Type consistency**: `setFeaturePointMode(boolean)` ↔ adapter; `onFeaturePointPick(id, Coordinate 4326)`
  ↔ gis-core gói Point → command `SplitPipeRequest.atPoint` = `NetworkGeometry` (Point lon/lat);
  response `DraftNetworkFeature[]` (2). ✓
- **Placeholder scan**: không TBD/TODO; mỗi mảnh có file path + signature. ✓
- **Ambiguity check**: `point` là `Coordinate` (không phải Geometry) — gói thành Point ở gis-core, nêu rõ §3/§6.
  "closest segment" định nghĩa rõ ở §5/§9. ✓
- **Scope**: một plan đủ gọn (2 port method, 1 contract request, 1 MSW handler, 1 entity command, mở rộng
  1 store + 1 toolbar — không slice FSD mới). Connect + classify-crossing đã tách 2.3b-3/2.3b-4. ✓
