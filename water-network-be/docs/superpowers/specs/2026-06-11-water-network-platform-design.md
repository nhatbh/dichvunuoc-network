# Design — Water Network Backend Platform

**Ngày:** 2026-06-11
**Trạng thái:** Approved (user duyệt trong phiên brainstorming)
**Nguồn yêu cầu:** `docs/spec-init-01.md` (SPEC v1.0)
**Khung mẫu tham chiếu:** `docs/sample/dotnet-skeleton-sample` (.NET 10 modular monolith, DDD/CQRS/event-driven)

---

## 1. Bối cảnh và phân tích khung mẫu

Khung mẫu `dotnet-skeleton-sample` là một **modular monolith .NET 10**:

- 1 deployable duy nhất: `src/apps/WaterNetworkGisBe.Api` (Program.cs host tất cả modules).
- Service modules là class library tại `src/services/*` (Order, Product, Reporting), mỗi module có đủ layer `Domain / Application / Infrastructure`.
- `src/libs/WaterNetworkGisBe.Core`: abstractions thuần — `IDomainEvent`, `IIntegrationEvent`, `IIntegrationEventMapper`, `ICommandBus`/`IQueryBus`, AggregateRoot, Specification, ValueObject.
- `src/libs/WaterNetworkGisBe.Shared`: building blocks hạ tầng — CQRS (MediatR + CommandBus/QueryBus + Logging/Idempotency pipeline behaviors), Persistence (EF Core + Npgsql, 1 `AppDbContext` chung, UnitOfWork, `SqlReadDao` cho read-side), Outbox (`OutboxProcessor` BackgroundService, retry/batch) + Inbox (`IInboxMessageStore`, `IProcessedEventStore`), MassTransit + RabbitMQ, Redis cache, Serilog + OpenTelemetry + Prometheus, JWT authentication, health checks.
- `src/libs/WaterNetworkGisBe.Integration`: anti-corruption adapters giữa modules qua Ports.
- Hạ tầng: docker-compose (Postgres 16, Redis, RabbitMQ, Jaeger, Prometheus, Grafana, Loki), k8s kustomize, CI GitHub Actions, Testcontainers integration tests.
- API style hiện tại: Controllers đặt trong `Infrastructure/Http` của từng module.

**Khoảng trống so với SPEC:** chưa có multi-tenancy (chỉ có `RequestContextProvider`), chưa có PostGIS/NetTopologySuite, `AppDbContext` dùng chung (chưa database-per-service), chưa có Keycloak/IAM tích hợp tenant claims, API Gateway, BFF.

---

## 2. Các quyết định kiến trúc đã chốt

| # | Quyết định | Lựa chọn | Ghi chú |
|---|---|---|---|
| 1 | Topology | Monorepo `water-network-be`, **mỗi service = 1 solution riêng**, deploy độc lập | Đúng spec database-per-service, scale độc lập |
| 2 | Shared code | `WaterPlatform.BuildingBlocks.*` — project reference trong monorepo | Không cần NuGet feed giai đoạn đầu |
| 3 | Database | **Database riêng per service** (`wn_gis`, `wn_asset`…), chung 1 Postgres instance ở dev | Production có thể tách instance sau |
| 4 | Event bus | **MassTransit + RabbitMQ** (giữ stack skeleton) | Phase 5 cân nhắc lại cho telemetry nếu volume yêu cầu |
| 5 | Naming | `WaterNetwork.<Context>.{Api,Application,Domain,Infrastructure,Contracts}`; building blocks `WaterPlatform.BuildingBlocks.*` | Theo spec §3.1–3.2 |
| 6 | CRS | Chỉ **EPSG:4326** Phase 1; VN-2000 convert tại import job Phase 2 | Đúng acceptance US-P1-01 (SRID 4326) |
| 7 | Tenant | JWT claims (tenant_id/organization_id/branch_id) + header `X-Tenant-Id` fallback cho dev/local. **Keycloak chỉ mock giai đoạn này** — dùng dev JWT issuer/test tokens, tích hợp Keycloak thật sau | Building block MultiTenancy hỗ trợ cả 2 qua cấu hình |
| 8 | API style | **Minimal APIs endpoint-per-feature** | Viết lại WebApiBootstrap 1 lần trong building blocks; lý do kỹ thuật ghi tại §3 |
| 9 | Event sourcing | Không — **domain events + outbox** (như skeleton) | |
| 10 | Zone service | Tách service riêng khi đến phase cần (không gộp vào GIS) | Nhất quán quyết định #1 |
| 11 | Dispatcher CQRS | **Thay MediatR bằng custom dispatcher** trong `BuildingBlocks.Application`: `ICommandHandler<,>`/`IQueryHandler<,>`/`IDomainEventHandler<>` resolve qua DI + pipeline decorators (Logging → Validation → Idempotency) | Loại bỏ license risk MediatR v13+; skeleton đã bọc sau ICommandBus/IQueryBus nên handler đổi tối thiểu |
| 12 | Hệ thống ngoài | **Mock toàn bộ external dependencies** (Keycloak, file-storage-be, notification-be, audit-log-be, master-data-be, hệ thống sản xuất/kinh doanh ngành nước) qua Ports/Adapters — adapter mock trước, thay adapter thật khi tích hợp thực tế, không đổi Application/Domain | Đúng kiến trúc ports & adapters đã có trong skeleton |

Open decisions để lại, có default đề xuất (chốt lại khi vào phase tương ứng):

- Time-series store (Phase 5): đề xuất **TimescaleDB** (cùng hệ Postgres, vận hành nhẹ hơn InfluxDB).
- Hydraulic engine (Phase 6): chỉ **EPANET export**, chưa chạy solver backend.

---

## 3. Điểm lệch convention skeleton — lý do kỹ thuật (spec §0.9)

1. **1 `AppDbContext` chung → DbContext riêng per service**: bắt buộc để thỏa nguyên tắc database-per-service (spec §4.1). Pattern UnitOfWork/Repository/ReadDao giữ nguyên.
2. **Controllers → Minimal APIs endpoint-per-feature**: .NET 10 Minimal APIs có validation tích hợp + endpoint filters + OpenAPI gen + AOT-friendly; 1 endpoint = 1 command/query khớp CQRS; chi phí chuyển đổi trả 1 lần tại `BuildingBlocks.WebApi`, 10+ services sau hưởng lợi.
3. **Thêm MultiTenancy building block**: skeleton chưa có; spec §4.4 yêu cầu multi-tenancy từ đầu.
4. **MediatR → custom dispatcher**: MediatR chuyển license thương mại từ v13; skeleton đã cách ly MediatR sau `ICommandBus`/`IQueryBus` nên thay bằng dispatcher tự viết (~200-300 dòng) trong `BuildingBlocks.Application` — bao gồm cả domain event dispatching (`IDomainEventHandler<>` thay cho `INotificationHandler<>` của MediatR trong `DomainEventDispatcher`). Pipeline behaviors (Logging, Idempotency) chuyển thành decorators tương đương.

Mọi pattern còn lại giữ nguyên từ skeleton: OutboxProcessor, Inbox/ProcessedEventStore, IIntegrationEventMapper, CommandBus/QueryBus, Idempotency behavior, anti-corruption Ports/Adapters, Serilog/OTel/health checks, Testcontainers.

---

## 4. Cấu trúc monorepo

```text
water-network-be/
├── Directory.Build.props / Directory.Packages.props / global.json (.NET 10)
├── src/
│   ├── building-blocks/
│   │   ├── src/                                          ← 9 production projects (mirror gis-be pattern)
│   │   │   ├── WaterPlatform.BuildingBlocks.Domain/          ← từ Core/Domain (AggregateRoot, IDomainEvent, ValueObject, Specification)
│   │   │   ├── WaterPlatform.BuildingBlocks.Application/     ← từ Core/Application + Shared/Cqrs, MediatR thay bằng custom dispatcher (quyết định #11)
│   │   │   ├── WaterPlatform.BuildingBlocks.Infrastructure/  ← từ Shared/{Persistence,Outbox,Caching} (Outbox/Inbox, UnitOfWork, ReadDao)
│   │   │   ├── WaterPlatform.BuildingBlocks.EventBus/        ← từ Shared/Events (MassTransit + envelope chuẩn spec §16)
│   │   │   ├── WaterPlatform.BuildingBlocks.MultiTenancy/    ← MỚI (TenantContext, resolver JWT/header, EF global query filter)
│   │   │   ├── WaterPlatform.BuildingBlocks.Security/        ← từ Shared/Bootstrap JWT + permission policies (`network-gis:write`…)
│   │   │   ├── WaterPlatform.BuildingBlocks.Observability/   ← từ Shared/Observability (Serilog, OTel, health checks)
│   │   │   ├── WaterPlatform.BuildingBlocks.WebApi/          ← MỚI (Minimal API bootstrap, ProblemDetails, validation endpoint filter)
│   │   │   └── WaterPlatform.BuildingBlocks.Testing/         ← Testcontainers fixtures (PostGIS, RabbitMQ) — lives with production
│   │   └── tests/                                        ← 6 test projects (xUnit + FluentAssertions)
│   └── services/
│       ├── water-network-gis-be/        # Phase 1 — DB: wn_gis (PostGIS)
│       ├── water-network-asset-be/      # Phase 1 — DB: wn_asset
│       ├── water-network-bff/           # Phase 1 tối giản — không có DB
│       └── (design-be, zone-be, topology-rs, incident-be, maintenance-be,
│            observation-be, hydraulic-be, customer-impact-be — thêm theo phase)
├── docker-compose.yml               # postgres+postgis, rabbitmq, redis, jaeger, prometheus, grafana, loki (Keycloak: mock, chưa cần container)
└── docs/
```

### Cấu trúc 1 service (gis-be làm mẫu)

```text
src/services/water-network-gis-be/
├── WaterNetwork.Gis.slnx
├── src/                              # production code (5 layered projects — xem Phase 0 plan)
│   ├── WaterNetwork.Gis.Api/             # Endpoints/ (per-feature), Program.cs — chỉ HTTP, không business
│   ├── WaterNetwork.Gis.Application/     # Commands/, Queries/, Validators/, Ports/, EventHandlers/
│   ├── WaterNetwork.Gis.Domain/          # Aggregates/ (NetworkNode, NetworkPipe, NetworkDevice),
│   │                                     # ValueObjects/ (GeoPoint, AssetCode, NodeType), DomainEvents/, Repositories/ (interfaces)
│   ├── WaterNetwork.Gis.Infrastructure/  # Persistence/ (GisDbContext + PostGIS/NetTopologySuite), Repositories/,
│   │                                     # Projections/, IntegrationEvents/ (mappers)
│   └── WaterNetwork.Gis.Contracts/       # Events/, Requests/, Responses/, Errors/ — service khác CHỈ được reference project này
└── tests/                            # 3 test project nằm trong subfolder tests/ (xem Phase 0 plan + conventions/template-mapping.md §2)
    ├── WaterNetwork.Gis.UnitTests/
    ├── WaterNetwork.Gis.IntegrationTests/
    └── WaterNetwork.Gis.ContractTests/
```

Layer dependency (spec §3.3): `Api → Application → Domain`; `Infrastructure → Application + Domain`; `Contracts` không phụ thuộc Infrastructure; `Domain` không phụ thuộc layer nào khác.

---

## 5. Data flow chuẩn (ví dụ slice đầu RegisterNode)

```text
FE → POST /api/network/nodes (JWT có tenant claims)
 → TenantContext middleware resolve (thiếu → 401/403)
 → RegisterNodeCommand (tenantId, correlationId, actorId)
 → FluentValidation validator
 → Handler: NetworkNode.Register(...) — business rules trong Domain
 → Domain event NodeRegistered + outbox message LƯU CÙNG TRANSACTION (EF)
 → OutboxProcessor poll → IIntegrationEventMapper → envelope network.node.registered v1 → RabbitMQ
 → asset-be Inbox consumer (idempotent qua ProcessedEventStore) → tạo AssetProfile → publish asset.registered
 → gis-be consume asset.status.changed → update local projection network_asset_states
```

Event envelope chuẩn (spec §16): `eventId, eventType, eventVersion, occurredAt, tenantId, organizationId, branchId, correlationId, causationId, producer, payload`.

---

## 6. Cross-cutting

- **Multi-tenancy**: `TenantContext` scoped per request; mọi entity nghiệp vụ có `tenant_id`; EF global query filter theo tenant; mọi command/query/event/log bắt buộc tenant + correlation context.
- **Security**: permission policy format `<context>:<action>` (`network-gis:write`, `network-design:approve`…) map từ Keycloak roles/claims; service-to-service qua system identity.
- **Error contract (US-X-02)**: ProblemDetails thống nhất — 400 field-level errors, 404 not found, 409 conflict, 422 business rule (code machine-readable), 500 sanitized + correlationId, không leak stacktrace.
- **Observability (US-P0-04)**: Serilog scope (tenantId, correlationId), OTel trace span per command, `/health` check DB/broker/redis, Prometheus metrics — kế thừa skeleton.

---

## 7. Testing

- **Unit**: value objects, business rules, command/query handlers (xUnit, không cần infra).
- **Integration**: Testcontainers `postgis/postgis:16` + RabbitMQ qua `BuildingBlocks.Testing` fixtures; bao gồm test outbox→broker→inbox end-to-end (US-P0-03).
- **Contract**: event payload match schema versioned cho từng integration event (US-X-03); producer test + consumer test.

---

## 8. Phân rã sub-projects (mỗi cái 1 vòng spec → plan → implement)

1. **Sub-project 1 (làm ngay)** — Phase 0 Foundation + first slice:
   - Dựng monorepo (props, solution layout, docker-compose, CI).
   - Extract building blocks từ skeleton → `WaterPlatform.BuildingBlocks.*`.
   - Building block mới: MultiTenancy, WebApi (Minimal API bootstrap), Testing fixtures.
   - Scaffold `water-network-gis-be` với slice **US-P1-01 RegisterNode** chạy end-to-end (aggregate, command, validator, handler, PostGIS migration `network_nodes` SRID 4326, domain event, outbox, endpoint POST/GET, unit + integration tests) — làm bằng chứng convention (spec §7.4.1).
2. **Sub-project 2** — phần còn lại Phase 1: RegisterPipe, InstallDevice, bbox query, `water-network-asset-be` (consume events, asset profile), projection `network_asset_states`, BFF overview tối giản.
3. **Sub-project 3+** — Phase 2 → 7 theo roadmap spec (Design+Import, Topology+Incident, Maintenance, Observation, Hydraulic, Customer Impact+Reporting).

Liên thông với các phần khác ngành nước (sản xuất, kinh doanh): qua **integration events + Contracts + BFF read composition**, không chia sẻ database — sẵn sàng mở rộng khi các domain đó tham gia platform.

---

## 9. Risks & assumptions

- **PostGIS mới với skeleton**: thêm `NetTopologySuite` + `Npgsql.NetTopologySuite` — rủi ro thấp, pattern phổ biến.
- **Custom dispatcher thay MediatR** (quyết định #11): chi phí viết + test một lần trong building blocks; cần unit test kỹ pipeline decorators (Logging → Validation → Idempotency) vì là nền của mọi service.
- **Keycloak: mock giai đoạn hiện tại** — dùng dev JWT issuer (test tokens ký local) + header `X-Tenant-Id` fallback; `BuildingBlocks.Security` để sẵn cấu hình authority/audience để khi gắn Keycloak thật chỉ đổi config, không đổi code.
- **External systems đều mock qua Ports/Adapters** (quyết định #12): file-storage-be, notification-be, audit-log-be, master-data-be và các hệ thống sản xuất/kinh doanh ngành nước — mỗi dependency có Port interface trong Application + mock adapter trong Infrastructure; khi tích hợp thật chỉ thay adapter, cập nhật spec/design tại thời điểm đó.
- **Assumption**: repo `water-network-be` là monorepo đích cho toàn bộ Water Network domain services; Platform Core services khác nằm ngoài scope các sub-project 1–2 và chỉ xuất hiện dưới dạng mock adapter.
