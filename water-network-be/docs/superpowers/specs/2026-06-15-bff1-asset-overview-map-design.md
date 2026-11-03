# BFF-1 Asset overview + map (US-P1-07) — Design

**Status:** draft (chờ user duyệt trước khi viết/exec plan)
**Service:** `water-network-bff` (service mới — slice cuối Phase 1)
**Roadmap:** `docs/superpowers/plans/2026-06-13-master-implementation-roadmap.md` §6 (slice BFF-1)
**Phụ thuộc:** GIS-4 GetAssetsInBbox + GIS-5 projection `lifecycleStatus` + AST-2 lifecycle (đã merge).

## Bản chất

BFF là **anti-corruption layer đọc cho frontend**: gom N call thành 1, che internal contract,
**không business rule, không database, không phát event**. Nguyên tắc lõi (roadmap §6.1): BFF chỉ
được **suy giảm** chứ không được **chặn** — nếu asset-be chết, overview vẫn trả phần GIS với
`lifecycle: null`. Fan-out với per-call timeout ngắn + circuit breaker; trạng thái từng nguồn ghi
vào `sources: {gis: "ok", asset: "unavailable"}`.

## Scope (BFF-1)

Hai endpoint đọc, compose từ GIS + asset-be qua HTTP (không đọc DB chéo):

1. `GET /bff/water-network/assets/{assetId}/overview?type=node|pipe|device` — GIS detail (nguồn
   chuẩn) + asset lifecycle (suy giảm null nếu lỗi).
2. `GET /bff/water-network/map?bbox=&types=&limit=` — passthrough GIS bbox (đã kèm
   `lifecycleStatus` từ GIS-5).

Service mới `water-network-bff`: project **đơn** `WaterNetwork.Bff.Api` (không tầng domain — BFF
không có business rule, không DB) + `WaterNetwork.Bff.UnitTests` + `WaterNetwork.Bff.IntegrationTests`.

## Sự thật nền (đã verify trong codebase — 2026-06-15)

- **asset id == GIS id**: `GisAssetRegistrationConsumer` set asset id = `NodeId`/`PipeId`/`DeviceId`
  từ event GIS. `AssetDetailDto.AssetType` cho biết Node/Pipe/Device.
- **GIS detail chia theo type, route riêng**: `GET /api/network/nodes/{id}` → `NodeDetailDto`,
  `/pipes/{id}` → `PipeDetailDto`, `/devices/{id}` → `DeviceDetailDto` (mỗi cái 404 nếu thiếu).
  **Không có** `GET /api/network/assets/{id}` hợp nhất.
- **GIS bbox**: `GET /api/network/assets?bbox=&types=&limit=` (đã LEFT JOIN projection → kèm
  `lifecycleStatus`), permission `network-gis:read`.
- **Asset detail**: `GET /api/assets/{id}` → `AssetDetailDto` (404 nếu thiếu), permission
  `network-asset:read`.
- **Không có GIS search endpoint** (chưa được slice) → search hoãn khỏi BFF-1.
- **Tenant/auth**: header tenant `X-Tenant-Id` + claim `tenant_id` (`TenantOptions`). Middleware
  stack platform: GlobalException → CorrelationId → Authentication → MultiTenancy → Authorization.

## Quyết định chốt (đã brainstorm với user — 2026-06-15)

| # | Quyết định | Chọn | Ghi chú |
|---|---|---|---|
| 1 | Overview resolve type | `?type=node\|pipe\|device` query param; fan-out song song GIS(by type) + asset(by id) | FE đã biết type từ map pin; tránh phụ thuộc asset-be để biết route GIS (giữ degrade) |
| 2 | Search endpoint | **Hoãn** — không có GIS search upstream | Thêm GIS-6 search slice + BFF-n sau |
| 3 | GIS authoritative | GIS 404 → BFF 404; GIS timeout/5xx → BFF 502 | Không trả được phần lõi thì không suy giảm được |
| 4 | Asset suy giảm | Asset lỗi bất kỳ (timeout/4xx/5xx/403) → `lifecycle: null`, `sources.asset:"unavailable"` | Không bao giờ chặn vì asset |
| 5 | Resilience | `Microsoft.Extensions.Http.Resilience` standard handler: per-attempt timeout ~1s, **không retry**, circuit breaker | Polly v8 chuẩn .NET; read fail-fast |
| 6 | HTTP client | Typed `HttpClient` (`IGisApiClient`/`IAssetApiClient`) + `System.Net.Http.Json` thuần, không Refit | Giữ dependency tối thiểu |
| 7 | Auth | Endpoint `RequireAuthorization()` (chỉ cần authenticated); permission chi tiết enforce ở downstream | JWT passthrough, BFF không mint token |
| 8 | Map | Passthrough thuần, một nguồn → không khối `sources`; GIS down → 502 | bbox đã kèm status |

## Kiến trúc & thành phần

Tái dùng building blocks: `AddPlatformWebApi` (auth + ProblemDetails + correlation),
`AddObservability`, `AddSerilogLogging`, mapping endpoint qua `IEndpointModule` +
`MapEndpointModules`. **Không dùng**: persistence, outbox, CQRS, event bus, multi-tenancy DB filter
(BFF không sở hữu data). MultiTenancy middleware không bắt buộc — tenant chảy qua token/header và
được forward xuống downstream.

- **Typed HTTP client**
  - `IGisApiClient` / `GisApiClient` — `GetNodeDetailAsync` / `GetPipeDetailAsync` /
    `GetDeviceDetailAsync` (theo type), `GetAssetsInBboxAsync(bbox, types, limit)`.
  - `IAssetApiClient` / `AssetApiClient` — `GetAssetDetailAsync(id)`.
  - Base URL từ config `Downstream:Gis:BaseUrl`, `Downstream:Asset:BaseUrl`.
  - Client phân biệt rõ 3 kết quả: **OK (200 + body)**, **NotFound (404)**, **Unavailable**
    (timeout / 5xx / lỗi mạng / circuit open) — để endpoint quyết định 404 vs 502 vs null.
- **`AuthForwardingHandler`** (`DelegatingHandler` + `IHttpContextAccessor`) — copy `Authorization`,
  `X-Tenant-Id`, correlation-id header sang outbound request. JWT passthrough.
- **Resilience** — `AddStandardResilienceHandler` (hoặc cấu hình tương đương) trên mỗi typed
  client: attempt timeout ~1s, retry off, circuit breaker mặc định.
- **`OverviewEndpointModule`**, **`MapEndpointModule`** — hai route.

## Luồng dữ liệu

### Overview — `GET /bff/water-network/assets/{assetId}/overview?type=...`

1. Validate `type` ∈ {node, pipe, device} (sai → 400).
2. Fan-out song song: GIS detail (route theo type) + asset `GET /api/assets/{assetId}`.
3. GIS: 404 → BFF **404**; Unavailable → BFF **502**; OK → tiếp.
4. Asset: OK → `lifecycle` từ `AssetDetailDto`, `sources.asset:"ok"`; 404/Unavailable/403 →
   `lifecycle:null`, `sources.asset:"unavailable"`.
5. Trả 200:

```jsonc
{
  "assetId": "...",
  "type": "node",
  "gis": { /* NodeDetailDto | PipeDetailDto | DeviceDetailDto */ },
  "lifecycle": { "status": "...", "assetCode": "...", "technicalProfile": { } } | null,
  "sources": { "gis": "ok", "asset": "ok" | "unavailable" }
}
```

### Map — `GET /bff/water-network/map?bbox=&types=&limit=`

Passthrough query xuống GIS `GET /api/network/assets?bbox=&types=&limit=`. GIS OK → trả nguyên body
(đã kèm `lifecycleStatus`). GIS lỗi validation (400) → propagate 400. GIS Unavailable → 502. Một
nguồn nên **không** có khối `sources`.

## Bảng xử lý lỗi

| Tình huống | Overview | Map |
|---|---|---|
| GIS 404 | 404 | (n/a) |
| GIS 400 (validation) | (n/a — type validate ở BFF) | 400 (propagate) |
| GIS timeout/5xx/circuit-open | 502 | 502 |
| Asset 404 / timeout / 5xx / 403 | 200, `lifecycle:null`, `sources.asset:"unavailable"` | (n/a) |
| Cả hai OK | 200 đầy đủ | 200 |

## Test (TDD)

- **Unit**
  - `AuthForwardingHandler` copy đúng `Authorization` / `X-Tenant-Id` / correlation-id; bỏ qua khi
    `HttpContext` null.
  - Logic compose overview: map đúng `sources` + `lifecycle:null` theo từng kết quả client giả lập.
- **Integration** (`WebApplicationFactory<Program>` + **WireMock.Net** giả lập GIS & asset):
  - Overview: cả-hai-ok → 200 đầy đủ; asset-down → 200 `lifecycle:null` + `sources.asset:"unavailable"`;
    asset-404 → 200 `lifecycle:null`; GIS-404 → 404; GIS-down → 502.
  - Map: passthrough ok (body chứa `lifecycleStatus`); GIS-down → 502.
  - Auth forward: assert WireMock nhận `Authorization` + `X-Tenant-Id` từ request BFF.

## Ngoài scope (ghi follow-up)

- **Search endpoint** `GET /bff/.../assets/search?q=` — cần GIS search slice (GIS-6) trước; rồi BFF-n.
- **YARP gateway route** — cross-cutting US-X; tạm thời BFF chạy như service/port riêng (compose
  vào docker-compose, chưa gắn gateway).
- **Endpoint Phase 3+** (`incidents/open`, `dashboard/summary`) — các slice BFF-n sau.
- **Caching response** — chưa cần; thêm khi có SLA/đo tải thật.
- **README roadmap lệch SPEC** (ghi "Phase 2: asset") — fix doc tách khỏi slice này.

## Package mới

- `Microsoft.Extensions.Http.Resilience` (runtime).
- `WireMock.Net` (test).

## Definition of Done

- `dotnet test` xanh 0 warning trên solution BFF (unit + integration).
- 2 endpoint hoạt động đúng bảng xử lý lỗi; JWT + tenant forward xuống downstream.
- `water-network-bff` có Dockerfile + entry trong `docker-compose.yml` (port riêng).
- Conventional commit; checkbox plan tick đủ; backlog cập nhật Phase 1 = done.
