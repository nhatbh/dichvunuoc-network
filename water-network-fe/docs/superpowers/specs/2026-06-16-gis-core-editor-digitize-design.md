# GIS Core — Editor Digitize (design)

- **Ngày**: 2026-06-16
- **Trạng thái**: Đã thống nhất design, chờ review spec trước khi viết implementation plan
- **Story**: US-002 GIS Core (Viewer + Editor) — **slice 2.3a** (lát đầu của "2.3 Editor core")
- **Mô hình**: fleet-SPA, FE độc lập hoàn toàn với BE (auth `mock`, data MSW) —
  xem `docs/decisions/0009-fe-fleet-via-core-template.md`
- **Tham chiếu**: spec 2.1 `2026-06-15-gis-core-viewer-foundation-design.md`,
  spec 2.2 `2026-06-15-gis-core-viewer-expansion-design.md` (Viewer đã ship);
  rewrite design §5–§6 `2026-06-15-water-network-fe-rewrite-design.md`

---

## 1. Bối cảnh & mục tiêu

Viewer đã xong qua 2 slice: `@wn/map-runtime` (port + OpenLayers adapter lazy,
view-only), `@wn/contracts/map-features` (shape **read/published**), gis-core FSD
(`map-canvas` đẩy features Published, `feature-search`, `layer-control`,
`coordinate-readout`, `map-shell`). Port hiện **chỉ đọc**: không có draw/modify/snap;
contracts **chỉ có** read/published, chưa có model ghi (draft).

"2.3 Editor core" trong Decomposition (spec 2.1) gộp **digitize + topology-edit +
attribute-edit** — mỗi mảnh nặng cỡ một slice 2.2. Theo kỷ luật lát-cắt-mỏng của
dự án, ta **chẻ tiếp**; slice này (**2.3a**) chỉ làm **digitize** như một lát dọc
mỏng xuyên đúng kiến trúc Editor thật, để cố định các ranh giới mới (port edit,
contract ghi, command CQRS, plane Draft, store edit) trước khi xếp topology/attribute lên trên.

**Mục tiêu slice (Done khi):**

1. Có route `/gis/editor` (sau cờ `NEW_EDITOR`) mount một map instance riêng,
   render plane `published` làm bối cảnh.
2. Toolbar digitize chọn chế độ vẽ **pipe (LineString)** hoặc **node (Point)**;
   chọn lại để tắt.
3. Vẽ xong → gọi **command tạo feature** (MSW mock, CQRS) → draft được lưu vào
   working-set mock → đọc lại qua query → render trên **plane `draft`** với style
   phân biệt.
4. Tất cả gates xanh (typecheck/lint/test/size); editor route lazy, không phình
   `index` chunk.

**Trong phạm vi:** route editor sau cờ `NEW_EDITOR` · vẽ pipe + node · command
tạo-feature mock (MSW) · đọc lại draft · plane Draft · contract `draft` đầu tiên.

> **Ngoài phạm vi (slice sau):** snap/split/connect + classify-crossing và
> **modify** hình học có sẵn (2.3b); attribute-edit + bulk (2.3c); asset-binding,
> spatial-lease, draft-validation, draft-submit (2.4); continuity Viewer↔Editor
> **không unmount** map + deep-link (2.5); optimistic-concurrency `409` /
> `expectedStreamVersion`, panel `422` validation; undo/delete draft đã tạo.

## 2. Quyết định kiến trúc cốt lõi

**(a) Port giữ generic — nhận geometry-type, không nhận domain kind.** `setDrawMode`
nhận `'LineString' | 'Point' | null`, **không** nhận `'pipe' | 'node'`. Map engine
là hạ tầng vẽ chung; ánh xạ `kind → geometry` (`pipe→LineString`, `node→Point`)
thuộc về feature `digitize` của domain. Nhất quán với `setFeatures` (nhận GeoJSON
thuần, không nhận domain kind). Tránh kéo từ vựng water-network vào port.

**(b) Draft feature là server-state (TanStack Query), không phải client-store.**
Sau command tạo (POST mock), ta **invalidate → refetch** query `draftFeatures` rồi
render — đúng đường đọc của `published` (mirror `mapFeaturesQuery`), đúng 3 tầng
state §6.4. `digitize-store` chỉ giữ **client UI state**: signal `drawMode`. Lợi:
một nguồn chân lý cho draft (mock working-set ↔ query cache), không có ốc đảo state
client tự quản hình học.

**(c) Editor là route riêng `/gis/editor`, map instance riêng.** Continuity
(không unmount map khi Viewer↔Editor) là **non-goal slice này** (để 2.5). Editor
page tự bọc `MapRuntimeProvider` của nó (như `/gis`), tái dùng `MapCanvas` để
render plane `published` làm bối cảnh thị giác.

**(d) Gate sau cờ `NEW_EDITOR`.** Cờ đã có sẵn (`shared/lib/feature-flags`, hiện
tắt). Route editor chỉ hiện khi cờ bật; tắt cờ → điều hướng/fallback về `/gis`.
Cho phép trộn chung `main` mà không lộ editor dở dang.

## 3. `@wn/contracts` — module `draft` mới

Thêm contract **ghi** đầu tiên. Geometry tái dùng `NetworkGeometry` (EPSG:4326).

```typescript
// packages/contracts/src/draft/index.ts
import { z } from 'zod';
import { NetworkFeatureKind, NetworkGeometry, NetworkFeatureProps } from '../map-features';

// Lệnh tạo (command request)
export const CreateDraftFeatureRequest = z.object({
  kind: NetworkFeatureKind,            // 'pipe' | 'node' (slice này chỉ phát 2 loại)
  geometry: NetworkGeometry,           // LineString cho pipe, Point cho node
  correlationId: z.string(),           // envelope command (§6.3); chưa dùng expectedStreamVersion
});
export type CreateDraftFeatureRequest = z.infer<typeof CreateDraftFeatureRequest>;

// Feature trong draft (server gán id, status 'draft')
export const DraftNetworkFeature = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: NetworkGeometry,
  properties: NetworkFeatureProps,     // { kind, name?, status? } — status = 'draft'
});
export type DraftNetworkFeature = z.infer<typeof DraftNetworkFeature>;

export const DraftFeatureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(DraftNetworkFeature),
});
export type DraftFeatureCollection = z.infer<typeof DraftFeatureCollection>;
```

Builders (`testing/index.ts`, append): `aDraftFeature(overrides?)`,
`aDraftFeatureCollection(opts?: { count?: number })`. Build contracts để gis-core thấy export.

## 4. `@wn/map-runtime` — port thêm đúng 2 method

Port tăng có kiểm soát (tôn trọng rủi ro "port phình"): **đúng 2 method**, mỗi
method một concern, generic theo geometry-type.

```typescript
// packages/map-runtime/src/port/types.ts (append)
export type DrawGeometry = 'LineString' | 'Point';

// packages/map-runtime/src/port/map-engine-port.ts (append vào interface)
/** Bật chế độ vẽ một geometry-type (null tắt chế độ vẽ). */
setDrawMode(geometry: DrawGeometry | null): void;
/** Đăng ký khi vẽ xong một geometry; cb nhận GeoJSON (EPSG:4326). Trả unsubscribe. */
onDrawComplete(cb: (geometry: NetworkGeometry) => void): () => void;
```

- `NetworkGeometry` ở đây dùng kiểu cấu trúc tương đương (`{ type, coordinates }`,
  EPSG:4326) — port **không** import `@wn/contracts` (giữ package độc lập); khai báo
  type cục bộ tối thiểu trùng shape, như cách hiện tại đã xử lý `FeatureCollection`.
- **Adapter (`openlayers/ol-map-adapter.ts`)**: `setDrawMode` thêm/gỡ một
  `ol/interaction/Draw` (type `LineString`/`Point`) trên vector source draft; `null`
  gỡ interaction. `drawend` → đọc geometry feature, transform về EPSG:4326, gọi các
  cb đã đăng ký qua `onDrawComplete`. `ol/Draw` **chỉ** nằm trong adapter lazy →
  vẫn ở chunk `ol-map-adapter-*`, không rò ra `index`.
- Fake trong contract-test cài 2 method để giữ seam test xanh.

## 5. MSW — handler draft + working-set

Một **working-set draft in-memory** (mảng fixture dùng chung trong module handlers,
reset giữa test). Hai handler dưới `snapshot/:snapshotId/draft/features`:

- `POST` — parse `CreateDraftFeatureRequest`, gán `id` (vd `draft-<n>`), set
  `properties.status='draft'`, push vào working-set, trả `201` `DraftNetworkFeature`.
- `GET` — trả `DraftFeatureCollection` từ working-set.

Handler test: POST rồi GET thấy feature vừa tạo; POST body sai schema → `400`/`422`
(theo envelope lỗi hiện có).

## 6. `apps/gis-core` — FSD slices

```
apps/gis-core/src/
  entities/
    draft-feature/                 # MỚI — read + command cho draft
      model/types.ts               #   re-export contract draft
      api/queries.ts               #   fetchDraftFeatures + draftFeaturesQueryOptions
      api/commands.ts              #   createDraftFeature (mutation)
      index.ts
    map-feature/                   # đã có (read published) — không đổi
  features/
    digitize/                      # MỚI — chọn mode vẽ + phát command
      model/digitize-store.ts      #   signal drawMode: 'pipe' | 'node' | null
      ui/digitize-toolbar.tsx
      index.ts
    draft-plane/                   # MỚI — render plane 'draft' từ query
      ui/draft-plane.tsx
      index.ts
    map-canvas/                    # đã có — tái dùng nguyên trạng (plane published)
  pages/gis/
    editor/index.tsx               # MỚI — GisEditorPage, compose
  routes/editor...                 # MỚI — route /gis/editor sau cờ NEW_EDITOR
  shared/lib/
    query-keys.ts                  # thêm group draftFeatures
    feature-flags.tsx              # NEW_EDITOR đã có (bật cho slice này)
```

- **`query-keys.ts`**: thêm group `draftFeatures(snapshotId)` cạnh `mapFeatures`.
- **entity `draft-feature`**: `draftFeaturesQueryOptions(snapshotId)` (GET);
  `createDraftFeature(snapshotId, req)` (POST, sinh `correlationId`). `model/types`
  re-export `DraftNetworkFeature`/`DraftFeatureCollection`/`CreateDraftFeatureRequest`.
- **feature `digitize`**: `digitize-store` giữ `drawMode` signal +
  `setDrawMode/clear`. `DigitizeToolbar`: nút **Pipe** / **Node** / **Cancel**
  (toggle `drawMode`); một `createEffect` map `drawMode → DrawGeometry` rồi gọi
  `port.setDrawMode(geom)`; đăng ký `port.onDrawComplete(g => createFeature.mutate(...))`
  với `kind` từ `drawMode` hiện tại; `onSuccess` → `invalidate(draftFeatures)` + reset mode.
- **feature `draft-plane`**: đọc `draftFeaturesQueryOptions` → `port.setFeatures('draft', collection)`.
  Style phân biệt: style-adapter thêm biến thể cho layer `draft` (vd nét đứt / màu amber).
- **page `GisEditorPage`** (route `/gis/editor`): `MapRuntimeProvider` →
  `MapShell` với `map={<MapCanvas/>}` (published bối cảnh), `topLeft={<DigitizeToolbar/>}`,
  và `<DraftPlane/>` (component vô hình điều khiển `setFeatures`). Gate `NEW_EDITOR`.

## 7. Data flow

```
DigitizeToolbar click 'Pipe'
  → digitize-store.setDrawMode('pipe')
    → createEffect: port.setDrawMode('LineString')
  → người dùng vẽ trên map → ol/Draw drawend
    → port.onDrawComplete(geojson EPSG:4326)
      → createDraftFeature.mutate({ kind:'pipe', geometry, correlationId })
        → MSW POST /snapshot/:id/draft/features → 201 DraftNetworkFeature (push working-set)
      → onSuccess: queryClient.invalidate(draftFeatures(snapshotId)); store.clear()
        → draftFeaturesQuery refetch (GET) → DraftPlane: port.setFeatures('draft', collection)
```

Đọc `published` (bối cảnh) vẫn theo `DEFAULT_BBOX` cố định (viewport-driven reload
là non-goal, như Viewer). Draft working-set độc lập bbox (đang single-user mock).

## 8. CRS, error & loading

- **CRS**: mọi geometry qua ranh giới app là EPSG:4326 (port transform nội bộ về
  EPSG:3857 cho OL, như hiện tại). Contract `NetworkGeometry` = lon/lat.
- **Error**: command lỗi → toast (envelope lỗi hiện có); `409`/`422` **chưa** xử lý
  (deferred 2.4). Vẽ đang dở + đổi mode → `setDrawMode(null)` hủy interaction sạch.
- **Loading/empty**: draft query rỗng → plane `draft` rỗng (không placeholder). Mutation
  pending → nút toolbar disable nhẹ (tránh double-submit), không chặn map.

## 9. Non-goals

Topology snap/split/connect/classify-crossing + **modify** hình học (2.3b);
attribute-edit + bulk (2.3c); asset-binding/spatial-lease/draft-validation/draft-submit
(2.4); continuity không-unmount + deep-link (2.5); optimistic-concurrency
`expectedStreamVersion`/`409`, panel `422`; undo/delete/move draft đã tạo; vẽ
facility (Polygon)/component; BE thật / Keycloak thật (giai đoạn integration).

## 10. Testing

| Lớp | Đối tượng |
|---|---|
| Contract (zod) | `CreateDraftFeatureRequest`/`DraftNetworkFeature`/`DraftFeatureCollection` + builders |
| Port contract | fake cài `setDrawMode`/`onDrawComplete` trong `makeFake`; assert đăng ký/huỷ |
| Adapter smoke (jsdom) | `setDrawMode('LineString')` thêm ol/Draw; `null` gỡ; drawend → cb nhận geometry 4326 |
| MSW handler | POST tạo → GET thấy; body sai → lỗi |
| Entity | `createDraftFeature` mutation (POST body + correlationId); `draftFeaturesQuery` (GET) |
| Component | `DigitizeToolbar` toggle mode + gọi `setDrawMode` + mutate khi onDrawComplete; `DraftPlane` đẩy `setFeatures('draft')` |
| Integration | `GisEditorPage`: vẽ → create → draft xuất hiện trên plane (mock port) |
| Size | editor route lazy; ol/Draw cưỡi chunk `ol-map-adapter-*`; `index` không phình |

Component/integration test dùng **Appendix A test prelude** (auth isolation +
re-impl `createMapRuntime` trên Solid của gis-core + strip AbortSignal) như các test
render runtime của 2.2.

## 11. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Port phình vì edit | Đúng 2 method, generic geometry-type; modify/snap để slice sau |
| `ol/Draw` rò ra `index` chunk | Draw chỉ trong adapter lazy; gate size kiểm `index` |
| State draft phân mảnh (client vs server) | Draft = server-state qua query; store chỉ giữ `drawMode` |
| Editor dở dang lộ trên `main` | Sau cờ `NEW_EDITOR` (tắt mặc định) |
| Coupling digitize ↔ draft-plane | Giao tiếp qua query cache + port, không import chéo feature |
| Domain rò vào port | Port nhận geometry-type; ánh xạ `kind→geometry` ở feature digitize |

## 12. Self-review

- **Spec coverage**: §3 contract ghi → contract draft (§3). §port edit → §4 (2 method).
  §command CQRS mock → §5 + entity command (§6). §plane Draft + store edit → §6.
  §route editor sau cờ → §2(c,d) + §6. ✓
- **Type consistency**: `DrawGeometry='LineString'|'Point'` dùng ở port `setDrawMode`
  ↔ adapter; `kind` (`pipe|node`) chỉ ở app, map sang `DrawGeometry` ở `digitize`;
  `NetworkGeometry` (lon/lat) ở contract `draft` ↔ port `onDrawComplete` ↔ command. ✓
- **Placeholder scan**: không TBD/TODO; mỗi mảnh có file path + signature. ✓
- **Scope**: một plan đủ gọn (1 contract module, 2 port method, 2 MSW handler,
  1 entity, 2 feature, 1 page/route). ✓
