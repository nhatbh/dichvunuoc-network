# Master Implementation Roadmap — Water Network Backend Platform

**Ngày:** 2026-06-13 · **Cập nhật trạng thái:** 2026-08-06
**Trạng thái:** Đang triển khai — Phase 0–3 hoàn tất; Phase 4 chuyển sang `water-fsm`; ZON-1 hoàn tất trên PR #13; OBS-1 là slice kế tiếp.
**Nguồn:** `docs/spec-init-01.md` (SPEC v1.0), `docs/superpowers/specs/2026-06-11-water-network-platform-design.md` (design đã duyệt), `docs/conventions/template-mapping.md` (scaffold recipe), `docs/orchestration/ROADMAP.md`, code trên `main` và `feat/water-network-zone-be`.

Tài liệu này là **kế hoạch triển khai tổng thể cho toàn bộ microservices** của Water Network Platform: phân tích bản chất từng bài toán, quyết định thiết kế cụ thể, và thứ tự triển khai từng phần (slice) của từng service. Mỗi phase khi bắt đầu sẽ có plan thực thi chi tiết riêng (mức task/checkbox như `2026-06-11-phase0-foundation-register-node.md`); tài liệu này là tầng trên — trả lời *làm gì, vì sao, theo thứ tự nào*.

---

## 1. Hiện trạng — cái đã có và cái còn thiếu

### 1.1 Snapshot triển khai ngày 2026-08-06

| Phase/slice | Trạng thái thực tế |
|---|---|
| Phase 0 — Foundation | done: monorepo .NET 10, 9 building blocks, PostGIS/RabbitMQ/Redis/OTel, test fixtures |
| Phase 1 — GIS + Asset + BFF | done: GIS-1..5, AST-1..2, BFF-1 |
| Phase 2 — Design → GIS | done: DSN-1..4; CAD import DSN-5 là follow-up độc lập |
| Phase 3 — Topology + Incident | done: TOP-1..3, INC-1..3 |
| Phase 4 — Maintenance | moved: chuyển sang `water-fsm` theo decision 0025; contract producer phía Water Network đã có |
| Phase 5 — ZON-1 | done trên `feat/water-network-zone-be`/PR #13, chưa merge/deploy. Xác minh 2026-08-06 bằng SDK 10.0.101 cài trên máy: build 0 warning; 35 unit + 8 contract + 6 integration tests xanh; Compose config hợp lệ. CI phải chạy lại SDK 10.0.107 đang pin |
| Phase 5 — OBS-1..3 | todo; chưa có service directory, branch, worktree hay claim. OBS-1 là slice kế tiếp |
| Local integration WIP | tenant/auth, app entitlement, canonical GIS data và K3s có thay đổi chưa commit; không tính là `done` cho tới khi tách scope và test xanh |

### 1.2 Còn thiếu so với SPEC (toàn cảnh)

- **Release gap:** merge/rebase PR #13, deploy ZON-1 và smoke-test tenant isolation/spatial queries.
- **Phase 5:** OBS-1 mapping + ingest, OBS-2 latest/history, OBS-3 threshold/abnormal detection.
- **Phase 6:** HYD-1..3 model snapshot, scenario, EPANET export/import và result query.
- **Phase 7:** CIM-1..2 customer impact + RPT-1 reporting tối giản.
- **Cross-cutting:** đóng gói tenant-first/auth WIP, permission `network-observation:*`, CI matrix, production adapter và observability cho ingest throughput.

---

## 2. Phân tích bản chất bài toán (first principles)

Trước khi xếp thứ tự, phải trả lời: *vì sao hệ thống này tách thành 10 service, và điều gì quyết định service nào trước, service nào sau?* Câu trả lời không nằm ở "spec bảo thế" mà ở bản chất dữ liệu và bản chất nghiệp vụ.

### 2.1 Mạng lưới nước = một đồ thị không gian có trạng thái, quan sát theo thời gian

Mọi nghiệp vụ trong SPEC đều xoay quanh **một thực thể vật lý duy nhất** — mạng ống nước — nhưng nhìn nó qua **5 lăng kính có chu kỳ thay đổi và mô hình truy vấn khác hẳn nhau**:

| Lăng kính | Bản chất dữ liệu | Mô hình truy vấn tối ưu | Chu kỳ thay đổi | Service sở hữu |
|---|---|---|---|---|
| **Hình học / không gian** | điểm, tuyến, vùng (geometry) | spatial index (GiST, bbox, radius) | thấp (khi thi công/chỉnh sửa bản đồ) | `gis-be`, `zone-be` |
| **Hồ sơ / vòng đời** | bản ghi master-data có state machine | key-value lookup, list/filter | trung bình (theo sự kiện vận hành) | `asset-be` |
| **Cấu trúc liên kết** | đồ thị G=(V,E) thuần túy | graph traversal (BFS/DFS, cut-set) | thấp, nhưng truy vấn cần **độ trễ ms** | `topology-rs` |
| **Chuỗi đo theo thời gian** | (device, timestamp, value) append-only | time-bucket scan, latest-per-key | **rất cao** (hàng nghìn điểm/phút) | `observation-be` |
| **Quy trình nghiệp vụ** | workflow có trạng thái, phê duyệt, tài liệu | theo id + state transitions + audit | theo nhịp con người | `design-be`, `incident-be`, `maintenance-be`, `hydraulic-be`, `customer-impact-be` |

**Hệ quả 1 — ranh giới service không tùy tiện.** Mỗi lăng kính cần một engine lưu trữ/truy vấn khác nhau (PostGIS vs Postgres thường vs in-memory graph vs TimescaleDB). Gộp chúng vào một service nghĩa là một database phải gánh nhiều mô hình truy vấn xung đột — đó chính là God Service mà SPEC cấm.

**Hệ quả 2 — chiều dữ liệu chảy một hướng.** Hình học là *nền* (mọi thứ tham chiếu vào asset trên bản đồ); trạng thái tham chiếu hình học; đo đạc tham chiếu thiết bị; quy trình tham chiếu tất cả. Do đó thứ tự xây dựng tất yếu là: **GIS → Asset → (Design, Topology) → quy trình (Incident → Maintenance) → đo đạc (Observation) → phân tích (Hydraulic, Customer-Impact)**. Roadmap 8 phase của SPEC chính là topo-sort của đồ thị phụ thuộc này — kế hoạch dưới đây giữ nguyên thứ tự đó và làm rõ phụ thuộc ở mức slice.

### 2.2 "View can be composed. Write must be owned." — hệ quả kỹ thuật cụ thể

Nguyên tắc lõi của SPEC suy ra 4 pattern bắt buộc, đã có sẵn trong building blocks, và **mọi slice trong kế hoạch này đều phải đi qua đủ 4**:

1. **Mỗi fact có đúng một nơi quyết định** → command vào service owner; service khác chỉ biết qua integration event. Không bao giờ có "ghi hộ".
2. **Database-per-service ⇒ nhất quán cuối là tất yếu, không phải lựa chọn** → mọi dữ liệu liên-service trong một service là **projection cục bộ** (vd `network_asset_states` trong GIS), được phép trễ, được phép null (US-P1-07 quy định rõ: GIS có asset nhưng lifecycle chưa sync → trả lifecycle null, không lỗi).
3. **At-least-once delivery ⇒ consumer idempotent là bắt buộc** → outbox phía publish (đã có `OutboxProcessor`), inbox/`ProcessedEventStore` phía consume. Mọi handler consume event trong kế hoạch này đều khai báo khóa idempotency = `eventId`.
4. **Service deploy độc lập ⇒ contract phải version hóa** → mọi event có `eventVersion`; thay đổi phá vỡ = tạo version mới + consumer chịu được version lạ (log warning, không crash). Contract test 2 phía cho từng event.

### 2.3 Multi-tenancy là trục phân vùng, không phải tính năng

`tenant_id` xuất hiện ở **mọi** bảng nghiệp vụ, mọi command context, mọi event envelope, mọi log scope. Bản chất: một dòng dữ liệu không có tenant là một dòng dữ liệu *không định nghĩa được quyền sở hữu*. Building block MultiTenancy đã resolve context; phần còn thiếu mang tính kỷ luật: (a) unique constraint nghiệp vụ luôn là `(tenant_id, business_key)` — vd `(tenant_id, asset_code)`; (b) EF global query filter theo tenant cho mọi DbContext mới; (c) integration test "tenant A không thấy dữ liệu tenant B" là test bắt buộc của mỗi service mới.

### 2.4 Ma trận ownership (chuẩn đối chiếu khi review mọi PR)

| Fact | Owner duy nhất | Ai được nhìn (qua đâu) |
|---|---|---|
| Geometry node/pipe/device | gis-be | topology-rs, hydraulic-be (event/snapshot), BFF |
| Trạng thái vòng đời asset | asset-be | gis-be (projection), maintenance, BFF |
| Draft/approval thiết kế | design-be | gis-be (chỉ nhận `design.asset.ready-for-gis`) |
| Ranh giới zone/DMA | zone-be | observation (threshold theo zone), customer-impact |
| Kết quả graph/isolation | topology-rs (tính, **không lưu**) | incident-be lưu `IsolationPlan` |
| Vòng đời sự cố | incident-be | maintenance (event), customer-impact (event), BFF |
| Work order, vật tư | maintenance-be | asset-be (event), notification |
| Telemetry readings | observation-be | BFF, incident (alert events) |
| Model/simulation thủy lực | hydraulic-be | BFF |
| Affected customers snapshot | customer-impact-be | notification, reporting |

---

## 3. Thứ tự triển khai tổng thể

### 3.1 Đồ thị phụ thuộc giữa các workstream

```text
[ĐÃ XONG] Phase 0: building blocks + gis-be (RegisterNode)
    │
    ▼
P1.A  gis-be hoàn thiện core ──────► P1.B  asset-be ──► P1.C  gis projection
      (pipe, device, remove,               (consume,          (asset.status →
       bbox query)                          lifecycle)         network_asset_states)
    │                                                              │
    │                                                              ▼
    │                                                        P1.D  bff (overview)
    ▼
P2.A  design-be (project/document/draft/approve) ──► P2.B  publish → GIS
    │                                                      (gis-be consume draft)
    ▼
P3.A  topology-rs (graph từ GIS events) ──► P3.B  incident-be ──► P3.C  isolation
    │                                                                  qua gRPC
    ▼
P4    maintenance-be (work order từ incident event)
    │
    ▼
P5.A  zone-be (tối giản: DMA/boundary/assignment)
P5.B  observation-be (mapping, ingest, latest, threshold/abnormal)
    │
    ▼
P6    hydraulic-be (model từ snapshot GIS+topology, EPANET export)
    │
    ▼
P7.A  customer-impact-be (từ isolation-plan-confirmed)
P7.B  reporting tối giản (report job + file storage adapter)
```

Quy tắc đọc: mũi tên = "cần output của bước trước làm input". Trong cùng một phase, các slice đánh chữ (A, B, C) phải tuần tự; khác nhánh có thể song song (vd P5.A và P5.B chỉ giao nhau ở threshold-theo-zone, có thể làm song song nếu chốt contract `zone.created` trước).

### 3.2 Nguyên tắc cắt slice (áp dụng cho mọi phase)

1. **Mỗi slice là một luồng nghiệp vụ end-to-end chạy được** (command → domain → persistence → event → consumer/query → test), không phải một layer. Không bao giờ tạo service rỗng trước rồi "đổ logic sau".
2. **Slice đầu tiên của một service mới luôn là slice mỏng nhất chứng minh scaffold** — đúng recipe `template-mapping.md §2` (slnx → Domain TDD → Application TDD → Infrastructure + migration → Contracts → Api + E2E → Dockerfile + compose).
3. **Consumer trước producer khi tích hợp chéo**: chốt contract event (record trong `Contracts/Events` + contract test) trước khi viết cả 2 phía; producer và consumer có thể merge độc lập vì contract test giữ 2 đầu.
4. **Mỗi slice kết thúc bằng:** `dotnet test <Service>.slnx` xanh, 0 warning; cập nhật `template-mapping.md` nếu sinh pattern mới; conventional commit.

### 3.3 Bảng tổng hợp phase → slices (chỉ mục của các mục §4–§14)

| Phase | Slice | Service | User stories | Phụ thuộc |
|---|---|---|---|---|
| 1 | GIS-1 RegisterPipe | gis-be | US-P1-02 | — |
| 1 | GIS-2 InstallDevice | gis-be | US-P1-03 | GIS-1 |
| 1 | GIS-3 Remove/soft-delete + Relocate ✓ | gis-be | catalog §5.1 | GIS-2 |
| 1 | GIS-4 GetAssetsInBbox ✓ | gis-be | US-P1-04 | GIS-2 |
| 1 | AST-1 Scaffold + consume registered events ✓ | asset-be | US-P1-05 | GIS-1 contract |
| 1 | AST-2 Lifecycle commands + status events ✓ | asset-be | catalog §5.2 | AST-1 |
| 1 | GIS-5 Projection `network_asset_states` ✓ | gis-be | US-P1-06 | AST-2 contract |
| 1 | BFF-1 Asset overview + map ✓ | bff | US-P1-07 | GIS-4, AST-2 |
| 2 | DSN-1 Project + Document (file-storage port) ✓ | design-be | US-P2-01, 02 | — |
| 2 | DSN-2 Draft assets + validate ✓ | design-be | US-P2-03, 04 | DSN-1 |
| 2 | DSN-3 Submit/Approve/Reject revision ✓ | design-be | US-P2-05 | DSN-2 |
| 2 | DSN-4 Publish → GIS (`ready-for-gis` → consume) ✓ | design-be + gis-be | US-P2-06 | DSN-3 |
| 3 | TOP-1 Rust scaffold + graph từ events ✓ | topology-rs | US-P3-01 | GIS events |
| 3 | TOP-2 ValidateTopology + gRPC ✓ | topology-rs | US-P3-02 | TOP-1 |
| 3 | INC-1 Report/Classify incident ✓ | incident-be | US-P3-03 | — |
| 3 | INC-2 Isolation analysis qua gRPC ✓ | incident-be | US-P3-04 | TOP-2, INC-1 |
| 3 | INC-3 Confirm plan + work-order-requested ✓ | incident-be | US-P3-05 | INC-2 |
| 4 | ⚠️ MOVED → khối `water-fsm` (FSM-1) — xem decision 0025 | ~~maintenance-be~~ water-fsm-be | US-P4-01, 03 | INC-3 contract |
| 4 | ⚠️ MOVED → FSM-2 (assign/schedule) — decision 0025 | water-fsm-be | US-P4-02 | FSM-1 |
| 4 | ⚠️ MOVED → FSM-3 (repair/material) — decision 0025 | water-fsm-be | US-P4-04 | FSM-1 |
| 5 | ZON-1 Zone tối giản (DMA, boundary, assignment) ✓ (PR #13, chưa merge/deploy) | zone-be | catalog §5.4 | GIS-4 |
| 5 | OBS-1 Device mapping + ingest readings | observation-be | US-P5-01, 02 | AST contract |
| 5 | OBS-2 Latest summary + history | observation-be | US-P5-03 | OBS-1 |
| 5 | OBS-3 Threshold + abnormal detection | observation-be | US-P5-04 | OBS-2, ZON-1 |
| 6 | HYD-1 Model từ snapshot | hydraulic-be | US-P6-01 | TOP-2 |
| 6 | HYD-2 Scenario + EPANET export | hydraulic-be | US-P6-02, 03 | HYD-1 |
| 6 | HYD-3 Simulation result import/query | hydraulic-be | US-P6-04 | HYD-2 |
| 7 | CIM-1 Impact analysis từ isolation plan | customer-impact-be | US-P7-01 | INC-3, ZON-1 |
| 7 | CIM-2 Confirm snapshot + notification event | customer-impact-be | US-P7-02 | CIM-1 |
| 7 | RPT-1 Report job tối giản | reporting (module/BFF) | US-P7-03 | CIM-2 |

Cross-cutting (US-X-01..03) không phải phase riêng — xem §15: mỗi mục có "điểm kích hoạt" gắn vào slice cụ thể.

---

## 4. `water-network-gis-be` — hoàn thiện core không gian (Phase 1–2)

### 4.1 Bản chất

GIS service là **source of truth cho hình học**, và chỉ hình học. Cám dỗ lớn nhất của hệ này là nhét lifecycle/incident/import-parsing vào GIS vì "tiện đang ở đó" — SPEC cấm tuyệt đối. Hai bất biến nền tảng:

- **Mọi geometry là EPSG:4326** (quyết định #6). VN-2000 chỉ xuất hiện ở import job (Phase 2) dưới dạng chuyển đổi tại biên — bên trong service không bao giờ có SRID thứ hai.
- **Pipe là quan hệ giữa 2 node tồn tại** — đây là mầm của topology. GIS chỉ giữ bất biến cục bộ (endpoint tồn tại, không self-loop); phân tích đồ thị toàn cục thuộc topology-rs.

### 4.2 Domain model bổ sung

| Thành phần | Loại | Bất biến / quy tắc |
|---|---|---|
| `NetworkPipe` | Aggregate | `fromNodeId ≠ toNodeId`; cả 2 node tồn tại + chưa xóa (check qua repository trong handler — không phải trong aggregate vì cần I/O); geometry là `LineString` SRID 4326 ≥ 2 điểm; `diameterMm > 0`; `material` thuộc danh mục; `lengthM` tính từ geometry (`ST_Length(geography)`) nếu client không gửi — nếu gửi thì chênh lệch >10% so với tính toán → validation warning lưu kèm |
| `NetworkDevice` | Aggregate | `deviceType ∈ {Valve, FlowMeter, PressureSensor, Pump, Hydrant}`; quy tắc host: `Valve/FlowMeter` bắt buộc `hostPipeId`, `PressureSensor` cần `hostPipeId` hoặc `hostNodeId`, `Pump/Hydrant` cần `hostNodeId`; host phải tồn tại; location là `Point` 4326 |
| `GeometryVersion` | Entity (append-only) | mỗi lần geometry đổi (register/relocate/reroute) ghi 1 bản ghi `{assetId, assetKind, version, geometry, changedBy, changedAt, reason}`; không bao giờ update/delete |
| `PipeGeometry`, `DeviceType`, `PipeMaterial`, `Diameter` | Value objects | parse-first tại boundary, bên trong chỉ dùng typed VO |
| Soft delete | `ISoftDeletable` (đã có trong BB) | remove = set `deleted_at` + domain event; query mặc định lọc; không hard delete vì geometry version + event đã phát ra ngoài |

### 4.3 Data model (migrations dự kiến)

```sql
-- M2: network_pipes
create table network_pipes (
  id uuid primary key, tenant_id text not null,
  asset_code text not null, from_node_id uuid not null, to_node_id uuid not null,
  geometry geometry(LineString, 4326) not null,
  diameter_mm int not null, material text not null, length_m double precision not null,
  status text not null default 'Active', deleted_at timestamptz null,
  created_at timestamptz, updated_at timestamptz, row_version bytea,
  unique (tenant_id, asset_code));
create index ix_pipes_geom on network_pipes using gist (geometry);
create index ix_pipes_from_to on network_pipes (tenant_id, from_node_id, to_node_id);

-- M3: network_devices (point geometry + host refs, unique (tenant_id, asset_code), GiST index)
-- M4: geometry_versions (asset_id, asset_kind, version int, geojson text, geometry nullable, unique (asset_id,version), btree index — no GiST, no soft-delete filter; SHIPPED in GIS-3)
-- M5: network_asset_states (projection — xem GIS-5)
```

### 4.4 API & contract

| Endpoint | Command/Query | Event |
|---|---|---|
| `POST /api/v1/gis/pipes` | `RegisterPipeCommand` | `network.pipe.registered` v1 `{pipeId, assetCode, fromNodeId, toNodeId, lengthM, diameterMm, material}` |
| `GET /api/v1/gis/pipes/{id}` | `GetPipeDetailQuery` (Dapper) | — |
| `POST /api/v1/gis/devices` | `InstallDeviceCommand` | `network.device.installed` v1 `{deviceId, assetCode, deviceType, hostPipeId?, hostNodeId?, location}` |
| `GET /api/v1/gis/devices/{id}` | `GetDeviceDetailQuery` | — |
| `DELETE /api/network/nodes/{id}` (+pipes/devices) | `RemoveNodeCommand`… | `network.node.deleted` v1, `network.pipe.deleted` v1, `network.device.deleted` v1 — node đang là endpoint của pipe chưa xóa → 422 business rule `NodeHasConnectedPipes` (decision 0010) |
| `PATCH /api/network/nodes/{id}/location` | `RelocateNodeCommand` | `network.node.relocated` v1 (`network.geometry.changed` v1 **deferred** → topology-rs Phase 3, khi có consumer thật) |
| `GET /api/v1/gis/assets?bbox=&types=&limit=` | `GetAssetsInBboxQuery` | — |

Chi tiết bbox query (US-P1-04 — quyết định hiệu năng quan trọng nhất của service):

- Dapper thuần qua `SqlReadDao`, **không** EF: `where geometry && ST_MakeEnvelope(@minLng,@minLat,@maxLng,@maxLat,4326) and deleted_at is null and tenant_id=@tenantId limit @limit` cho từng bảng, union 3 loại theo `types` filter.
- Validation: `minLng<maxLng`, `minLat<maxLat`, bbox diện tích quá lớn (> ngưỡng config, vd 1 độ²) → 400 kèm hướng dẫn zoom — chặn full-table scan từ FE zoom-out.
- `limit` mặc định 2000, max 10000; response có `truncated: true` khi chạm limit.
- Left join `network_asset_states` để trả `lifecycleStatus` (null khi projection chưa có — đúng US-P1-06).
- GeoJSON-shaped response (FeatureCollection-like) để FE render thẳng.

### 4.5 Thứ tự triển khai trong service

1. **GIS-1 RegisterPipe** — VO `PipeGeometry/Diameter/PipeMaterial` (TDD) → aggregate `NetworkPipe` + `PipeRegistered` → command/validator/handler (mock `INetworkNodeRepository` check endpoints) → migration M2 → mapper event → endpoint + E2E (happy, endpoint thiếu, self-loop, geometry sai, diameter ≤ 0, duplicate asset code) → contract test `network.pipe.registered`.
2. **GIS-2 InstallDevice** — pattern y hệt; bảng quy tắc host theo deviceType là unit test matrix (5 loại × có/thiếu host).
3. **GIS-3 Remove + Relocate + GeometryVersion** ✓ — soft-delete 3 aggregates (migration M4 `geometry_versions`); reference-guard rules in handler; node geometry version append-in-transaction; events `network.node.deleted`, `network.pipe.deleted`, `network.device.deleted`, `network.node.relocated` (decision 0010 — "deleted" not "removed"); endpoint `GET /api/network/nodes/{id}/geometry-history`.
4. **GIS-4 Bbox query** ✓ — SHIPPED — read DAO + PostGIS `&&` + GiST index; limit+1 truncation; tenant-scoped; bbox area cap + inverted-bbox validation; integration tests `GetAssetsInBboxApiTests` (happy path, truncation, 401/403/400 area, inverted bbox, tenant isolation).
5. **GIS-5 Projection** ✓ SHIPPED — consumer `asset.registered` (seed Active) + `asset.status.changed` qua Inbox (idempotent theo `eventId`), upsert `network_asset_states {asset_id, tenant_id, lifecycle_status, updated_at, last_event_id}` có OccurredAt guard; tenant derive từ bảng GIS cục bộ (envelope tenant null cho outbox event); bbox query LEFT JOIN projection trả `lifecycleStatus`. Promote `IdempotentEnvelopeConsumer` base class. Decision 0013.

### 4.6 Rủi ro riêng

- **Độ chính xác length**: `ST_Length` trên geography (mét) chứ không geometry (độ) — test với pipe thật ~100m, sai số <1%.
- **Race duplicate asset code**: unique constraint là chốt chặn cuối; handler bắt `UniqueViolation` → `ConflictException` (409) — đã có pattern từ node.
- **Bbox + projection join**: giữ projection trong cùng DB gis nên join cục bộ hợp lệ (projection là dữ liệu của GIS, không phải của asset).

---

## 5. `water-network-asset-be` — hồ sơ & vòng đời tài sản (Phase 1)

### 5.1 Bản chất

Asset service trả lời câu hỏi *"tài sản này đang ở trạng thái nghiệp vụ nào, thuộc ai, có hồ sơ kỹ thuật gì"* — hoàn toàn phi không gian. Bản chất domain là **một state machine có audit**:

```text
Registered ──► Active ──► UnderMaintenance ──► Active
                 │              │
                 ▼              ▼
             Suspended ──► Decommissioned (terminal)
```

Hai quyết định nền tảng:

- **Asset sinh ra từ GIS event, không từ command trực tiếp** (Phase 1). `network.node.registered` → tạo profile type `Node`, status mặc định `Active` (chốt theo US-P1-05). Command `CreateAssetProfile` thủ công để dành cho asset phi bản đồ (Phase sau, nếu nghiệp vụ cần).
- **`assetId` dùng chung id với GIS asset** (node/pipe/device id từ event làm khóa chính bên asset). Lý do tận gốc: tránh bảng mapping id hai chiều — mọi service downstream chỉ cần một id để nói về một tài sản. Idempotency tự nhiên: event deliver lại → insert trùng PK → bỏ qua.

### 5.2 Domain model

| Thành phần | Loại | Bất biến |
|---|---|---|
| `NetworkAsset` | Aggregate root | transitions hợp lệ theo state machine trên; mọi transition ghi `AssetLifecycleEntry` (append-only, trong aggregate); `Decommissioned` là terminal — mọi command sau đó → 422 `AssetAlreadyDecommissioned` |
| `AssetLifecycleEntry` | Entity con | `{fromStatus, toStatus, actorId, reason, occurredAt}` |
| `AssetTechnicalProfile` | Entity con (1-1) | key-value có schema lỏng (jsonb) + vài cột cứng: `installationYear`, `manufacturer`, `model` |
| `AssetOwnership` | Entity con | org unit hiện tại + lịch sử transfer |
| `AssetType`, `AssetStatus` | VO/enum | `Node/Pipe/Device`; status như state machine |

### 5.3 Commands / Events

| Command | Rule chính | Event publish |
|---|---|---|
| (consumer) `network.node.registered/pipe.registered/device.installed` | tạo profile, idempotent theo PK | `asset.registered` v1 |
| `ActivateAsset` | từ `Suspended/UnderMaintenance` | `asset.activated` + `asset.status.changed` |
| `MarkAssetAsMaintenance` | từ `Active` | `asset.maintenance-marked` + `asset.status.changed` |
| `SuspendAsset` | từ `Active` | `asset.status.changed` |
| `DecommissionAsset` | không phải terminal rồi; lưu `DecommissioningRecord {reason, actorId}` | `asset.decommissioned` |
| `UpdateAssetTechnicalProfile` | validate field types | `asset.technical-profile.updated` |
| `TransferAssetOwnership` | org unit hợp lệ (qua master-data port — mock adapter) | `asset.ownership.transferred` |

`asset.status.changed` v1 payload: `{assetId, assetType, previousStatus, newStatus, reason, changedBy}` — đây là contract GIS-5 và sau này maintenance/observation cùng đọc, **chốt và contract-test đầu tiên**.

### 5.4 Thứ tự triển khai

1. **AST-1 Scaffold + consume ✓** — scaffold theo recipe (slnx, 5 project, `AssetDbContext : PlatformDbContext`, DB `wn_asset`, Dockerfile, compose). Slice mỏng: Inbox consumer 3 event GIS → `NetworkAsset` aggregate tối giản → migration `network_assets` + `asset_lifecycle_entries` → publish `asset.registered` → integration test end-to-end **2 container thật** (PostgisFixture + RabbitMqFixture): gọi `POST /gis/nodes` giả lập bằng publish event → assert profile xuất hiện trong `wn_asset`; test deliver-twice → 1 profile.
2. **AST-2 Lifecycle commands ✓** — state machine TDD trong Domain (test matrix toàn bộ transitions hợp lệ/không hợp lệ); 5 command + endpoint `POST /api/assets/{id}/activate|maintenance|suspend|decommission`, `PUT /api/assets/{id}/technical-profile`; query `GET /api/assets/{id}` (kèm lifecycle history) + `GET /api/assets?type=&status=&page=`. Emits `asset.status.changed` (mọi transition), `asset.decommissioned` (terminal), `asset.technical-profile.updated`. Decision 0012.
3. **AST-3 Ownership + master-data port** — `IOrganizationUnitDirectory` port trong Application, mock adapter trả seed data (theo `template-mapping.md §6`); transfer command + history.

### 5.5 Rủi ro riêng

- **Thứ tự event không đảm bảo** (status.changed có thể đến GIS trước khi GIS xử lý xong registered… trong tương lai có nhiều producer): projection GIS upsert theo `assetId` (tạo row mờ nếu chưa có) thay vì update-only — không bao giờ phụ thuộc thứ tự.
- **Backfill**: nếu asset-be deploy sau khi GIS đã có dữ liệu → cần lệnh backfill một lần (`scripts/` — đọc qua API GIS phân trang, không đọc DB GIS). Ghi rõ trong plan AST-1.

---

## 6. `water-network-bff` — read composition (Phase 1, mở rộng dần)

### 6.1 Bản chất

BFF là **anti-corruption layer cho frontend**: gom N call thành 1, che internal contract, không business rule, **không database**. Nguyên tắc thiết kế tận gốc: BFF chỉ được *suy giảm* (nếu asset-be chết, overview vẫn trả phần GIS + `lifecycle: null`) chứ không được *chặn* — fan-out với per-call timeout ngắn (500ms–1s) + circuit breaker, lỗi từng nguồn ghi vào `sources: {gis: "ok", asset: "unavailable"}`.

### 6.2 Cấu trúc & endpoints

Project tối giản: `WaterNetwork.Bff.Api` (+ UnitTests, IntegrationTests với WireMock cho downstream). Typed `HttpClient` per downstream qua `IGisApiClient`, `IAssetApiClient` (đặt trong Api project luôn — không cần 5 layer vì không có domain). JWT passthrough (forward bearer token, không tự mint).

| Endpoint | Compose từ |
|---|---|
| `GET /bff/water-network/assets/{assetId}/overview` | GIS detail (404 ở GIS → 404 BFF) + asset profile (lỗi/chưa có → null) |
| `GET /bff/water-network/map?bbox=&types=` | GIS bbox (đã kèm status từ projection — 1 call) |
| `GET /bff/water-network/assets/search?q=` | GIS search + enrich status |
| (Phase 3+) `GET /bff/water-network/incidents/open`, `GET /bff/water-network/dashboard/summary` | incident-be, maintenance-be, observation-be |

### 6.3 Thứ tự

1. **BFF-1** — scaffold + overview + map passthrough + integration test với WireMock (3 case: cả 2 nguồn ok / asset down / asset 404). Compose block + gateway route.
2. **BFF-n** — mỗi phase sau thêm endpoint tương ứng (đính vào slice cuối của phase đó, không gom dồn).

---

## 7. `water-network-design-be` — workflow thiết kế (Phase 2)

### 7.1 Bản chất

Design service giải bài toán **"dữ liệu chưa đáng tin chưa được vào bản đồ"**. Bản chất là một staging area có quy trình phê duyệt — tách khỏi GIS vì: (a) draft có vòng đời và quyền khác hẳn dữ liệu chính thức; (b) GIS không được parse PDF/DWG (Phase AC #4); (c) khối lượng draft import lớn không được ảnh hưởng hiệu năng map query.

State machine trung tâm (của `DesignRevision`, không phải của project):

```text
Draft ──validate──► Validated ──submit──► Submitted ──approve──► Approved ──publish──► Published
  ▲                                          │ reject                                   (terminal)
  └──────────── sửa draft assets ◄───────────┘
```

Quyết định cốt lõi — **publish qua event, không qua HTTP command** (chốt phương án trong 2 lựa chọn US-P2-06 để ngỏ): design-be phát `design.asset.ready-for-gis` v1 chứa toàn bộ draft payload theo batch; gis-be consume, tạo asset qua chính domain logic RegisterNode/Pipe/Device (tái dùng bất biến), rồi phát `network.gis-import.completed {revisionId, imported[], failed[]}`; design-be consume để chuyển `Published`/`PartiallyPublished`. Lý do: không tạo phụ thuộc HTTP đồng bộ design→GIS, retry tự nhiên qua outbox, idempotent theo `(revisionId, draftAssetId)`.

### 7.2 Domain model & data

| Thành phần | Ghi chú |
|---|---|
| `DesignProject` (AR) | name, branch/zone ref, status `Open/Cancelled`; chứa danh sách document refs |
| `DesignDocument` (entity) | metadata + `fileRef` từ `IFileStoragePort` (mock adapter Phase 2: lưu local disk/minio-compose tùy chốt; interface ổn định) — upload 2 bước: lưu file trước, commit metadata sau; storage lỗi → metadata không commit (US-P2-02) |
| `DesignRevision` (AR riêng) | state machine trên; giữ `ValidationResult` (jsonb: errors[], warnings[] machine-readable theo US-P2-04) |
| `DraftNetworkAsset` (entity thuộc revision) | `draftKind ∈ {Node, Pipe, Device}` + geometry + attrs jsonb + `clientRef` (để pipe draft tham chiếu node draft chưa có id thật) |
| Validation engine | chạy trong Application (không cần topology-rs Phase 2 — out of scope §9.5): duplicate asset code (trong batch + check GIS qua `IGisLookupPort` đọc API GIS), pipe endpoint thiếu, geometry invalid (NTS `IsValid`), thiếu attrs bắt buộc → error; attrs optional thiếu → warning |

DB `wn_design`: `design_projects`, `design_documents`, `design_revisions`, `draft_network_assets` (geometry cột PostGIS để validate, không cần GiST nặng).

### 7.3 Thứ tự triển khai

1. **DSN-1** — scaffold + `CreateDesignProject` + `UploadDesignDocument` (port file storage + mock adapter + config flag `FileStorage:Provider`); events `design.project.created`, `design.document.uploaded`.
2. **DSN-2** ✓ SHIPPED — `CreateDraftAsset`, `UpdateDraftGeometry`, `ValidateRevision` (engine trên, kết quả lưu + trả machine-readable); preview query theo project/revision.
3. **DSN-3** ✓ SHIPPED — `SubmitDesignRevision`, `ApproveDesignRevision` (permission `network-design:approve` — điểm kích hoạt US-X-01 đầu tiên, xem §15.2), `RejectDesignRevision`; audit fields actor/timestamp/correlation trên mọi transition.
4. **DSN-4** ✓ SHIPPED — publish flow 2 chiều như §7.1: contract 2 event mới + consumer GIS (map draft→Register commands, idempotent) + consumer design (cập nhật trạng thái + report imported/failed) + integration test full vòng (design DB → RabbitMQ → gis DB → RabbitMQ → design DB) bằng 2 fixture.

### 7.4 Rủi ro riêng

- **Batch lớn trong 1 event**: revision hàng nghìn draft → chunk event theo 200 assets/message, `network.gis-import.completed` tổng hợp khi đủ chunk (đếm trong design-be). Ghi ngưỡng vào config.
- **Đụng độ asset code lúc publish** (code trống lúc validate, bị chiếm trước khi publish): gis-be xử lý như register thường → vào `failed[]` với code `DuplicateAssetCode`; design hiển thị để sửa — không cần lock phân tán.

---

## 8. `water-network-topology-rs` — engine đồ thị (Phase 3)

### 8.1 Bản chất

Câu hỏi topology ("đóng van nào để cô lập đoạn ống này?") là **bài toán cut-set trên đồ thị**, không phải bài toán SQL. Tách sang Rust vì: traversal trên đồ thị 10⁵–10⁶ edges cần cấu trúc in-memory (petgraph) + latency ms; service **stateless về nghiệp vụ** — không lưu kết quả (isolation plan thuộc incident-be), chỉ giữ **bản sao graph dựng từ events**.

Mô hình nhất quán — quyết định cần chốt rõ: graph là **eventually consistent read model**. Mọi response gRPC kèm `graphVersion` (số event cuối cùng đã apply + timestamp) để caller biết độ tươi. Warm-up khi restart: **snapshot + replay** — định kỳ serialize graph xuống disk (hoặc Redis), khởi động nạp snapshot rồi consume tiếp từ queue; nếu không có snapshot → full rebuild qua API GIS phân trang (bulk endpoint `GET /api/v1/gis/assets/export?cursor=` thêm ở GIS — việc nhỏ, nằm trong TOP-1).

### 8.2 Thiết kế

- **Stack**: Rust + tonic (gRPC) + petgraph + lapin (RabbitMQ consumer) + serde. Mỗi tenant một graph instance (map `tenantId → StableGraph`) — multi-tenancy ở topology nghĩa là **không bao giờ trộn đồ thị 2 tenant**.
- **Node** = network node; **Edge** = pipe; **valve** là attribute trên edge (device gắn pipe) — vì van chặn dòng chảy *qua ống*, không phải tại nút. Đây là quyết định mô hình quan trọng nhất: isolation = tìm tập van nhỏ nhất sao cho bỏ các edge có van đóng thì component chứa đoạn sự cố tách khỏi nguồn.
- **gRPC** (proto trong repo, version hóa package `waternetwork.topology.v1`): `ComputeIsolationZone(assetRef) → {valvesToClose[], isolatedNodes[], isolatedPipes[], graphVersion}`, `ValidateTopology() → {issues[]: {type: OrphanNode|MissingEndpoint|DisconnectedComponent, assetIds[]}}`, `TraceNetwork(start, direction, maxDepth)`, `FindNearestValves(assetRef, k)`, `BuildNetworkSnapshot`.
- **Consume**: `network.node.registered/deleted/relocated`, `network.pipe.registered/rerouted/deleted`, `network.device.installed/deleted` (valve), `valve.state.changed` (Phase 5) — idempotent theo `eventId` (set đã-xử-lý có TTL trong snapshot).

### 8.3 Thứ tự triển khai

1. **TOP-1** ✓ SHIPPED — cargo workspace `src/services/water-network-topology-rs/` (`topology-core` lib + `topology-service` bin; lệch convention .NET — ghi template-mapping §9); consumer lapin → per-tenant petgraph (node=vertex, pipe=edge, valve=edge attr — decision 0017); idempotent theo `EventId`, tenant từ payload; proptest `apply(e);apply(e)==apply(e)`; warm-up snapshot+replay (decision 0018); `/health`; GIS keyset export `GET /api/network/assets/export`. E2E verified Rust consumer qua RabbitMQ thật. gRPC/Validate/Isolation defer TOP-2/3. Exchange name = MassTransit URN default; full-stack compose e2e + full-rebuild wiring là follow-up (xem backlog "Follow-up sau TOP-1").
2. **TOP-2** ✓ SHIPPED — `ValidateTopology` (orphan/missing-endpoint/disconnected) + `TraceNetwork` (depth-limited undirected BFS) + `FindNearestValves` qua tonic (package `waternetwork.topology.v1`, proto compiled bằng vendored protoc); tenant = field request; mọi response kèm `graph_version`; gRPC health (`grpc.health.v1.Health`). Decision 0019. Contract test phía Rust (in-process server↔client) + e2e grpcurl thật; **.NET client contract test defer sang INC-2** (incident-be chưa tồn tại — proto là contract chung). ComputeIsolationZone = TOP-3.
3. **TOP-3** ✓ SHIPPED — `ComputeIsolationZone` qua gRPC: valve-segment isolation (BFS từ node sự cố qua pipe KHÔNG van → segment; đóng mọi van trên pipe có van ở biên); trả `valves_to_close` / `isolated_nodes` / `isolated_pipes` / `graph_version`; node-based start. Minimal theo bố trí van (không phải global min-cut). Perf test 100k-edge ~120ms < 200ms. Decision 0020. E2E grpcurl + integration test (valved boundary). ComputeIsolationZone là input cho INC-2 (isolation analysis). assetRef pipe/device resolution + min-cut + valve open/closed state defer (xem backlog "Follow-up sau TOP-3").

### 8.4 Rủi ro riêng

- **Đội ngũ ít kinh nghiệm Rust** → giữ scope service hẹp tuyệt đối (không DB, không auth phức tạp — gRPC nội bộ sau gateway, xác thực bằng system identity/mTLS theo §15.2); review chuẩn bằng test contract dày.
- **Drift giữa graph và GIS** → job đối soát định kỳ (đếm node/pipe per tenant qua GIS API vs graph, lệch → log + force rebuild); metric `topology_graph_staleness_seconds`.

---

## 9. `water-network-incident-be` — quản lý sự cố (Phase 3)

### 9.1 Bản chất

Incident là **workflow có trạng thái + bằng chứng** (timeline, isolation plan). Nó *điều phối* — gọi topology, yêu cầu maintenance — nhưng không *sở hữu* hạ tầng hay graph. Isolation plan lưu ở incident (không phải topology) vì plan là **quyết định nghiệp vụ tại một thời điểm** (snapshot bất biến), còn graph thay đổi liên tục.

State machine:

```text
Reported ──► Classified ──► IsolationRequested ──► IsolationPlanReady ──► PlanConfirmed
   │              │                  │ (analysis failed → retryable)          │
   │              ▼                  ▼                                        ▼
   └──────► Cancelled          HandlingStarted ◄──────────────────────────────┘
                                     │
                                     ▼
                                  Resolved (terminal)
```

### 9.2 Domain & data

| Thành phần | Ghi chú |
|---|---|
| `NetworkIncident` (AR) | category (`PipeBurst/PressureDrop/WaterLoss/Leak/Other`), severity (1–4), location (Point 4326 optional) + `affectedAssetRefs[]` (id + kind — chỉ ref, validate tồn tại qua `IGisLookupPort`, lỗi → warning theo rule chốt: cho tạo nhưng đánh dấu `unverifiedAssetRef`), timeline entries append-only |
| `IsolationPlan` (entity thuộc incident) | snapshot từ topology: `{valvesToClose[], isolatedAssets[], graphVersion, computedAt, status: Proposed/Confirmed/Superseded}`; re-analysis → plan mới, plan cũ `Superseded` — không sửa đè |
| `ITopologyAnalysisPort` | Application port; adapter gRPC trong Infrastructure; timeout 5s + 3 retry exponential; quá → plan status `AnalysisFailed` (retryable bởi user) — đúng US-P3-04 |

DB `wn_incident`: `network_incidents`, `incident_timeline_entries`, `isolation_plans`, `incident_affected_assets`.

### 9.3 Thứ tự triển khai

1. **INC-1** — scaffold + `ReportIncident`/`ClassifyIncident`/`CancelIncident` + timeline + query list/detail + events `incident.reported/classified/cancelled`. Endpoint `POST /api/v1/incidents`, `GET /api/v1/incidents?status=&severity=`.
2. **INC-2** ✓ SHIPPED — `RequestIsolationAnalysis`: `GrpcTopologyAnalysisAdapter` gọi `ComputeIsolationZone` qua gRPC port 50051 của topology-rs (`Topology:Provider` Grpc/Stub swap, retry policy + per-call deadline), snapshot `IsolationPlan` immutable (+ supersede) persist ở `isolation_plans`, event `incident.isolation-plan-created` v1. Phân tích đồng bộ: topology down → plan `AnalysisFailed` retry được (status giữ `IsolationRequested`, không event). Decision 0023. Real-container gRPC contract test (Testcontainers dựng image Rust thật) **đóng defer .NET client contract test của decision 0019**.
3. **INC-3** ✓ SHIPPED — `ConfirmIsolationPlan` (permission `network-incident:confirm`), `StartIncidentHandling`, `ResolveIncident`; 3 trạng thái mới `IsolationConfirmed`/`InProgress`/`Resolved` + `IsolationPlanStatus.Confirmed`; events `incident.isolation-plan-confirmed` v1, `maintenance.work-order-requested` v1 (FROZEN Phase 3→4 contract — `{IncidentId, assetRefs[]{AssetId,Kind}, Summary, Severity}`), `incident.resolved` v1. Decision 0024. Contract test assert exact 4-field shape. Đóng Phase 3 — Phase 4 (MNT-1) unblocked. Deferrals: non-isolation path, consumers, Keycloak thật, re-open (xem backlog "Follow-up sau INC-3").

---

## 10. ~~`water-network-maintenance-be`~~ → khối `water-fsm` (Phase 4) — SUPERSEDED

> ⚠️ **PIVOT (2026-06-18, decision 0025):** WorkOrder được nâng thành năng lực **FSM
> xuyên miền** (sản xuất + kinh doanh + mạng lưới), tách thành khối top-level riêng
> `water-fsm/` (.NET). `water-network-maintenance-be` **không được tạo** trong repo này;
> water-network chỉ là **producer** (`maintenance.work-order-requested` v1, đã xong ở
> INC-3). Slice cũ → FSM khối: MNT-1→FSM-1, MNT-2→FSM-2, MNT-3→FSM-3. Spec FSM:
> `water-fsm/docs/superpowers/specs/2026-06-18-fsm1-work-order-intake-lifecycle-design.md`.
> Nội dung §10.x dưới đây giữ lại làm tham chiếu domain (state machine, material, v.v.)
> cho FSM khối, KHÔNG còn là kế hoạch của water-network-be.

### 10.1 Bản chất

Work order là **đơn vị giao việc có trách nhiệm**: ai làm, làm gì, trên tài sản nào, kết quả ra sao, tốn vật tư gì. Nó tham chiếu incident/asset bằng **id trong event** — không bao giờ đọc DB của họ (US-P4-01 nói rõ).

State machine: `Created → Assigned → Scheduled → InProgress ⇄ Paused → Completed | Cancelled`. Start yêu cầu đã Assigned (US-P4-03).

### 10.2 Domain & data

| Thành phần | Ghi chú |
|---|---|
| `WorkOrder` (AR) | nguồn: từ event `maintenance.work-order-requested` (idempotent theo `(tenantId, incidentId, requestEventId)` unique) hoặc command `CreateWorkOrder` thủ công (bảo trì định kỳ); giữ `incidentRef`, `assetRefs[]` |
| `Assignment` (entity) | technician/team validate qua `ITechnicianDirectoryPort` (mock adapter — danh mục seed; thay bằng HR/master-data sau) |
| `RepairRecord`, `MaterialUsage` (entities) | material `{itemCode, quantity > 0, unit}`; chỉ ghi khi `InProgress` |
| `INotificationPort` | publish event là chính (`work-order.assigned` để notification-be consume); port để chỗ cho push trực tiếp sau |

### 10.3 Thứ tự triển khai

1. **MNT-1** — scaffold + consumer `maintenance.work-order-requested` + `CreateWorkOrder`/`StartWorkOrder`/`CompleteWorkOrder` + state machine TDD + events `work-order.created/started/completed`. Đồng thời bên asset-be thêm consumer `work-order.completed` → (rule chốt: asset đang `UnderMaintenance` có work order completed → gợi ý Activate, không tự động — ghi quyết định vào plan phase).
2. **MNT-2** — `AssignTechnician`, `ScheduleWorkOrder`, `PauseWorkOrder`, `CancelWorkOrder` + directory port + event `work-order.assigned`.
3. **MNT-3** — `RecordRepairResult`, `RecordMaterialUsage` + events `repair.recorded`, `material.used`; query work order detail đầy đủ (records + materials + timeline).

---

## 11. `water-network-zone-be` — phân vùng cấp nước (Phase 5, tối giản)

### 11.1 Bản chất & thời điểm

Zone là **không gian nghiệp vụ phủ lên không gian vật lý**: DMA/pressure zone xác định *ngưỡng vận hành* và *phạm vi ảnh hưởng*. SPEC để ngỏ thời điểm; phân tích phụ thuộc cho thấy zone cần trước **OBS-3** (threshold theo zone) và **CIM-1** (affected zones) → đặt đầu Phase 5, scope tối giản.

### 11.2 Scope tối giản ZON-1

- Aggregates: `SupplyZone`/`DmaZone` (hierarchy parent-child 2 mức), `ZoneBoundary` (Polygon/MultiPolygon 4326), `ZoneAssetAssignment`.
- Commands: `CreateSupplyZone`, `UpdateZoneBoundary` (version hóa boundary như GeometryVersion), `AssignAssetToZone`/`RemoveAssetFromZone` (thủ công Phase 5; auto-assign theo `ST_Contains` là job đề xuất Phase 7), `ActivateZone`/`DeactivateZone`.
- Queries: zone list/detail, `GetZonesContainingPoint(lng,lat)` (PostGIS), assets-in-zone.
- Events: `zone.created`, `zone.boundary.updated`, `zone.asset.assigned/removed`, `zone.deactivated`.
- DB `wn_zone` PostGIS, GiST trên boundary. Scaffold đúng recipe — service nhỏ nhất, 1 slice duy nhất.

---

## 12. `water-network-observation-be` — telemetry (Phase 5)

### 12.1 Bản chất

Telemetry khác mọi service trước ở **hình dạng tải**: ghi liên tục tần suất cao, append-only, đọc theo cửa sổ thời gian + latest-per-device. Quyết định mở (SPEC §20.8) cần chốt khi vào phase — **đề xuất TimescaleDB** (extension trên Postgres, cùng vận hành, hypertable + continuous aggregate đủ cho Phase 5; InfluxDB chỉ cần khi vượt ~100k points/s).

Hai đường dữ liệu tách bạch ngay từ thiết kế:

- **Hot path (ingest)**: HTTP batch endpoint → validate → ghi hypertable + upsert `latest_readings` — **không qua outbox per-reading** (bão event). `*.reading.received` chỉ phát cho alert pipeline nội bộ; quy ước: reading events là **high-volume stream**, downstream nào cần thì subscribe có chọn lọc.
- **Control path**: device mapping, threshold, alert lifecycle — aggregate + outbox chuẩn như mọi service.

### 12.2 Domain & data

| Thành phần | Ghi chú |
|---|---|
| `TelemetryDevice` (AR) | mapping `deviceId ↔ networkAssetId` (validate asset qua projection cục bộ build từ `asset.*` events — không gọi sync); asset decommissioned → reject mapping (policy chốt: reject, không warning) |
| `pressure_readings`, `flow_readings` (hypertables) | `{device_id, ts, value, unit, reading_id, tenant_id}`; dedupe qua bảng thường `reading_ingest_keys (tenant_id, device_id, reading_id)` vì unique index của Timescale hypertable phải chứa partition key; timestamp ngoài cửa sổ ±24h/±5min future → warning/error theo policy config |
| `valve_states`, `pump_states` | latest state + history; đổi state → `valve.state.changed` (topology-rs consume) |
| `ThresholdProfile` (AR) | scope zone hoặc device; `{metric, min, max, debounceSeconds}` |
| `ObservationAlert` (AR) | `Open → Acknowledged → Resolved/AutoResolved`; debounce: alert đang Open cùng device+metric → không phát event mới (US-P5-04 chống spam) |

### 12.3 Thứ tự triển khai

1. **OBS-1** — scaffold với TimescaleDB container/database riêng (không đổi PostGIS hiện hữu), migration strategy ghi rõ AC #7 + `RegisterTelemetryDevice`/`MapTelemetryDeviceToNetworkAsset` + ingest batch endpoint `POST /api/v1/observations/readings:batch` idempotent + asset projection consumer. Plan chi tiết: `2026-08-06-phase5-obs1-device-mapping-ingest.md`.
2. **OBS-2** — `GET /api/v1/observations/assets/{assetId}/latest`, batch `POST .../latest:query` (chống N+1 cho BFF — US-P5-03), history `GET .../readings?from=&to=&bucket=` (continuous aggregate 1m/1h).
3. **OBS-3** — `ConfigureThreshold`, detection trong ingest pipeline (so threshold sau khi ghi), `ObservationAlert` + `AcknowledgeObservationAlert`; events `pressure.abnormal-detected`, `flow.abnormal-detected`, `sensor.offline-detected` (background job quét device im lặng > heartbeat config); incident-be thêm consumer đề xuất incident từ alert (tạo incident `Reported` tự động theo policy — chốt khi vào phase).
4. **BFF**: thêm latest summary vào asset overview + dashboard.

### 12.4 Rủi ro riêng

- **Throughput**: batch insert qua Npgsql binary COPY khi batch > ngưỡng; benchmark test 10k readings/request.
- **Lệch giờ thiết bị**: chính sách timestamp là config per-tenant, mặc định reject > 5 phút tương lai, warning > 24h quá khứ.

---

## 13. `water-network-hydraulic-be` — mô hình thủy lực (Phase 6)

### 13.1 Bản chất

Hydraulic service Phase 6 là **quản lý vòng đời mô hình + cầu nối EPANET**, không phải solver (quyết định mở §20.7 — chốt theo đề xuất design: chỉ EPANET export). Bản chất dữ liệu: model là **bản sao đóng băng** (frozen snapshot) của một phần mạng tại một thời điểm — không live-sync với GIS, vì mô phỏng cần baseline ổn định.

### 13.2 Domain & data

| Thành phần | Ghi chú |
|---|---|
| `HydraulicModel` (AR) | scope (zone ref hoặc bbox), snapshot nodes/pipes/devices lấy qua `BuildNetworkSnapshot` của topology-rs + GIS bulk export; thiếu dữ liệu (pipe thiếu diameter/material, node thiếu elevation) → status `Incomplete` + `validationIssues[]` machine-readable (US-P6-01) |
| `HydraulicScenario` (AR) | demand pattern (multiplier 24h hợp lệ: 24–96 điểm, > 0), boundary conditions (reservoir head, pump curve); thiếu boundary → `Incomplete` |
| `EpanetExportJob` / `SimulationRun` | job pattern: `Pending → Running → Completed/Failed {error}`; INP file sinh từ model+scenario (writer thuần C#, format text EPANET 2.2) lưu qua `IFileStoragePort` (tái dùng port của design-be — chuyển interface này vào BuildingBlocks.Application khi bắt đầu HYD-2) |
| `SimulationResult` | import từ file kết quả/payload; value theo `{assetRef, metric, timestep}`; asset không thuộc model → validation issue |

### 13.3 Thứ tự triển khai

1. **HYD-1** — scaffold + `CreateHydraulicModel` (snapshot qua topology gRPC + GIS export, port + adapter) + validation issues + query model detail; event `hydraulic.model.created`.
2. **HYD-2** — `CreateHydraulicScenario`, `ConfigureDemandPattern`, `ConfigureBoundaryCondition`; `ExportEpanetInp` (+job, +file storage, +event `hydraulic.epanet.exported`); **golden file test**: INP sinh ra so khớp file mẫu đã được kỹ sư thủy lực duyệt.
3. **HYD-3** — `ImportSimulationResult` + query result by asset + `CompareSimulationRuns` (diff 2 run cùng model); events `hydraulic.simulation.completed/failed`; BFF overlay kết quả lên map.

---

## 14. `water-network-customer-impact-be` + reporting (Phase 7)

### 14.1 Bản chất

Customer impact trả lời **"sự cố này làm ai mất nước?"** = giao của (vùng cô lập vật lý) với (điểm đấu nối khách hàng). Khó khăn gốc: dữ liệu khách hàng thuộc CRM/kinh doanh — ngoài platform. Giải pháp đúng kiến trúc (quyết định #12): **`ServiceConnectionProjection`** — bảng chiếu `{connectionId, customerRef, assetRef/zoneRef, isCritical}` build từ `ICustomerDirectoryPort` (mock adapter seed Phase 7; thay bằng feed CRM thật sau, không đổi Application). Thiếu projection → analysis `Partial` + warnings (US-P7-01) — degrade minh bạch, không chặn.

### 14.2 Domain & thứ tự

| Thành phần | Ghi chú |
|---|---|
| `ImpactAnalysis` (AR) | nguồn: consume `incident.isolation-plan-confirmed` (auto) hoặc `ComputeMaintenanceImpact` command; match affected assets/zones → connections; đánh dấu critical (bệnh viện, trường…); status `Computed → Confirmed` (snapshot bất biến sau confirm — notification/reporting chỉ dùng snapshot đã confirm, US-P7-02) |
| Events | `customer-impact.computed`, `customer-impact.confirmed`, `customer-impact.notification-required {targetGroups[]}` |

1. **CIM-1** — scaffold + consumer isolation-plan-confirmed + projection port/mock + compute + query analysis detail.
2. **CIM-2** — `ConfirmImpactSnapshot` (permission + audit) + notification event; notification-be vẫn là mock consumer (log sink) — contract rõ là đủ Phase 7 AC #3.
3. **RPT-1** — reporting **tối giản đặt làm module trong BFF hoặc service `reporting-be` riêng tùy khối lượng** (đề xuất: service riêng chỉ khi ≥ 2 report cần job nền; ngược lại module BFF + job table): report job `{type: AssetSummary|IncidentSummary|MaintenanceSummary, dateRange, status}`, nguồn dữ liệu qua API các service (không đọc DB chéo), xuất Excel/PDF lưu file-storage, download link + 403 theo permission `network-reporting:read`.

---

## 15. Cross-cutting workstreams (gắn vào slice, không phải phase riêng)

### 15.1 Event contract & versioning (US-X-03) — kích hoạt: ngay GIS-1

- Mỗi event = 1 record trong `Contracts/Events` + 1 dòng trong **event catalog registry** (`docs/conventions/event-catalog.md` — tạo ở GIS-1): eventType, version, producer, consumers, payload schema, ngày hiệu lực.
- Quy tắc thay đổi: thêm field optional = cùng version; đổi/bỏ field = version mới (`NetworkNodeRegisteredV2`), producer phát cả 2 trong窗 transition, consumer khai báo version hỗ trợ; unknown version → log warning + đưa vào parking lot table, không crash (test bắt buộc trong `IdempotentIntegrationEventConsumer`).
- Contract test 2 phía cho mọi event mới — pattern đã có từ `NetworkNodeRegisteredContractTests`.

### 15.2 Security & permission (US-X-01) — kích hoạt: DSN-3 (approve là hành động nhạy quyền đầu tiên)

- Chuẩn hóa policy `<context>:<action>` trong `BuildingBlocks.Security`: `network-gis:write/read`, `network-design:approve`, `network-incident:confirm`, `network-maintenance:write`, `network-observation:read`, `network-reporting:read`…; endpoint khai báo qua `.RequireAuthorization("...")` — audit actorId từ claims vào mọi command context (đã có chỗ trong `IRequestContext`).
- Tenant-scope check: permission đúng nhưng sai tenant → 403 (test mỗi service).
- Keycloak thật: một workstream riêng **sau Phase 3** (khi số service đủ lớn để đáng giá SSO thật) — chỉ flip `Jwt:Mode=Authority` + realm export + compose service (recipe có sẵn `template-mapping.md §5`). Service-to-service (incident→topology gRPC): system identity bằng client-credentials token (mock mode: token factory), topology xác thực metadata.
- API Gateway (YARP) — đề xuất dựng ở **đầu Phase 2** khi có service thứ 3: route `/api/v1/gis/* → gis-be`, `/bff/* → bff`, JWT validate tại gateway + forward; 1 ngày công, trả lãi mọi phase sau.

### 15.3 CI/CD — kích hoạt: AST-1 (khi có 2 service)

- GitHub Actions matrix theo solution: path filter (`src/services/water-network-gis-be/**` → chỉ test/build gis), build + test + docker build per service; building blocks đổi → chạy tất cả.
- `docker compose config --quiet` + `dotnet format --verify-no-changes` là gate.

### 15.4 Observability nâng dần

- Đã có baseline. Thêm theo phase: dashboard Grafana per-service (Phase 2), metric nghiệp vụ (outbox lag, inbox dedupe count, projection staleness — Phase 1 GIS-5), alert rule mẫu (Phase 5 cùng observation).

---

## 16. Rủi ro tổng hợp & đối sách

| # | Rủi ro | Xác suất/Va đập | Đối sách |
|---|---|---|---|
| 1 | Eventual consistency làm FE/UAT bối rối ("tạo node rồi mà overview chưa có lifecycle") | Cao/Trung bình | Contract hóa degrade (null + `sources` status trong BFF); demo script luôn nói rõ; SLA projection < 5s dev |
| 2 | Event schema vỡ ngầm giữa services | Trung bình/Cao | §15.1 — registry + contract test 2 phía là gate merge |
| 3 | Rust topology trở thành đảo kiến thức | Trung bình/Cao | Scope hẹp (không DB/auth); proto là contract duy nhất; đối soát + rebuild tự động; tài liệu warm-up kỹ |
| 4 | Telemetry volume vượt thiết kế Postgres | Thấp (Phase 5)/Cao | Hot path tách riêng từ đầu; benchmark gate; Timescale → Influx chỉ đổi adapter ingest/query |
| 5 | Service mọc nhanh hơn kỷ luật scaffold | Trung bình/Trung bình | `template-mapping.md` checklist là điều kiện PR; mỗi scaffold mới phải cập nhật doc |
| 6 | Mock adapters (file storage, customer dir, technician dir) sống quá lâu thành "thật" | Trung bình/Trung bình | Mỗi port có config flag provider + integration test cho adapter thật ngay khi hạ tầng có; danh sách mock theo dõi trong `template-mapping.md §6` |
| 7 | Phase sau phát hiện thiếu field ở event phase trước | Cao/Thấp | Thêm field optional là non-breaking (§15.1); payload event luôn kèm `assetRef {id, kind, assetCode}` đầy đủ thay vì chỉ id trần |

---

## 17. Acceptance gates & Definition of Done

**Gate kết thúc mỗi phase** = Phase Acceptance Criteria trong SPEC (§7.4, §8.4, §9.4, §10.4, §11.4, §12.4, §13.4, §14.4) — không bắt đầu phase sau khi gate chưa xanh, trừ slice không phụ thuộc (theo đồ thị §3.1).

**DoD mỗi slice** (kế thừa SPEC §17, áp cho mọi mục trong §4–§14):

1. Domain rule đúng layer, có unit test (state machine = test matrix đầy đủ transitions).
2. Command/query có validator; API có E2E test; consumer có idempotency test (deliver-twice).
3. Migration committed; event qua outbox; contract test 2 phía cho event mới.
4. Tenant + correlation xuyên suốt (test cách ly tenant cho service mới).
5. `dotnet test <Service>.slnx` xanh, 0 warning; compose parse; README/template-mapping cập nhật nếu đổi public behavior.

**Quy trình mỗi phase khi bắt đầu**: viết plan thực thi chi tiết mức task (như plan Phase 0) từ section tương ứng của tài liệu này → user duyệt → implement từng slice theo TDD recipe → cập nhật tài liệu này nếu quyết định thay đổi.

---

## 18. Các quyết định đề xuất chốt trong tài liệu này (chờ user xác nhận)

Đối chiếu SPEC §20 (open decisions) — kế hoạch trên đã chọn mặc định, cần user gật trước khi vào phase liên quan:

| # | Quyết định | Đề xuất | Phase ảnh hưởng |
|---|---|---|---|
| 1 | Publish design→GIS | Qua event 2 chiều (`ready-for-gis` / `gis-import.completed`), không HTTP | 2 |
| 2 | Asset id | Dùng chung id với GIS asset (không bảng mapping) | 1 |
| 3 | Asset status mặc định khi sinh từ GIS event | `Active` | 1 |
| 4 | Valve trong graph | Attribute trên edge (pipe-hosted) | 3 |
| 5 | Topology warm-up | Snapshot + replay; fallback full rebuild qua GIS bulk export | 3 |
| 6 | Zone service | Service riêng, tối giản, đầu Phase 5 | 5 |
| 7 | Time-series store | TimescaleDB container/database riêng cho observation; không thay PostGIS hiện hữu trong OBS-1 | 5 |
| 8 | Reading events | High-volume stream không qua outbox per-reading; alert/control qua outbox | 5 |
| 9 | Hydraulic engine | Chỉ EPANET export/import, không solver | 6 |
| 10 | Reporting | Module/BFF trước, tách service khi ≥2 report cần job nền | 7 |
| 11 | API Gateway | YARP, dựng đầu Phase 2 | 2+ |
| 12 | Keycloak thật | Sau Phase 3 (flip config theo template-mapping §5) | 3+ |
