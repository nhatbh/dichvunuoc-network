# GIS Core — Viewer Foundation (design)

- **Ngày**: 2026-06-15
- **Trạng thái**: Đã thống nhất design, chờ review spec trước khi viết implementation plan
- **Story**: US-002 GIS Core (Viewer + Editor) — **slice đầu tiên** (xem Decomposition)
- **Mô hình**: fleet-SPA, FE độc lập hoàn toàn với BE (auth `mock`, data MSW) —
  xem `docs/decisions/0009-fe-fleet-via-core-template.md`
- **Tham chiếu**: rewrite design §5 (`2026-06-15-water-network-fe-rewrite-design.md`);
  pattern đã chứng minh trong `water-network-gis/water-network-gis-fe`
  (`MapEnginePort` + `openlayers-adapter`); mockup thị giác
  `water-network-gis/water-network-gis-ui`

---

## 1. Bối cảnh & mục tiêu

US-002 "GIS Core (Viewer + Editor)" là Phase 1 — trọng tâm, rủi ro cao nhất, quá
lớn cho một spec. Ta **chẻ nhỏ**; spec này chỉ làm **nền Viewer**.

Mục tiêu slice: dựng một lát cắt dọc **mỏng nhưng xuyên kiến trúc thật** để:

1. Khử sớm rủi ro #1 còn lại của GIS: chạy OpenLayers trong một MFE Solid, lazy-load,
   sau ranh giới port sạch.
2. Cố định ranh giới `@wn/map-runtime` ↔ `@wn/contracts` ↔ FSD slices của gis-core.

**Done khi**: map render (basemap + 1 vector layer Published lấy từ MSW), pan/zoom,
click feature → highlight + detail panel; gates xanh.

> **Scope note (sau final review):** `map-shell` widget + `coordinate bar` (đọc
> lon/lat theo con trỏ) **dời sang slice 2.2** — cần thêm method pointer-move trên
> port + adapter. Slice 2.1 compose page = canvas + properties-palette trực tiếp.

## 2. Decomposition US-002

| Slice | Nội dung | Spec |
|---|---|---|
| **2.1 Viewer foundation** | map-canvas + render features Published từ mock + select → detail | **spec này** |
| 2.2 Viewer mở rộng | **map-shell + coordinate bar** (dời từ 2.1), layer-control/basemap, feature-search, related (1-hop), lineage | sau |
| 2.3 Editor core | digitize, topology-edit, attribute-edit | sau |
| 2.4 Editor workflow | asset-binding, spatial-lease, draft-validation, draft-submit | sau |
| 2.5 Continuity | Viewer↔Editor không unmount map, deep-link | sau |

Mỗi slice = spec → plan → implement riêng.

## 3. `@wn/map-runtime` (package mới, publishable, `file:` dep)

Đặt tại `packages/map-runtime`, tiêu thụ bởi `apps/gis-core` qua
`file:../../packages/map-runtime` (như `@wn/contracts`; đổi sang registry ở giai
đoạn integration).

```
packages/map-runtime/src/
  port/
    map-engine-port.ts      # interface — ZERO type ol lọt ra
    types.ts                # Coordinate, Viewport, MapViewOptions, BaseMapLayerConfig
  openlayers/               # NƠI DUY NHẤT import ol/* + proj4 (ESLint chặn nơi khác)
    lifecycle-adapter.ts    # init map/view/projection, mount/destroy
    layer-adapter.ts        # vector layer Published plane: setFeatures(FeatureCollection)
    style-adapter.ts        # style theo kind + style highlight
    picker-adapter.ts       # hit-test → feature:click(id)
    crs.ts                  # registerVietnamCrs() (EPSG:3405/9210, UTM48N) qua proj4
  factory.ts                # createMapInstance(opts): MapEnginePort (lazy import ./openlayers)
  solid/
    use-map-runtime.ts      # tích hợp Solid: tạo/destroy theo lifecycle, lazy-load chunk
  index.ts
```

`MapEnginePort` (bề mặt Viewer tối giản):

```ts
export interface MapEnginePort {
  mount(target: HTMLElement): void;
  setView(view: Viewport): void;
  getView(): Viewport;
  setFeatures(layerId: string, features: FeatureCollection): void; // Published plane
  setSelection(featureId: string | null): void;                    // highlight
  onFeatureClick(cb: (featureId: string) => void): () => void;     // trả unsubscribe
  destroy(): void;
}
```

Nguyên tắc:

- **Projection**: data qua port là **EPSG:4326** (lon/lat); view mặc định
  **EPSG:3857**; VN-2000 (`EPSG:3405`/`EPSG:9210`, UTM 48N) đăng ký sẵn qua proj4
  cho dữ liệu thật sau.
- `factory.createMapInstance()` **lazy-import** `./openlayers` để `ol`+`proj4` nằm
  trong chunk riêng (`map-engine`, budget size-limit ≤200KB gz).
- Port chỉ dùng type thuần (GeoJSON + plain). **Không** nhiễm contract domain hay
  post-MVP như port cũ (isolation-trace/topology/pressure-zone bị loại).
- Port-and-split: chắt lọc logic đã chứng minh từ `openlayers-adapter.ts` cũ
  (lifecycle/layer/style/picker/CRS) thành các file <400 dòng.

## 4. `@wn/contracts` — thêm context `map-features`

```ts
// @wn/contracts/map-features
export const NetworkFeatureKind = z.enum(['pipe', 'node', 'facility', 'component']);
export const NetworkFeatureProps = z.object({
  kind: NetworkFeatureKind,
  name: z.string().optional(),
  status: z.string().optional(),
  // ... thuộc tính hiển thị tối thiểu cho detail panel
});
// GeoJSON, geometry EPSG:4326, id ổn định để highlight/selection
export const NetworkGeometry = z.object({
  type: z.enum(['Point', 'LineString', 'Polygon']),
  coordinates: z.unknown(), // GeoJSON coords (lon/lat); tinh chỉnh theo kind nếu cần
});
export const NetworkFeature = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: NetworkGeometry,
  properties: NetworkFeatureProps,
});
export const MapFeatureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(NetworkFeature),
});
```

- Query (mock): `GET /snapshot/:id/features?bbox=minx,miny,maxx,maxy` →
  `MapFeatureCollection`. Zod parse ở biên (drift contract → throw, không làm hỏng UI âm thầm).
- `aMapFeatureCollection()` builder trong `@wn/contracts/testing` (vài feature mỗi kind).
- `snapshot` context (đã có) cung cấp metadata snapshot cho header/empty-state.

## 5. `apps/gis-core` — FSD slices

```
entities/
  snapshot/            # đã có (reference slice US-001)
  map-feature/         # model (type từ @wn/contracts/map-features) + api getMapFeatures(snapshotId, bbox)
features/
  map-canvas/          # SỞ HỮU map instance (factory), mount, đẩy features vào port; viewport-store
  feature-selection/   # nghe onFeatureClick → selection-store → setSelection(highlight)
widgets/
  map-shell/           # layout: container map + coordinate bar + slots
  properties-palette/  # panel detail feature đang chọn
routes/
  gis.tsx              # /gis — compose map-shell + canvas + selection + properties-palette
shared/api/mocks/      # thêm handlers: snapshot detail + map-features bbox
```

Store tách concern (sửa god-store cũ): `viewport-store`, `selection-store` — Solid
signals/stores nhỏ, một concern mỗi store.

Tuân thủ boundaries (template): feature không import feature khác (chỉ qua widget
chung/`@wn/*`); chỉ `@wn/map-runtime/openlayers/*` import `ol/*`.

## 6. Data flow

```
route /gis
  → useQuery getSnapshot(id) + useQuery getMapFeatures(id, bbox)   (QueryClient)
    → MSW mock trả payload → Zod parse (@wn/contracts)
  → features/map-canvas: port.setFeatures('published', fc) → render
  → user click → picker-adapter → onFeatureClick(id) → selection-store.set(id)
       → port.setSelection(id) (highlight) + properties-palette hiển thị props
```

- Server state: TanStack Solid Query (mock adapter qua MSW).
- Client state: `selection-store`, `viewport-store` (trong MFE).
- Slice này chưa cần event bus / URL-sync (để slice continuity sau).

## 7. CRS, error & loading

- Mock geometry EPSG:4326; coordinate bar hiện lon/lat; VN-2000 đăng ký sẵn.
- `Suspense` cho query (skeleton map); `ErrorBoundary` route-level (template) cô lập lỗi.
- Empty-state khi snapshot không có feature; fallback khi lazy-load chunk `ol` lỗi.

## 8. Testing

| Tầng | Cases |
|---|---|
| Unit (map-runtime) | port contract; logic thuần adapter (projection transform, props→style, feature→geojson) |
| Component (map-runtime) | dùng **mock MapEnginePort** (không cần canvas thật) |
| Contract (contracts) | round-trip parse `MapFeatureCollection` + khớp builder |
| Component (gis-core) | `feature-selection`: mock port, click → detail panel đúng |
| Integration (gis-core) | MSW `getMapFeatures` bbox → parse → render path |
| Smoke | route `/gis` mount không lỗi |
| Size | chunk `map-engine` ≤200KB gz; file <400 dòng |

**DoD**: trong scope; qua boundaries + size gate; có unit + component test với mock;
khớp contract test; MFE chạy standalone (mock auth); không file >600 dòng.

## 9. Non-goals

Editor (digitize/topology/attribute/binding/lease/validation/submit); plane
Draft/Staging; feature-search; layer-control/basemap switcher (1 basemap mặc định);
related/lineage; perf 50k feature + WebGL/clustering (Phase 3); BE thật / Keycloak
thật (giai đoạn integration).

## 10. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| OpenLayers trong MFE Solid (lifecycle, lazy-load) | Slice mỏng dựng đúng đường này trước; `use-map-runtime` quản lý tạo/destroy theo Solid lifecycle |
| Test adapter cần canvas | Tách logic thuần để unit test; component test qua mock port |
| Port phình lại như cũ | Bề mặt tối giản; chỉ thêm method khi slice sau cần |
| Lệch shape feature với BE thật | Zod parse ở biên; contract test; cố định `map-features` theo bounded context BE |
