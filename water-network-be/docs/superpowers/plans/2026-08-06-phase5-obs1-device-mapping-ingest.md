# Phase 5 OBS-1 — Device Mapping + Telemetry Batch Ingest

**Ngày:** 2026-08-06  
**Trạng thái:** Proposed — kế hoạch cho Checkpoint B; chưa claim service, chưa tạo worktree, chưa implement  
**Service:** `water-network-observation-be`  
**User stories:** US-P5-01, US-P5-02  
**Phụ thuộc cứng:** AST-1/AST-2 contracts đã shipped  
**Phụ thuộc release:** ZON-1 không chặn OBS-1, nhưng phải merge/deploy trước OBS-3

## 1. Kết quả cần đạt

OBS-1 tạo walking skeleton production-shaped cho telemetry:

1. Đăng ký telemetry device trong tenant.
2. Map device vào network asset dựa trên projection cục bộ từ `asset.*` events.
3. Nhận batch pressure/flow readings theo hot path idempotent.
4. Lưu chuỗi thời gian trong TimescaleDB và cập nhật latest-state nội bộ.
5. Phát reading stream sau khi ghi thành công, không tạo một outbox row cho từng reading.
6. Chứng minh tenant isolation, auth, dedupe, migration, container và throughput bằng test.

OBS-1 kết thúc khi một gateway có thể gửi cùng batch hai lần mà dữ liệu chỉ được lưu một lần, và mỗi reading đã nhận luôn truy ngược được về device + network asset đúng tenant.

## 2. Ngoài phạm vi

- Latest/history public query cho BFF — OBS-2.
- Threshold, alert, offline detection và incident proposal — OBS-3.
- Valve/pump state ingestion — mở rộng sau pressure/flow walking skeleton.
- MQTT broker/device provisioning — thuộc `water-datalogger/devices`; OBS-1 chỉ cung cấp HTTP ingest contract.
- Tự động map theo vị trí, zone hoặc asset code.
- FE/BFF telemetry widgets.
- Deploy production trong phiên build service; release vẫn dừng ở PR theo playbook.

## 3. Quyết định thiết kế mặc định

### 3.1 Device và mapping

- `deviceId` là business key do gateway cấp, unique theo `(tenant_id, device_id)`.
- Một device có tối đa một active asset mapping; một asset có thể có nhiều device.
- Gửi lại đúng mapping là idempotent; map device đã gắn sang asset khác trả `409`.
- Remap phải là command tường minh có audit/event ở slice sau; không silent overwrite trong OBS-1.
- Chỉ asset projection ở trạng thái `Registered`, `Active` hoặc `UnderMaintenance` được map. `Decommissioned` bị từ chối.

### 3.2 Metric, unit và thời gian

- OBS-1 nhận `pressure` và `flow`.
- Pressure chấp nhận `kPa`, `bar`, `mH2O`, chuẩn hóa về `kPa`.
- Flow chấp nhận `m3/h`, `L/s`, chuẩn hóa về `m3/h`.
- Lưu cả source value/unit và normalized value/unit để không mất fidelity.
- Reading quá 5 phút trong tương lai bị reject.
- Reading quá 24 giờ trong quá khứ vẫn lưu nhưng trả warning; hai ngưỡng là config per environment/tenant-ready.
- Batch tối đa 10.000 items; item lỗi không làm mất các item hợp lệ trong cùng request.

### 3.3 Idempotency trên TimescaleDB

Không đặt unique `(device_id, reading_id)` trực tiếp trên hypertable vì Timescale yêu cầu unique index chứa partition key. Dùng hai tầng:

- `reading_ingest_keys`: bảng Postgres thường, unique `(tenant_id, device_id, reading_id)`.
- `observation_readings`: hypertable partition theo `observed_at`, append-only.

Insert dedupe key + reading + latest upsert chạy trong cùng transaction. Duplicate key được tính là `duplicate`, không phải lỗi.

### 3.4 Database/container

- Database riêng `wn_observation` với TimescaleDB extension.
- Khuyến nghị thêm service/container TimescaleDB riêng trong OBS-1 thay vì đổi image PostGIS đang phục vụ GIS/Zone. Cách này giữ database-per-service và giảm blast radius regression.
- Production migration tách riêng; không tự động nâng/chuyển PostGIS hiện có trong OBS-1.

### 3.5 Reading events

- Control-path events dùng outbox như chuẩn platform.
- `pressure.reading.received` và `flow.reading.received` đi qua `IReadingStreamPublisher`, phát sau commit, không ghi outbox per reading.
- DB là source of truth; reading stream phục vụ near-real-time consumer và chấp nhận replay/reconciliation từ DB khi cần.
- Payload event giữ `eventId`, `tenantId`, `deviceId`, `assetId`, `readingId`, `observedAt`, normalized `value/unit` và correlation metadata.

## 4. Public contract dự kiến

### 4.1 API

| Method | Route | Mục đích | Kết quả chính |
|---|---|---|---|
| `POST` | `/api/v1/observations/devices` | Register telemetry device | `201`, duplicate `409` |
| `PUT` | `/api/v1/observations/devices/{deviceId}/mapping` | Map vào network asset | `200`, missing asset `404`, invalid state `422`, conflict `409` |
| `GET` | `/api/v1/observations/devices/{deviceId}` | Xác minh device + active mapping | `200`/`404` |
| `POST` | `/api/v1/observations/readings:batch` | Ingest pressure/flow batch | `200` với accepted/duplicate/rejected/warnings |

### 4.2 Batch request/response

```json
{
  "batchId": "gw-01-20260806T031500Z-0042",
  "readings": [
    {
      "readingId": "p-000042",
      "deviceId": "pressure-gw01-07",
      "metric": "pressure",
      "observedAt": "2026-08-06T03:15:00Z",
      "value": 2.4,
      "unit": "bar"
    }
  ]
}
```

```json
{
  "batchId": "gw-01-20260806T031500Z-0042",
  "accepted": 1,
  "duplicates": 0,
  "rejected": 0,
  "warnings": [],
  "errors": []
}
```

Response không echo toàn bộ readings thành công. `errors[]` và `warnings[]` chỉ chứa `readingId`, code machine-readable và message ngắn.

### 4.3 Auth và tenant

- Device register/mapping: `network-observation:write`.
- Batch ingest: `network-observation:ingest` dành cho gateway/service account.
- Device read: `network-observation:read`.
- Tenant lấy từ verified request context; request body không được phép chỉ định/override tenant.
- Event consumer dùng tenant trong verified event envelope và idempotent theo `eventId`.

## 5. Data model

| Table | Vai trò | Constraint/index chính |
|---|---|---|
| `telemetry_devices` | Device registry + active mapping | PK id; unique `(tenant_id, device_id)`; index mapped asset |
| `observation_asset_states` | Projection từ Asset | unique `(tenant_id, asset_id)`; status + asset type/code + last event |
| `reading_ingest_keys` | Cross-chunk dedupe ledger | unique `(tenant_id, device_id, reading_id)`; retention policy chốt sau benchmark |
| `observation_readings` | Timescale hypertable | partition `observed_at`; index `(tenant_id, device_id, observed_at desc)` |
| `latest_readings` | Internal latest-per-device/metric | unique `(tenant_id, device_id, metric)`; chỉ update nếu timestamp mới hơn |

`observation_readings` lưu `source_value`, `source_unit`, `value`, `unit`, `metric`, `asset_id_at_ingest`, `received_at`. `asset_id_at_ingest` là snapshot để history không đổi nghĩa sau một remap tương lai.

## 6. Luồng end-to-end

```text
asset.registered / asset.status.changed / asset.decommissioned
                         │
                         ▼
            observation_asset_states
                         │
Register device ──► Map device→asset
                         │
Gateway batch ──► validate/normalize ──► dedupe ledger
                         │                       │
                         └──────── transaction ─┼─► hypertable
                                                 └─► latest_readings
                                                          │
                                                          ▼ after commit
                                               reading stream publisher
```

## 7. Kế hoạch triển khai

### Track A — Contract và domain

1. Viết contract điều phối `water-network-observation-be.contract.md` và ADR cho hot-path/outbox boundary.
2. Scaffold solution gồm Domain, Application, Infrastructure, Contracts, Api và ba test projects.
3. TDD `TelemetryDevice`: register, map, duplicate/conflict, asset-state guard và tenant invariants.
4. Định nghĩa request/response DTO, error codes và reading event v1 contracts; cập nhật event catalog.

### Track B — Data và ingestion

5. Thêm TimescaleDB fixture/container, `ObservationDbContext`, migration + extension/hypertable setup.
6. Xây asset projection consumers cho `asset.registered`, `asset.status.changed`, `asset.decommissioned`; test deliver-twice và unknown version.
7. Xây register/mapping handlers + repositories/read DAO.
8. Xây batch validator, unit normalizer, timestamp policy, dedupe ledger và transactional batch writer.
9. Upsert `latest_readings` chỉ khi reading mới hơn; implement `IReadingStreamPublisher` và test publish-after-commit.

### Track C — API, vận hành và release

10. Map endpoints, ProblemDetails/error codes, auth policies, tenant/correlation propagation.
11. Thêm Dockerfile, Compose Timescale service/database init, health checks và path-filtered CI.
12. Chạy functional tests, cross-tenant tests, migration round-trip, restart durability và benchmark 10k readings/request.
13. Cập nhật README, master roadmap/backlog; mở PR; không deploy tự động.

## 8. Test matrix tối thiểu

- Register device success, duplicate conflict, same external id across two tenants allowed.
- Map success, idempotent same mapping, conflicting remap, asset missing, asset decommissioned.
- Asset events delivered twice do not duplicate/corrupt projection.
- Pressure/flow unit normalization; unsupported metric/unit rejected.
- Future timestamp rejected; old timestamp accepted with warning.
- Same batch twice and same reading in different batches remain exactly-once in DB.
- Partial batch: valid items commit, invalid items return machine-readable errors.
- Latest upsert does not regress when an older reading arrives late.
- Tenant A cannot register/map/read/ingest against tenant B device/asset.
- Stream event only emits for committed non-duplicate readings.
- Migration creates Timescale extension/hypertable; restart retains data.
- Benchmark 10k items records throughput, p95 and memory; no hard pass number until baseline run, but regression threshold is committed afterward.

## 9. Verification gate

Chạy từ `water-network/water-network-be`:

```bash
dotnet build src/services/water-network-observation-be/WaterNetwork.Observation.slnx --nologo
dotnet test src/services/water-network-observation-be/tests/WaterNetwork.Observation.UnitTests/WaterNetwork.Observation.UnitTests.csproj --nologo
dotnet test src/services/water-network-observation-be/tests/WaterNetwork.Observation.ContractTests/WaterNetwork.Observation.ContractTests.csproj --nologo
dotnet test src/services/water-network-observation-be/tests/WaterNetwork.Observation.IntegrationTests/WaterNetwork.Observation.IntegrationTests.csproj --nologo
dotnet format src/services/water-network-observation-be/WaterNetwork.Observation.slnx --verify-no-changes --no-restore
docker compose config --quiet
docker build -f src/services/water-network-observation-be/Dockerfile .
git diff --check
```

Gate chỉ xanh khi build 0 warning, mỗi test project discover số test > 0, migration chạy trên Timescale container thật, cross-tenant/idempotency tests xanh và benchmark artifact được lưu.

## 10. Thứ tự sau OBS-1

1. **OBS-2:** latest query theo asset, batch latest query cho BFF, history + bucket/continuous aggregates.
2. **OBS-3:** threshold theo device/zone, alert lifecycle, debounce/offline detection và incident proposal contract.
3. **HYD-1..3:** snapshot model, scenario, EPANET export/import và simulation result.
4. **CIM-1..2 + RPT-1:** customer impact snapshot, notification và reporting.

## 11. Checkpoint trước khi bắt đầu build

Trước khi claim service, xác nhận trong phiên build-service:

1. SDK pin trong `global.json` có sẵn trên local runner và CI.
2. Dùng Timescale container riêng, không thay PostGIS hiện hữu.
3. Duplicate mapping policy là idempotent-same / conflict-different.
4. Partial batch commit và max batch 10.000.
5. Canonical units `kPa` và `m3/h`.
6. Reading events đi dedicated stream sau commit, không qua outbox per reading.
