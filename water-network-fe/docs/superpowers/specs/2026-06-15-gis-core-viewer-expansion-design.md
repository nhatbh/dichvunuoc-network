# GIS Core — Viewer Expansion (design)

- **Ngày**: 2026-06-15
- **Trạng thái**: Đã thống nhất design, chờ review spec trước khi viết implementation plan
- **Story**: US-002 GIS Core (Viewer + Editor) — **slice 2.2** (xem Decomposition trong spec 2.1)
- **Mô hình**: fleet-SPA, FE độc lập hoàn toàn với BE (auth `mock`, data MSW) —
  xem `docs/decisions/0009-fe-fleet-via-core-template.md`
- **Tham chiếu**: spec slice 2.1 `2026-06-15-gis-core-viewer-foundation-design.md`
  (nền Viewer đã ship); rewrite design §5 `2026-06-15-water-network-fe-rewrite-design.md`;
  mockup thị giác `water-network-gis/water-network-gis-ui`

---

## 1. Bối cảnh & mục tiêu

Slice 2.1 đã ship nền Viewer: `@wn/map-runtime` (port + OpenLayers adapter, lazy),
`@wn/contracts/map-features`, và gis-core FSD (`map-canvas` sở hữu port, render
features Published từ MSW theo `DEFAULT_BBOX`, click → highlight + `properties-palette`).
Route `/gis` compose `MapCanvas` + `PropertiesPalette` trực tiếp.

Slice 2.2 mở rộng Viewer với 4 mảnh được **dời từ 2.1 hoặc thêm mới**:

1. **map-shell** — widget layout: vùng map + slot overlay + slot palette.
2. **coordinate bar** — đọc lon/lat theo con trỏ (đã dời từ 2.1 vì cần pointer-move trên port).
3. **layer-control** — bật/tắt vector layer + đổi basemap.
4. **feature-search** — tìm feature theo name/id/kind, chọn → bay view tới hit.

**Done khi**: map-shell bố trí 3 control nổi quanh map; coordinate bar hiện lon/lat
theo con trỏ; layer-control bật/tắt layer `published` và đổi basemap; search gọi
mock endpoint, chọn kết quả → `fitToBbox` + highlight; gates xanh.

> **Phạm vi**: `related` (1-hop) và `lineage` — tuy spec 2.1 liệt kê chung trong
> "2.2 Viewer mở rộng" — **không** nằm trong slice này; để slice sau. Slice này
> đúng 4 mảnh: map-shell + coordinate bar + layer-control + search.

## 2. Quyết định kiến trúc cốt lõi: shared map-runtime context

Thay đổi định hình của slice. Ở 2.1 chỉ `map-canvas` chạm port nên feature đó tự
tạo/sở hữu port (`createMapRuntime` trong `onMount`). Ở 2.2 có **ba mảnh nữa cần
cùng một instance port sống**: coordinate-readout (pointer-move), layer-control
(toggle layer/basemap), feature-search (`fitToBbox` tới hit). Vì vậy ta **nâng
quyền sở hữu port** lên một provider phạm vi-route.

- **`shared/lib/map-runtime/`** (mới): `MapRuntimeProvider` gọi
  `createMapRuntime({ view, factory })` (hook đã có trong package), expose
  `{ containerRef, port }` qua Solid context `useMapRuntimeContext()`. Nhận prop
  `factory` làm **seam test duy nhất** (mock port inject một lần ở provider, thay
  cho việc truyền `mapFactory` qua từng feature như 2.1).
- `map-canvas` **thu gọn thành feature-pusher**: đọc `containerRef` (gắn cho `<div>`
  của nó) và `port` từ context; push features `getMapFeatures`; phản chiếu selection.
  Không còn tự quản lifecycle.
- coordinate-readout / layer-control / feature-search đọc cùng `port` từ context.

Lý do: một owner duy nhất cho engine sống; lifecycle tạo/destroy tập trung; test
inject mock port một lần; tránh feature phụ thuộc lifecycle của feature khác.

## 3. `@wn/map-runtime` — port thêm đúng 4 method

Bề mặt port tăng có kiểm soát (tôn trọng rủi ro "port phình lại" của 2.1):

```ts
// thêm vào MapEnginePort
onPointerMove(cb: (c: Coordinate | null) => void): () => void; // null khi con trỏ rời map
setLayerVisible(layerId: string, visible: boolean): void;
setBasemap(basemapId: string): void;
fitToBbox(extent: Extent, opts?: { padding?: number; maxZoom?: number }): void;
// extent = [minLon, minLat, maxLon, maxLat], EPSG:4326
```

- `port/types.ts`: thêm `export type Extent = [number, number, number, number];`.
- **`openlayers/basemaps.ts`** (mới — file `ol`-import mới **duy nhất**): factory
  source cho `osm` / `carto-light` / `none` (đều XYZ/OSM key-less, chạy standalone).
- Package `index.ts` re-export **catalog thuần** (không `ol`):
  `export const BASEMAPS: readonly { id: string; label: string }[]` để
  `layer-control` lấy nhãn mà không kéo chunk engine.
- `OlMapAdapter` hiện thực 4 method:
  - `onPointerMove`: `map.on('pointermove', e → toLonLat(e.coordinate))`; lắng
    `mouseout` trên `map.getViewport()` → `cb(null)`. Trả unsubscribe (gỡ cả 2 listener).
  - `setLayerVisible`: `this.#layers.get(layerId)?.setVisible(visible)`.
  - `setBasemap`: giữ ref base tile layer; đổi source từ catalog (`none` → ẩn/empty layer).
  - `fitToBbox`: `transformExtent(extent, 'EPSG:4326', viewProj)` rồi
    `view.fit(extent, { size: map.getSize(), padding, maxZoom })`.

Nguyên tắc giữ nguyên: chỉ `openlayers/*` import `ol`; data qua port là EPSG:4326;
chunk `map-engine` vẫn lazy, budget ≤200KB gz.

## 4. `@wn/contracts` — thêm search result vào context `map-features`

```ts
export const FeatureSearchResult = z.object({
  id: z.string(),
  name: z.string(),
  kind: NetworkFeatureKind,                                   // tái dùng enum đã có
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // [minLon,minLat,maxLon,maxLat] EPSG:4326
});
export type FeatureSearchResult = z.infer<typeof FeatureSearchResult>;

export const FeatureSearchResults = z.object({
  results: z.array(FeatureSearchResult),
});
export type FeatureSearchResults = z.infer<typeof FeatureSearchResults>;
```

- Query (mock): `GET /snapshot/:id/search?q=<term>` → `FeatureSearchResults`.
  Zod parse ở biên (drift contract → throw).
- `aFeatureSearchResults()` builder trong `@wn/contracts/testing`.
- `bbox` đủ để `fitToBbox` bay tới hit mà không cần feature nằm sẵn trong vector source.

## 5. `apps/gis-core` — FSD slices

```
shared/lib/map-runtime/     MỚI  MapRuntimeProvider + useMapRuntimeContext()
entities/
  map-feature/              SỬA  thêm searchFeaturesQueryOptions + type SearchResult (từ @wn/contracts)
features/
  map-canvas/               SỬA  tiêu thụ context (containerRef + port); bỏ createMapRuntime riêng
  coordinate-readout/       MỚI  port.onPointerMove → signal cục bộ → strip lon/lat
  layer-control/            MỚI  toggle vector + đổi basemap; gọi port.setLayerVisible/setBasemap; đọc BASEMAPS
  feature-search/           MỚI  useQuery search; chọn hit → port.fitToBbox(bbox) + props.onSelect(id)
  feature-selection/        —    giữ nguyên
widgets/
  map-shell/                MỚI  layout: vùng map + slot overlay (search TL, layers TR, coord bar đáy) + slot palette phải
  properties-palette/       —    giữ nguyên
pages/gis/                  SỬA  bọc MapRuntimeProvider; compose map-shell; sở hữu selection-store; nối search→selection
shared/api/mocks/           SỬA  thêm handler GET /snapshot/:id/search?q= trên fixture dùng chung
```

**Kỷ luật boundary:** `feature-search` **không** import `feature-selection`. Search
tự lo "bay tới hit của mình" (`port.fitToBbox` qua context) và phát `onSelect(id)`
lên trên; **page** nối `onSelect` vào `selection.select` — đúng pattern prop của
`map-canvas` ở 2.1. coordinate-readout và layer-control tự chứa (chỉ chạm context
port + store cục bộ). Mỗi feature vẫn không import feature khác; giao tiếp qua
`shared/*` (context) và prop từ page.

**Bố cục map-shell (overlay nổi trên map):**

```
+--------------------------------------+--------+
| [search box]        [layers v]       |        |
|                                      | Props  |
|              MAP CANVAS              | palette|
|                                      | (phải) |
|              [ 105.84, 21.02 ]       |        |
+--------------------------------------+--------+
  search top-left, layer-control top-right, coordinate bar strip đáy;
  properties-palette giữ là sidebar phải (flex như 2.1).
```

## 6. Data flow

```
/gis route
  → MapRuntimeProvider (sở hữu port; view = mặc định)
    → map-shell
        map-canvas:         containerRef(ctx) + push getMapFeatures(snap, DEFAULT_BBOX)
        feature-search:     searchFeatures(snap, q) → list; chọn → port.fitToBbox(bbox) + onSelect(id)
        layer-control:      port.setLayerVisible('published', v) / port.setBasemap(id)
        coordinate-readout: port.onPointerMove → lon/lat
      + properties-palette: selectedFeature
  selection-store @ page → selectedId → map-canvas + properties-palette
```

- Server state: TanStack Solid Query (mock qua MSW) — thêm `searchFeatures`.
- Client state: `selection-store` (page, đã có), store cục bộ cho coordinate-readout
  (lon/lat) và layer-control (basemap hiện tại + cờ vector visible).
- Vẫn **chưa** event bus / URL-sync (để slice continuity sau).

## 7. CRS, error & loading

- Mock geometry EPSG:4326; coordinate bar hiện lon/lat; `fitToBbox` transform 4326→view proj.
- Search: input debounce; trạng thái loading/empty cho danh sách kết quả; lỗi query
  cô lập trong control (không sập map).
- Basemap `none`: nền trống, vector vẫn vẽ — fallback an toàn khi tile lỗi mạng.
- `Suspense`/`ErrorBoundary` route-level (template) giữ nguyên.

## 8. Testing

| Tầng | Cases |
|---|---|
| Unit (map-runtime) | `fitToBbox` transform extent; build source theo catalog; `setLayerVisible` toggle; pointermove → lon/lat |
| Contract port (map-runtime) | mock port hiện thực đủ 4 method mới |
| Contract (contracts) | round-trip parse `FeatureSearchResults` + khớp builder |
| Component (gis-core) | coordinate-readout (mock port emit pointer → render lon/lat; `null` → placeholder); layer-control (click → spy port.setLayerVisible/setBasemap); feature-search (gõ → useQuery mock → list → chọn → `fitToBbox` gọi + `onSelect` phát); map-canvas qua provider + mock port |
| Integration (gis-core) | MSW `searchFeatures` q → parse → list path |
| Smoke | route `/gis` mount qua `MapRuntimeProvider` không lỗi |
| Size | chunk `map-engine` ≤200KB gz; file <400 dòng |

**DoD**: trong scope 4 mảnh; qua boundaries + size gate; có unit + component test
với mock port; khớp contract test; MFE chạy standalone (mock auth); không file >600 dòng.

## 9. Non-goals

`related` (1-hop) + `lineage`; URL/deep-link sync; **viewport-driven feature reload**
(feature vẫn load theo `DEFAULT_BBOX` cố định — demo data giữ trong bbox để search
hit đã được load và highlight được); Editor (digitize/topology/attribute/binding/
lease/validation/submit); plane Draft/Staging; perf 50k feature + WebGL/clustering
(Phase 3); BE thật / Keycloak thật (giai đoạn integration); basemap cần API key.

## 10. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Port phình lại như port cũ | Thêm đúng 4 method có nhu cầu thật; mỗi method một concern; không thêm "phòng xa" |
| Nâng port lên context phá vỡ test seam 2.1 | `MapRuntimeProvider` nhận prop `factory` — mock port inject một lần thay cho `mapFactory` per-feature |
| Search hit nằm ngoài vùng đã load → highlight trống | Demo data giữ trong `DEFAULT_BBOX`; viewport-driven reload là non-goal, ghi rõ |
| layer-control kéo chunk engine chỉ để lấy nhãn basemap | `BASEMAPS` catalog là dữ liệu thuần ở `index.ts`; source factory `ol` ở `openlayers/basemaps.ts` sau chunk lazy |
| Cross-feature coupling (search ↔ selection) | search phát `onSelect` lên page; page nối vào `selection-store`; feature không import feature |
| pointermove gây render dày | coordinate-readout throttle hiển thị (dùng `use-throttle` đã có); adapter giữ raw |
