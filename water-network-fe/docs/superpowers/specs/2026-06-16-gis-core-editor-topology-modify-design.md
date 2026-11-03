# GIS Core — Editor Topology snap + geometry-modify (design)

- **Ngày**: 2026-06-16
- **Trạng thái**: Đã thống nhất design, chờ review spec trước khi viết implementation plan
- **Story**: US-002 GIS Core (Viewer + Editor) — **slice 2.3b** (lát thứ hai của "2.3 Editor core")
- **Mô hình**: fleet-SPA, FE độc lập hoàn toàn với BE (auth `mock`, data MSW) —
  xem `docs/decisions/0009-fe-fleet-via-core-template.md`
- **Tham chiếu**: spec 2.3a `2026-06-16-gis-core-editor-digitize-design.md` (digitize đã ship,
  merged `d56228f`); spec 2.1/2.2 viewer foundation/expansion; rewrite design §5–§6.

---

## 1. Bối cảnh & mục tiêu

2.3a đã cố định các ranh giới Editor thật: port edit (`setDrawMode`/`onDrawComplete`),
contract ghi đầu tiên (`@wn/contracts/draft`), command CQRS mock (POST tạo draft),
plane Draft (render từ query), `digitize-store` (signal `drawMode`), route `/gis/editor`
sau cờ `NEW_EDITOR`. Draft là **server-state** qua TanStack Query (mock working-set in-memory
trong MSW); published là **bối cảnh read-only**.

"2.3 Editor core" gộp digitize + **topology-edit** + attribute-edit. 2.3a làm digitize.
Topology-edit bản thân vẫn quá dày (snap + split + connect + classify-crossing + geometry-modify),
trộn 2 tầng bản chất khác nhau: **tầng tương tác map** (snap, geometry-modify) vs
**tầng topology domain** (split pipe, connect node↔pipe, classify-crossing). Theo kỷ luật
lát-cắt-mỏng, ta **chẻ tiếp**: slice này (**2.3b**) chỉ làm **tầng tương tác map** —
**snap + geometry-modify** — để cố định seam modify/update (port modify, command update,
ol/Modify+ol/Snap trong adapter) trước khi xếp topology domain (2.3b-2) lên trên.

**Mục tiêu slice (Done khi):**

1. Toolbar có chế độ **Modify**: bật → kéo vertex của feature **draft** sẵn có trên map.
2. Kéo xong (modifyend) → gọi **command update geometry** (MSW mock, CQRS, PATCH) →
   working-set cập nhật → đọc lại qua query → plane `draft` re-render geometry mới.
3. **Snap** áp cho cả digitize (2.3a) lẫn modify; target = draft + published; là hành vi
   nội tại của adapter (không port-method, không toggle UI).
4. Tất cả gates xanh (typecheck/lint/test/size); ol/Modify + ol/Snap cưỡi chunk
   `ol-map-adapter-*`, `index` không phình.

**Trong phạm vi:** chế độ Modify trên toàn draft source · ol/Modify + ol/Snap trong adapter ·
command update-geometry mock (PATCH) · contract `UpdateDraftFeatureGeometryRequest` ·
featureId round-trip qua `setId`.

> **Ngoài phạm vi (slice sau):** split / connect / classify-crossing → **2.3b-2**
> (topology domain). Sửa published / copy-on-write / lineage → 2.4. Optimistic-concurrency
> (`expectedStreamVersion`/`409`), panel `422`. Undo/delete vertex, add/remove vertex có UI
> chủ đích (ol/Modify cho insert/xoá vertex tự nhiên thì OK, không làm UI riêng). Snap toggle
> UI + snap tolerance config. Select-then-modify (đã chốt modify toàn source). Continuity
> Viewer↔Editor không-unmount + deep-link (2.5). attribute-edit + bulk (2.3c).

## 2. Quyết định kiến trúc cốt lõi

**(a) Chỉ feature `draft` sửa được; `published` là snap-target read-only.** `ol/Modify`
gắn vào **draft source**. Published bất biến, chỉ dùng làm mục tiêu snap. Giữ slice mỏng,
**không** đẻ khái niệm override/lineage/copy-on-write (đó là 2.4).

**(b) Modify-mode trên toàn draft source — không selection.** Bật Modify → `ol/Modify`
áp cả draft source; mọi vertex draft kéo được. Đúng cách `ol/Modify` làm việc sẵn (trên
source), không thêm tầng selection. Select-then-modify là non-goal.

**(c) Snap global, implicit trong adapter — KHÔNG port-method.** Snap chỉ là hạ tầng map:
bắt vào các vector source mà adapter đã sở hữu (`published` + `draft`). Adapter tự gắn
`ol/Snap` khi có draw/modify active, gỡ khi không còn. Không lộ ra port → tôn trọng rủi ro
"port phình": 2.3b chỉ thêm **đúng 2 port-method** (mirror kỷ luật 2.3a). Snap không có
toggle UI, luôn bật khi editing.

**(d) Modify là thao tác lặp — KHÔNG reset mode sau mỗi modifyend.** Khác digitize (vẽ xong
reset về null để tránh vẽ liên tục ngoài ý), modify giữ mode để sửa tiếp nhiều vertex/feature
cho tới khi người dùng tự tắt.

**(e) Command update = PATCH geometry-only, last-write-wins.** Không version
(`expectedStreamVersion`/`409` là 2.4). Đúng đường đọc của draft: PATCH → invalidate →
refetch → `setFeatures('draft', …)`.

## 3. `@wn/map-runtime` — port thêm đúng 2 method

```typescript
// packages/map-runtime/src/port/map-engine-port.ts (append vào interface)
/** Bật/tắt modify hình học trên layer draft. Snap (draft+published) tự bật theo. */
setModifyMode(enabled: boolean): void;
/** Đăng ký khi modify xong một feature; cb nhận (featureId, geometry GeoJSON 4326). Trả unsubscribe. */
onModifyComplete(cb: (featureId: string, geometry: Geometry) => void): () => void;
```

- **Adapter (`openlayers/ol-map-adapter.ts`)**:
  - `setModifyMode(true)` → thêm `ol/interaction/Modify({ source: #draftSource })`; và (lần đầu
    có draw hoặc modify) thêm `ol/interaction/Snap` cho **cả** draft source và published source.
    `setModifyMode(false)` → gỡ Modify; Snap gỡ khi không còn draw lẫn modify active.
  - `modifyend` → với mỗi feature đã sửa: đọc `feature.getId()` + geometry, transform 3857→4326,
    gọi các sub đã đăng ký qua `onModifyComplete`.
  - `ol/Modify` + `ol/Snap` **chỉ** nằm trong adapter lazy → vẫn ở chunk `ol-map-adapter-*`,
    không rò ra `index`.
- **featureId round-trip**: `setFeatures(layerId, collection)` phải gán `olFeature.setId(f.id)`
  cho mỗi feature (cần cho `modifyend` biết feature nào). Kiểm tra impl 2.3a đã `setId` chưa;
  nếu chưa, thêm (cũng làm `setSelection`/`onFeatureClick` của viewer nhất quán hơn).
- Fake trong contract-test cài 2 method để giữ seam test xanh.

## 4. `@wn/contracts` — command update geometry

```typescript
// packages/contracts/src/draft/index.ts (append)
export const UpdateDraftFeatureGeometryRequest = z.object({
  geometry: NetworkGeometry,           // hình học mới (EPSG:4326)
  correlationId: z.string(),           // envelope command; chưa dùng expectedStreamVersion
});
export type UpdateDraftFeatureGeometryRequest = z.infer<typeof UpdateDraftFeatureGeometryRequest>;
```

Response tái dùng `DraftNetworkFeature` (geometry mới, cùng `id`/`kind`/`status='draft'`).
Build contracts để gis-core thấy export. Builder mới không cần (tái dùng `aDraftFeature`).

## 5. MSW — handler PATCH update

`PATCH /snapshot/:snapshotId/draft/features/:featureId` trên working-set draft in-memory (đã có
từ 2.3a; reset giữa test):

- Parse `UpdateDraftFeatureGeometryRequest`; tìm feature theo `:featureId` trong working-set.
- Thấy → thay `geometry`, trả `200` `DraftNetworkFeature` (geometry mới).
- Không thấy → `404` (theo envelope lỗi hiện có).
- Last-write-wins (không version).

Handler test: POST tạo → PATCH đổi geometry → GET thấy geometry mới; PATCH id không tồn tại → 404;
body sai schema → 400/422.

## 6. `apps/gis-core` — thay đổi FSD (tái dùng tối đa, không slice mới)

```
apps/gis-core/src/
  features/digitize/
    model/digitize-store.ts     # mở rộng: mode 'pipe' | 'node' | 'modify' | null
    ui/digitize-toolbar.tsx     # thêm nút Modify (toggle mode 'modify')
  entities/draft-feature/
    api/commands.ts             # thêm updateDraftFeatureGeometry(snapshotId, featureId, req)
    model/types.ts              # re-export UpdateDraftFeatureGeometryRequest
  features/draft-plane/         # KHÔNG đổi (vẫn setFeatures('draft', …) sau refetch)
  shared/lib/query-keys.ts      # KHÔNG đổi (vẫn group draftFeatures)
```

- **`digitize-store`**: `mode` thêm `'modify'`. Mode là single-value signal → Pipe/Node/Modify
  tự loại trừ nhau (chọn Modify tắt draw; chọn Pipe/Node tắt modify).
- **`DigitizeToolbar`**: thêm nút **Modify** toggle `mode='modify'`. Một `createEffect` map
  `mode → side-effect` trên port:
  - `'pipe'|'node'` → `port.setDrawMode('LineString'|'Point')`; `port.setModifyMode(false)`.
  - `'modify'` → `port.setDrawMode(null)`; `port.setModifyMode(true)`.
  - `null` → `setDrawMode(null)` + `setModifyMode(false)`.
  - Đăng ký `port.onModifyComplete((id, geom) => updateGeom.mutate({ featureId: id, geometry: geom }))`;
    `onSuccess` → `invalidate(draftFeatures(snapshotId))`. **Không** reset mode sau modify (§2d).
- **entity command**: `updateDraftFeatureGeometry(snapshotId, featureId, req)` sinh `correlationId`,
  PATCH. `model/types` re-export `UpdateDraftFeatureGeometryRequest`.

## 7. Data flow

```
DigitizeToolbar click 'Modify'
  → digitize-store.setMode('modify')
    → createEffect: port.setDrawMode(null); port.setModifyMode(true)
      → adapter: +ol/Modify(draftSource) +ol/Snap(draft, published)
  → người dùng kéo vertex feature draft → ol/Modify modifyend
    → port.onModifyComplete(featureId, geometry 4326)
      → updateDraftFeatureGeometry.mutate({ featureId, geometry, correlationId })
        → MSW PATCH /snapshot/:id/draft/features/:featureId → 200 (working-set thay geometry)
      → onSuccess: queryClient.invalidate(draftFeatures(snapshotId))
        → draftFeaturesQuery refetch (GET) → DraftPlane: port.setFeatures('draft', collection)
```

Đọc `published` (bối cảnh, snap-target) vẫn theo `DEFAULT_BBOX` cố định (viewport-driven reload
là non-goal, như Viewer). Mode không reset → người dùng modify tiếp.

## 8. CRS, error & loading

- **CRS**: mọi geometry qua ranh giới app là EPSG:4326 (adapter transform nội bộ về 3857 cho OL).
  `modifyend` đọc geometry OL (3857) → transform về 4326 trước khi qua port.
- **Error**: command update lỗi → toast (envelope lỗi hiện có); `409`/`422` **chưa** xử lý (2.4).
  Đổi mode khi đang modify → `setModifyMode(false)` gỡ interaction sạch.
- **Loading/empty**: draft rỗng → không có gì để modify (Modify mode không có target, vô hại).
  Mutation pending → giữ mode, không chặn map (double modifyend hiếm; last-write-wins).

## 9. Rủi ro then chốt: `ol/Modify` ↔ `setFeatures` refetch

`ol/Modify` sửa **trực tiếp** ol-feature trong draft source. Sau `modifyend` → command →
invalidate → refetch → `setFeatures('draft', collection)` **rebuild lại toàn bộ draft source**.

- **Mock geometry round-trip y hệt** → không nháy hình. Nhưng clear+rebuild source dưới chân
  `ol/Modify` đang active có thể làm mất trạng thái sketch tạm (vertex đang hover).
- **Giảm thiểu**: giữ `setFeatures` rebuild như cũ; sketch vertex chỉ tồn tại **trong gesture**
  nên không mất **giữa** các thao tác (modifyend đã kết thúc gesture trước khi refetch). `ol/Modify`
  bound theo source nên tự theo dõi feature mới. Ghi rõ **known-acceptable cho mock**; optimize
  (patch-by-id / bỏ refetch sau self-edit / optimistic update) để 2.4 khi có concurrency thật.
- **ol-containment invariant**: toàn bộ Modify/Snap/transform nằm trong `ol-map-adapter.ts`;
  gis-core chỉ thấy `(featureId, GeoJSON)` — không rò `ol` ra ngoài adapter.

## 10. Non-goals

split / connect / classify-crossing (2.3b-2); sửa published / copy-on-write / lineage (2.4);
attribute-edit + bulk (2.3c); optimistic-concurrency `expectedStreamVersion`/`409`, panel `422`;
undo/delete vertex + add/remove vertex có UI chủ đích; snap toggle UI + tolerance config;
select-then-modify; continuity không-unmount + deep-link (2.5); BE thật / Keycloak thật.

## 11. Testing

| Lớp | Đối tượng |
|---|---|
| Contract (zod) | `UpdateDraftFeatureGeometryRequest` parse hợp lệ/không hợp lệ |
| Port contract | fake cài `setModifyMode`/`onModifyComplete` trong `makeFake`; assert đăng ký/huỷ |
| Adapter smoke (jsdom) | `setModifyMode(true)` thêm ol/Modify + ol/Snap; `false` gỡ; `modifyend` → cb nhận `(id, geometry 4326)`; `setFeatures` gán `setId` |
| MSW handler | POST→PATCH đổi geometry→GET thấy geometry mới; PATCH id sai → 404; body sai → lỗi |
| Entity | `updateDraftFeatureGeometry` mutation (PATCH body + correlationId) |
| Component | `DigitizeToolbar`: nút Modify toggle `setModifyMode`; `onModifyComplete` → mutate; loại trừ với draw mode (Pipe/Node ↔ Modify) |
| Integration | `GisEditorPage`: bật Modify → modify (mock port) → geometry draft cập nhật trên plane |
| Size | ol/Modify + ol/Snap cưỡi chunk `ol-map-adapter-*`; `index` không phình |

Component/integration test dùng **Appendix A test prelude** (auth isolation + re-impl
`createMapRuntime` trên Solid của gis-core + strip AbortSignal) như các test render runtime của 2.2/2.3a.

## 12. Self-review

- **Spec coverage**: §port modify → §3 (2 method). §snap implicit → §2c + §3 adapter. §contract
  update → §4. §command PATCH mock → §5 + entity command (§6). §toolbar mode 'modify' + không reset
  → §2d + §6. §rủi ro Modify↔refetch → §9. ✓
- **Type consistency**: `setModifyMode(boolean)` ↔ adapter; `onModifyComplete(id, Geometry 4326)`
  ↔ entity command `geometry`/`featureId`; `UpdateDraftFeatureGeometryRequest.geometry` =
  `NetworkGeometry` (lon/lat). ✓
- **Placeholder scan**: không TBD/TODO; mỗi mảnh có file path + signature. ✓
- **Scope**: một plan đủ gọn (2 port method, 1 contract request, 1 MSW handler, 1 entity command,
  mở rộng 1 store + 1 toolbar — không slice FSD mới). split/connect/classify-crossing đã tách 2.3b-2. ✓
