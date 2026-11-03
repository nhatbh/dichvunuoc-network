# GIS Core — Editor Connect node↔pipe (design)

- **Ngày**: 2026-06-17
- **Trạng thái**: Đã thống nhất design, chờ review spec trước khi viết implementation plan
- **Story**: US-002 GIS Core (Viewer + Editor) — **slice 2.3b-3** (lát topology thứ hai, sau Split)
- **Mô hình**: fleet-SPA, FE độc lập hoàn toàn với BE (auth `mock`, data MSW) —
  xem `docs/decisions/0009-fe-fleet-via-core-template.md` + `0010-shell-platform-app-catalog.md`
- **Tham chiếu**: spec 2.3b-2 Split (`2026-06-17-gis-core-editor-split-pipe-design.md`, merged `7e538de`);
  spec 2.3b snap+modify (`8b318d2`); spec 2.3a digitize (`d56228f`); shared test factory
  `createFakePort` (`4baadd2`).

---

## 1. Bối cảnh & mục tiêu

Topology domain = split + **connect** + classify-crossing. 2.3b-2 đã làm **Split pipe** (pick 1 điểm trên
1 pipe → command `SplitPipe` mock → 2 pipe, KHÔNG node). Spec Split để lại **node/junction tại điểm cắt cho
Connect**. Slice này (**2.3b-3**) làm **Connect node↔pipe**: gắn 1 node có sẵn vào 1 pipe tại điểm chỉ định.

**Mục tiêu slice (Done khi):**

1. Toolbar có chế độ **Connect**: bật → click 1 **node** (draft) → click 1 **điểm trên pipe** (draft).
2. Mid-pipe → pipe **tách đôi** tại điểm (reuse logic split), node **dời về** junction, **2 pipe mới** đều
   tham chiếu node và node tham chiếu cả 2 pipe. Endpoint của pipe → **không tách**, chỉ attach (node dời về
   endpoint, node↔pipe tham chiếu lẫn nhau).
3. Connect là thao tác **lặp** (như Split/Modify): không reset mode; sau mỗi lần nối, xoá node đang chờ +
   `setSelection(null)` để nối tiếp.
4. Tất cả gates xanh (typecheck/lint/test/size); `ol` chỉ nằm trong adapter (tái dùng nguyên port hiện có,
   **không** thêm port-method) → `index` không phình.

**Trong phạm vi:** chế độ Connect (2 click cùng mode) · tái dùng `setFeaturePointMode`/`onFeaturePointPick`
cho **cả 2 click** (node rồi pipe, phân biệt bằng `kind`) · field `connectedFeatureIds` trên
`NetworkFeatureProps` · command `ConnectNodeToPipe` mock (POST) · contract `ConnectNodeToPipeRequest` ·
tái dùng helper `splitLineAt` (trích từ handler Split) · highlight node đang chờ qua `setSelection`.

> **Ngoài phạm vi (slice sau):** connect node↔node · disconnect/undo connect · auto-snap node gần nhất ·
> connect nhiều cặp một lần · classify-crossing (2.3b-4) · sửa published / copy-on-write / lineage (2.4) ·
> optimistic-concurrency (`expectedStreamVersion`/`409`), panel `422` (2.4) · attribute-edit (2.3c) ·
> continuity Viewer↔Editor (2.5) · BE thật / Keycloak thật.

## 2. Quyết định kiến trúc cốt lõi

**(a) KHÔNG thêm port-method — tái dùng nguyên `setFeaturePointMode`/`onFeaturePointPick`.** Cả 2 click
(pick node, pick điểm-trên-pipe) đều đi qua đúng 2 method generic đã có từ 2.3b-2. `onFeaturePointPick`
hit-test **mọi** feature draft: click node (Point) trả về vị trí node; click pipe (LineString) trả về điểm
chiếu lên line. **gis-core** sở hữu state machine 2-click và phân biệt node↔pipe bằng `kind` (tra trong
draft query). Giữ kỷ luật "+0 method slice này" (Split đã +2; Connect +0).

**(b) Geometry tính ở MSW mock, KHÔNG ở FE.** Mock tái dùng helper `splitLineAt(coords, atPoint)` (trích từ
handler Split) để tách line. FE giữ mỏng, không ôm geometry-domain. Khớp DDD/CQRS của BE (command là seam).

**(c) Node dời về junction (= `atPoint`, điểm chiếu của click-pipe).** Connectivity ghi **cả 2 cách**:
explicit (`connectedFeatureIds`) **và** hình học trùng toạ độ (node nằm đúng trên endpoint chung) — phòng vệ
hai lớp.

**(d) Mid-pipe → tách 2 pipe; endpoint → attach không tách.** Mid-pipe: thay pipe gốc bằng pipeA+pipeB,
cả hai `connectedFeatureIds += nodeId`; node `connectedFeatureIds = [pipeA.id, pipeB.id]`. Endpoint: giữ
pipe, `pipe.connectedFeatureIds += nodeId`; node `connectedFeatureIds = [pipe.id]`.

**(e) Connect là thao tác lặp — KHÔNG reset mode.** Như Split/Modify. Sau khi nối thành công: xoá
`pendingConnectNodeId` + `setSelection(null)`, giữ mode để nối cặp tiếp theo.

## 3. `@wn/map-runtime` — KHÔNG đổi port

Tái dùng nguyên `setFeaturePointMode(enabled)` / `onFeaturePointPick(cb: (featureId, point) => void)` đã có
từ 2.3b-2 (point = `Coordinate` lon/lat EPSG:4326, đã chiếu lên feature). Adapter `forEachFeatureAtPixel`
trên draft layer + `getClosestPoint` đã hoạt động cho cả Point (node trả về chính nó) lẫn LineString (pipe
chiếu lên line) — **không cần sửa adapter**. `createFakePort` đã có `setFeaturePointMode`/`onFeaturePointPick`
+ `emitFeaturePointPick` (từ 2.3b-2) → **không sửa factory**.

## 4. `@wn/contracts` — props connectivity + command connect

```typescript
// packages/contracts/src/map-features/index.ts — mở rộng NetworkFeatureProps
export const NetworkFeatureProps = z.object({
  kind: NetworkFeatureKind,
  name: z.string().optional(),
  status: z.string().optional(),
  connectedFeatureIds: z.array(z.string()).optional(),  // pipe → node-ids; node → pipe-ids (2 chiều)
});
```

```typescript
// packages/contracts/src/draft/index.ts (append)
export const ConnectNodeToPipeRequest = z.object({
  nodeId: z.string(),                  // node draft cần nối (click 1)
  atPoint: NetworkGeometry,            // Point (EPSG:4326), đã nằm trên line pipe (click 2)
  correlationId: z.string(),           // envelope command; chưa dùng expectedStreamVersion
});
export type ConnectNodeToPipeRequest = z.infer<typeof ConnectNodeToPipeRequest>;
```

Response tái dùng `DraftNetworkFeature[]` — trả các feature **bị ảnh hưởng**: node (đã dời + refs) + 1-hoặc-2
pipe. Build contracts để gis-core thấy export. Tái dùng builder `aDraftFeature`.

## 5. MSW — handler connect

`POST /snapshot/:snapshotId/draft/features/:pipeId/connect` trên working-set draft in-memory
(đã có từ 2.3a; reset giữa test):

- Parse `ConnectNodeToPipeRequest`; tìm `:pipeId` và `nodeId` trong working-set.
- Validate: pipe tồn tại (không → `404`) & là pipe/LineString (không → `400`); node tồn tại (không → `404`)
  & `kind==='node'` (không → `400`).
- Tìm vị trí `atPoint` trên pipe (closest-segment, chống lệch floating-point như Split §5):
  - **Interior** → `splitLineAt(coords, atPoint)` → thay pipe gốc bằng **2 pipe id mới** (props kế thừa),
    mỗi pipe `connectedFeatureIds += nodeId`. Node mới `connectedFeatureIds = [pipeA.id, pipeB.id]`.
  - **Endpoint** (atPoint trùng vertex đầu/cuối) → **không tách**; `pipe.connectedFeatureIds += nodeId`
    (dedupe). Node `connectedFeatureIds = [pipe.id]`.
- **Dời node**: geometry node ← `atPoint` (Point 4326). Dedupe `connectedFeatureIds` (idempotent khi nối lại).
- Trả `200` mảng feature bị ảnh hưởng (`[...pipe(s), node]`). Last-write-wins (không version).

Handler test: POST tạo node + pipe → connect mid → GET thấy **2 pipe** (id gốc mất) + node tại junction,
refs 2 chiều đúng; connect tại endpoint → **1 pipe** (không tách) + node dời + refs; pipeId không tồn tại →
404; nodeId không phải node → 400; body sai schema → 400/422.

## 6. `@wn/contracts` & MSW dùng chung helper hình học

Trích `splitLineAt(coordinates, atPoint): [Coordinate[], Coordinate[]]` từ handler Split hiện tại thành 1
hàm thuần (cùng vị trí mock helpers), Split handler + Connect handler **đều gọi**. Tránh lặp logic tách line.
(Nếu Split handler đang inline — refactor nhẹ: tách hàm, giữ test Split xanh.)

## 7. `apps/gis-core` — thay đổi FSD (tái dùng tối đa, không slice FSD mới)

```
apps/gis-core/src/
  features/digitize/
    model/digitize-store.ts     # EditMode thêm 'connect'; thêm signal pendingConnectNodeId
    ui/digitize-toolbar.tsx     # nút Connect; setFeaturePointMode bật cho 'split'|'connect';
                                #   onFeaturePointPick branch theo mode; state machine 2-click
  entities/draft-feature/
    api/commands.ts             # thêm connectNodeToPipe(snapshotId, pipeId, args)
    model/types.ts              # re-export ConnectNodeToPipeRequest
  features/draft-plane/         # KHÔNG đổi (vẫn setFeatures('draft', …) sau refetch)
  shared/api/query-keys.ts      # KHÔNG đổi (vẫn group draftFeatures)
```

- **`digitize-store`**: `EditMode = DrawKind | 'modify' | 'split' | 'connect'`. Thêm signal
  `pendingConnectNodeId` (`string | null`) + setter; `clear()`/đổi mode reset pending về null.
- **`DigitizeToolbar`**:
  - Nút **Connect** toggle `mode='connect'`.
  - Effect mode→side-effect: `setFeaturePointMode(m === 'split' || m === 'connect')` (các nhánh draw/modify
    giữ nguyên); đổi/clear mode reset pending node + `setSelection(null)`.
  - `onFeaturePointPick` effect **branch theo `store.mode()` đọc trong callback**:
    - `mode === 'split'` → giữ nguyên `split.mutate` hiện tại.
    - `mode === 'connect'` → tra `kind` của `featureId` qua
      `qc.getQueryData<DraftFeatureCollection>(queryKeys.draftFeatures.all(snapshotId))` (DraftPlane đã
      populate; đọc cache đồng bộ, không thêm query):
      - `kind === 'node'` → `setPendingConnectNodeId(id)`; `port.setSelection(id)` (highlight).
      - `kind === 'pipe'` & có pending → `connect.mutate({ nodeId: pending, pipeId: id, atPoint: Point(pt) })`.
      - `kind === 'pipe'` & chưa pending → no-op (chưa chọn node).
  - `connect` mutation `onSuccess` → `invalidate(draftFeatures)`; **xoá pending + `setSelection(null)`**;
    KHÔNG reset mode (§2e).
- **entity command**: `connectNodeToPipe(snapshotId, pipeId, { nodeId, atPoint })` sinh `correlationId`, POST
  `.../connect`. `model/types` re-export `ConnectNodeToPipeRequest`. Response parse `DraftNetworkFeature[]`.

## 8. Data flow

```
DigitizeToolbar click 'Connect'
  → digitize-store.setMode('connect')
    → createEffect: setDrawMode(null); setModifyMode(false); setFeaturePointMode(true)
      → adapter: +click handler (hit-test draft + closestPoint)
  → click 1 lên node draft → onFeaturePointPick(nodeId, point) → kind==='node'
    → setPendingConnectNodeId(nodeId); setSelection(nodeId)  // highlight
  → click 2 lên pipe draft → onFeaturePointPick(pipeId, point) → kind==='pipe' & pending
    → connect.mutate({ nodeId, pipeId, atPoint: Point(point), correlationId })
      → MSW POST /snapshot/:id/draft/features/:pipeId/connect → 200 [pipe(s), node] (working-set thay)
      → onSuccess: invalidate(draftFeatures) → DraftPlane refetch → setFeatures('draft', collection)
                   + setPendingConnectNodeId(null) + setSelection(null)
  → mode không reset → user nối cặp tiếp
```

Đọc `published` (bối cảnh) vẫn theo `DEFAULT_BBOX` cố định (viewport-driven reload là non-goal).

## 9. CRS, error & loading

- **CRS**: mọi geometry qua ranh giới app là EPSG:4326. Adapter chiếu click (3857) → 4326 trước khi qua port
  (đã có từ 2.3b-2). `atPoint` trong command là Point 4326.
- **Error**: command lỗi → toast (envelope lỗi hiện có); `400` (không phải pipe/node) + `404` (id sai) →
  toast, **không** vỡ map; `409`/`422` chưa xử lý (2.4). Đổi mode khi đang connect →
  `setFeaturePointMode(false)` gỡ handler sạch + reset pending + clear selection.
- **Loading/empty**: draft rỗng / click trượt → `onFeaturePointPick` không bắn (no-op vô hại). Click pipe khi
  chưa chọn node → no-op. Click node thứ hai khi đã có pending → **thay** pending bằng node mới (forgiving).
  Mutation pending → giữ mode; double-click hiếm → last-write-wins.

## 10. Rủi ro then chốt

- **Phân biệt node↔pipe phụ thuộc `kind` trong cache**: nếu draft query chưa load, `getQueryData` trả
  undefined → tra kind fail → no-op. An toàn (không nối nhầm); DraftPlane luôn load trước khi user thao tác.
- **`onFeaturePointPick` dùng chung Split+Connect**: callback phải đọc `store.mode()` **tại thời điểm bắn**
  (không capture cũ) để route đúng. Test cả 2 mode trên cùng handler.
- **Trích `splitLineAt` không được làm vỡ Split**: refactor thuần, chạy lại test handler Split trước khi thêm
  Connect (TDD: refactor dưới test xanh).
- **`setFeatures` rebuild draft source sau refetch** (như 2.3b-2 §9): connect không giữ sketch tạm; an toàn.
  Known-acceptable cho mock; optimize để 2.4.
- **ol-containment invariant**: hit-test/closestPoint/transform vẫn chỉ trong `ol-map-adapter.ts` (không đụng
  tới); gis-core chỉ thấy `(featureId, Coordinate)` — không rò `ol`.

## 11. Non-goals

connect node↔node; disconnect/undo; auto-snap node gần nhất (connect là pick-tường-minh 2 click);
connect nhiều cặp một lần; classify-crossing (2.3b-4); sửa published / copy-on-write / lineage (2.4);
attribute-edit + bulk (2.3c); optimistic-concurrency `expectedStreamVersion`/`409`, panel `422`;
continuity không-unmount + deep-link (2.5); BE thật / Keycloak thật.

## 12. Testing

| Lớp | Đối tượng |
|---|---|
| Contract (zod) | `ConnectNodeToPipeRequest` parse hợp lệ/không (nodeId, atPoint là Point, correlationId); `NetworkFeatureProps.connectedFeatureIds` optional array |
| Helper unit | `splitLineAt(coords, atPoint)` tách đúng 2 nhánh (mid) — chia sẻ Split+Connect |
| MSW handler | connect mid → GET 2 pipe (id gốc mất) + node tại junction + refs 2 chiều; connect endpoint → 1 pipe (không tách) + node dời + refs; pipeId sai → 404; nodeId không phải node → 400; body sai → lỗi |
| Entity | `connectNodeToPipe` mutation (POST body nodeId + atPoint Point + correlationId; parse `DraftNetworkFeature[]`) |
| Component | `DigitizeToolbar`: nút Connect toggle `setFeaturePointMode`; node→pipe pick → `connect.mutate` đúng args + `setSelection`; node→node pick → thay pending; pipe khi chưa pending → no-op; loại trừ với Pipe/Node/Modify/Split; mode không reset sau connect |
| Integration | `GisEditorPage`: bật Connect → `emitFeaturePointPick(nodeId)` rồi `emitFeaturePointPick(pipeId, pt)` → plane: 1 pipe thành 2 + node tại junction |
| Size | tái dùng chunk `ol-map-adapter-*` (không đụng adapter); `index` không phình |

Component/integration test dùng **Appendix A test prelude** + `createFakePort` (auth isolation +
re-impl `createMapRuntime` trên Solid gis-core + strip AbortSignal) như test render runtime của 2.2/2.3a/2.3b.

## 13. Self-review

- **Spec coverage**: §2-click reuse pick → §2a + §3 + §7. §command connect mock → §4 + §5. §helper chung →
  §6. §props connectivity 2 chiều → §2c-d + §4. §toolbar mode 'connect' + state machine + không reset → §2e +
  §7 + §8. §mid vs endpoint → §2d + §5. §rủi ro kind-cache/shared-handler/refactor → §10. ✓
- **Type consistency**: `onFeaturePointPick(id, Coordinate 4326)` ↔ gis-core gói Point → command
  `ConnectNodeToPipeRequest.atPoint = NetworkGeometry` (Point lon/lat) + `nodeId: string`; response
  `DraftNetworkFeature[]`; `connectedFeatureIds?: string[]`. ✓
- **Placeholder scan**: không TBD/TODO; mỗi mảnh có file path + signature. ✓
- **Ambiguity check**: thứ tự click = node-trước-pipe (nêu rõ §2a/§8); node-thứ-hai thay pending (§9);
  mid vs endpoint định nghĩa rõ (§5); kind tra qua `getQueryData` (§7). ✓
- **Scope**: một plan đủ gọn (0 port-method, mở rộng 1 props + 1 contract request, 1 MSW handler + 1 helper
  trích chung, 1 entity command, mở rộng 1 store + 1 toolbar — không slice FSD mới). Connect node↔node +
  classify-crossing đã để 2.3b-4/sau. ✓
