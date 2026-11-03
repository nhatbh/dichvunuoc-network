# SPEC v1.0 — Water Network Backend Platform

**Ngày:** 2026-06-11  
**Đối tượng đọc:** AI coding agent, architecture agent, backend team, technical lead  
**Mục tiêu:** Cung cấp SPEC hoàn chỉnh để agent phân tích khung microservices .NET hiện có, lập kế hoạch phát triển backend Water Network Platform theo từng giai đoạn, có User Stories và Acceptance Criteria rõ ràng.

---

## 0. Cách agent phải sử dụng tài liệu này

Tài liệu này là **agent-readable implementation SPEC**. Agent không được nhảy thẳng vào code khi chưa phân tích template hiện có.

Agent phải thực hiện theo thứ tự:

1. Đọc toàn bộ SPEC này.
2. Kiểm tra repository backend microservices hiện có của dự án.
3. Xác định kiến trúc thực tế của template: DDD, CQRS, event-driven, outbox/inbox, repository, persistence, testing, naming convention, module layout.
4. So khớp kiến trúc template với SPEC này.
5. Tạo implementation plan theo phase.
6. Chỉ implement từng slice nhỏ, có test, có migration, có event contract.
7. Không tạo God Service.
8. Không để service này đọc/ghi trực tiếp database của service khác.
9. Không phá vỡ style/convention đã có trong template nếu không có lý do kỹ thuật rõ ràng.
10. Mọi thay đổi lớn phải được mô tả trong plan trước khi code.

---

## 1. Bối cảnh sản phẩm

Water Network Platform là nhóm dịch vụ backend phục vụ quản lý mạng lưới cấp nước trong Water Platform.

Nền tảng cần hỗ trợ các nghiệp vụ chính:

- Quản lý bản đồ mạng lưới nước.
- Quản lý tài sản mạng lưới: node, pipe, device, zone.
- Quản lý vòng đời tài sản.
- Quản lý thiết kế, bản vẽ, dữ liệu nháp và publish sang GIS.
- Phân tích topology, isolation zone, van cần đóng.
- Quản lý sự cố.
- Quản lý bảo trì/sửa chữa.
- Thu thập và khai thác telemetry/observation.
- Quản lý mô hình thủy lực và EPANET.
- Tính toán ảnh hưởng đến khách hàng/khu vực.
- Cung cấp BFF/read composition cho FE xem thông tin liên thông.

Core design principle:

```text
View can be composed.
Write must be owned.
```

Frontend có thể xem dữ liệu liên thông từ nhiều nghiệp vụ. Backend command/write luôn phải đi vào service sở hữu nghiệp vụ đó.

---

## 2. Kiến trúc backend mục tiêu

```text
Water Platform
│
├── Platform Core Services
│   ├── iam-keycloak
│   ├── api-gateway
│   ├── water-network-bff
│   ├── audit-log-be
│   ├── notification-be
│   ├── file-storage-be
│   ├── reporting-be
│   └── master-data-be
│
└── Water Network Domain Services
    ├── water-network-gis-be
    ├── water-network-asset-be
    ├── water-network-design-be
    ├── water-network-zone-be
    ├── water-network-topology-rs
    ├── water-network-incident-be
    ├── water-network-maintenance-be
    ├── water-network-observation-be
    ├── water-network-hydraulic-be
    └── water-network-customer-impact-be
```

---

## 3. Kiến trúc mẫu microservices cần tuân thủ

Template hiện có được giả định là .NET 10 microservices foundation theo DDD/CQRS/event-driven. Agent phải kiểm chứng thực tế trong repo, nhưng kế hoạch triển khai cần ưu tiên giữ các convention sau.

### 3.1 Cấu trúc chuẩn cho mỗi .NET service

```text
WaterNetwork.<ServiceName>/
├── WaterNetwork.<ServiceName>.Api/
│   ├── Controllers/ or Endpoints/
│   ├── Middlewares/
│   ├── Filters/
│   ├── Program.cs
│   └── ServiceCollectionExtensions.cs
│
├── WaterNetwork.<ServiceName>.Application/
│   ├── Commands/
│   ├── Queries/
│   ├── Dtos/
│   ├── Validators/
│   ├── Ports/
│   ├── EventHandlers/
│   └── UseCases/
│
├── WaterNetwork.<ServiceName>.Domain/
│   ├── Aggregates/
│   ├── ValueObjects/
│   ├── DomainEvents/
│   ├── Rules/
│   ├── Repositories/
│   └── Services/
│
├── WaterNetwork.<ServiceName>.Infrastructure/
│   ├── Persistence/
│   ├── Repositories/
│   ├── EventBus/
│   ├── Outbox/
│   ├── Inbox/
│   ├── ExternalServices/
│   ├── Projections/
│   └── Configurations/
│
├── WaterNetwork.<ServiceName>.Contracts/
│   ├── Requests/
│   ├── Responses/
│   ├── Events/
│   └── Errors/
│
└── tests/
    ├── UnitTests/
    ├── IntegrationTests/
    └── ContractTests/
```

Nếu template hiện tại đang dùng tên khác, ví dụ `Core`, `Shared`, `Modules`, `Features`, `UseCases`, `Handlers`, agent phải map tương ứng, không tự ý đổi toàn bộ convention.

### 3.2 Building blocks dùng chung

Đề xuất có các building blocks sau, hoặc map vào khối tương đương trong template:

```text
WaterPlatform.BuildingBlocks.Domain
WaterPlatform.BuildingBlocks.Application
WaterPlatform.BuildingBlocks.Infrastructure
WaterPlatform.BuildingBlocks.EventBus
WaterPlatform.BuildingBlocks.MultiTenancy
WaterPlatform.BuildingBlocks.Security
WaterPlatform.BuildingBlocks.Observability
WaterPlatform.BuildingBlocks.Testing
```

### 3.3 Quy tắc layer dependency

```text
Api -> Application -> Domain
Infrastructure -> Application + Domain
Contracts -> không phụ thuộc Infrastructure
Domain -> không phụ thuộc Application/Infrastructure/Api
```

### 3.4 Technical stack đề xuất

```text
.NET 10
ASP.NET Core
EF Core
Dapper for read-side performance queries
PostgreSQL
PostGIS for GIS/Zone services
MassTransit/RabbitMQ or platform EventBus abstraction
Redis
OpenTelemetry
Serilog
FluentValidation
Testcontainers
xUnit
NetTopologySuite for GIS geometry
Rust + tonic + petgraph for topology-rs
```

---

## 4. Nguyên tắc kiến trúc không được vi phạm

### 4.1 Database-per-service

Mỗi service sở hữu database/schema riêng. Không service nào được dùng DbContext hoặc SQL query trực tiếp vào bảng của service khác.

Allowed:

- Integration events.
- HTTP/gRPC APIs.
- BFF/read composition.
- Local projections updated by events.
- Anti-corruption adapters.

Disallowed:

- Shared domain database.
- Cross-service SQL join.
- Dùng EF entity của service khác.
- Update bảng của service khác.

### 4.2 Command ownership

Một command phải được xử lý bởi service sở hữu quyết định nghiệp vụ.

| Business action | Backend owner |
|---|---|
| Move node | `water-network-gis-be` |
| Reroute pipe | `water-network-gis-be` |
| Change asset lifecycle | `water-network-asset-be` |
| Approve design revision | `water-network-design-be` |
| Create incident | `water-network-incident-be` |
| Create work order | `water-network-maintenance-be` |
| Ingest telemetry | `water-network-observation-be` |
| Run hydraulic simulation | `water-network-hydraulic-be` |

### 4.3 Event facts, not UI commands

Events mô tả việc đã xảy ra. UI không publish event để thay thế command.

Correct:

```text
FE -> asset-be: DecommissionAssetCommand
asset-be -> publishes asset.decommissioned
```

Incorrect:

```text
FE -> event-bus: asset.decommissioned
```

### 4.4 Multi-tenancy từ đầu

Tất cả service nghiệp vụ phải truyền và lưu tenant context:

```text
tenant_id
organization_id
branch_id
zone_id optional
dma_id optional
```

Mọi command, query, event, audit log, outbox message phải có tenant/correlation context.

### 4.5 Observability từ đầu

Mỗi service phải có:

- Health check.
- Structured logging.
- Correlation ID.
- OpenTelemetry tracing.
- Metrics.
- Error handling chuẩn.
- Audit integration nếu command thay đổi nghiệp vụ.

---

## 5. Service catalog chi tiết

## 5.1 `water-network-gis-be`

### Vai trò

Source of truth cho geometry, spatial asset, map query và GIS import/export.

### Sở hữu dữ liệu

- `NetworkNode`
- `NetworkPipe`
- `NetworkDevice`
- `GeometryVersion`
- `SpatialLayer`
- `GisImportJob`
- `GisExportJob`
- Local projection: `NetworkAssetStateProjection`

### Không sở hữu

- Asset lifecycle.
- Design approval.
- Heavy topology computation.
- Telemetry time-series.
- Incident lifecycle.
- Maintenance workflow.
- Full hydraulic simulation.

### Commands

```text
RegisterNode
RelocateNode
RemoveNode
RegisterPipe
ReroutePipe
RemovePipe
InstallDevice
RelocateDevice
RemoveDevice
ImportGeoJson
ImportWfs
ExportGeoJson
RecordGeometryVersion
```

### Queries

```text
GetAssetsInBbox
GetAssetsInRadius
SearchNetworkAssets
GetNodeDetail
GetPipeDetail
GetDeviceDetail
GetGeometryHistory
GetMapLayers
```

### Events publish

```text
network.node.registered
network.node.relocated
network.node.removed
network.pipe.registered
network.pipe.rerouted
network.pipe.removed
network.device.installed
network.device.relocated
network.device.removed
network.geometry.changed
network.gis-import.completed
```

### Events consume

```text
asset.status.changed
asset.decommissioned
valve.state.changed
design.asset.ready-for-gis
```

---

## 5.2 `water-network-asset-be`

### Vai trò

Source of truth cho hồ sơ tài sản, trạng thái, vòng đời, ownership và thông tin kỹ thuật phi không gian.

### Sở hữu dữ liệu

- `NetworkAsset`
- `AssetLifecycle`
- `AssetTechnicalProfile`
- `AssetOwnership`
- `CommissioningRecord`
- `DecommissioningRecord`

### Commands

```text
CreateAssetProfile
UpdateAssetTechnicalProfile
ActivateAsset
MarkAssetAsMaintenance
SuspendAsset
DecommissionAsset
TransferAssetOwnership
LinkAssetToOrganizationUnit
```

### Events publish

```text
asset.registered
asset.activated
asset.status.changed
asset.maintenance-marked
asset.decommissioned
asset.ownership.transferred
asset.technical-profile.updated
```

### Events consume

```text
network.node.registered
network.pipe.registered
network.device.installed
network.geometry.changed
maintenance.work-order.completed
incident.resolved
```

---

## 5.3 `water-network-design-be`

### Vai trò

Source of truth cho thiết kế, bản vẽ, draft asset, revision và approval workflow trước khi publish sang GIS.

### Sở hữu dữ liệu

- `DesignProject`
- `DesignDocument`
- `DraftNetworkAsset`
- `DesignRevision`
- `DesignApproval`
- `DesignChangeRequest`

### Commands

```text
CreateDesignProject
UploadDesignDocument
CreateDraftAsset
UpdateDraftGeometry
SubmitDesignRevision
ApproveDesignRevision
RejectDesignRevision
PublishDraftAssetToGis
CancelDesignProject
```

### Events publish

```text
design.project.created
design.document.uploaded
design.revision.submitted
design.revision.approved
design.revision.rejected
design.asset.ready-for-gis
network.asset.drafted
```

---

## 5.4 `water-network-zone-be`

### Vai trò

Source of truth cho vùng cấp nước, DMA, pressure zone, service area và boundary vận hành.

### Sở hữu dữ liệu

- `SupplyZone`
- `DmaZone`
- `PressureZone`
- `ServiceArea`
- `ZoneBoundary`
- `ZoneHierarchy`

### Commands

```text
CreateSupplyZone
UpdateZoneBoundary
AssignAssetToZone
RemoveAssetFromZone
ActivateZone
DeactivateZone
```

### Events publish

```text
zone.created
zone.boundary.updated
zone.asset.assigned
zone.asset.removed
zone.deactivated
```

---

## 5.5 `water-network-topology-rs`

### Vai trò

Rust computation engine cho graph/topology/isolation/trace/validation.

### Logic chính

- Build network graph.
- Validate connectivity.
- Detect orphan nodes.
- Detect disconnected pipes.
- Compute isolation zone.
- Find isolating valves.
- Trace upstream/downstream.
- Find shortest path.

### gRPC methods

```text
ComputeIsolationZone
ValidateTopology
TraceNetwork
FindNearestValves
BuildNetworkSnapshot
ExportTopologyGraph
```

---

## 5.6 `water-network-incident-be`

### Vai trò

Source of truth cho sự cố, phân loại, affected assets, affected zones, isolation plan và incident timeline.

### Commands

```text
ReportIncident
ClassifyIncident
AttachAffectedAsset
RequestIsolationAnalysis
ConfirmIsolationPlan
StartIncidentHandling
EscalateIncident
ResolveIncident
CancelIncident
```

### Events publish

```text
incident.reported
incident.classified
incident.isolation-requested
incident.isolation-plan-confirmed
incident.handling-started
incident.resolved
incident.cancelled
maintenance.work-order-requested
```

---

## 5.7 `water-network-maintenance-be`

### Vai trò

Source of truth cho work order, bảo trì, sửa chữa, field assignment, repair record và material usage.

### Commands

```text
CreateWorkOrder
AssignTechnician
ScheduleWorkOrder
StartWorkOrder
PauseWorkOrder
CompleteWorkOrder
CancelWorkOrder
RecordRepairResult
RecordMaterialUsage
```

### Events publish

```text
work-order.created
work-order.assigned
work-order.scheduled
work-order.started
work-order.completed
work-order.cancelled
repair.recorded
material.used
```

---

## 5.8 `water-network-observation-be`

### Vai trò

Source of truth cho telemetry, pressure/flow/valve/pump readings, latest observation và observation alerts.

### Commands/ingestion

```text
RegisterTelemetryDevice
MapTelemetryDeviceToNetworkAsset
IngestPressureReading
IngestFlowReading
IngestValveState
IngestPumpState
ConfigureThreshold
AcknowledgeObservationAlert
```

### Events publish

```text
pressure.reading.received
flow.reading.received
valve.state.changed
pump.state.changed
pressure.abnormal-detected
flow.abnormal-detected
sensor.offline-detected
observation.alert.acknowledged
```

---

## 5.9 `water-network-hydraulic-be`

### Vai trò

Source of truth cho hydraulic model, scenario, simulation run/result, demand pattern, boundary condition và EPANET jobs.

### Commands

```text
CreateHydraulicModel
CreateHydraulicScenario
ConfigureDemandPattern
ConfigureBoundaryCondition
RunSimulation
CancelSimulation
ExportEpanetInp
ImportSimulationResult
CompareSimulationRuns
```

### Events publish

```text
hydraulic.model.created
hydraulic.scenario.created
hydraulic.simulation.started
hydraulic.simulation.completed
hydraulic.simulation.failed
hydraulic.epanet.exported
```

---

## 5.10 `water-network-customer-impact-be`

### Vai trò

Source of truth cho impact analysis: affected customers, service connections, critical customers và notification target groups.

### Commands

```text
CreateImpactAnalysis
ComputeIncidentImpact
ComputeMaintenanceImpact
ConfirmImpactSnapshot
MarkCustomerNotified
```

### Events publish

```text
customer-impact.computed
customer-impact.confirmed
customer-impact.notification-required
```

---

## 5.11 `water-network-bff`

### Vai trò

Backend-for-Frontend cho Water Network FE/micro-frontends. Không chứa business rule chính.

### API mẫu

```http
GET /bff/water-network/map
GET /bff/water-network/map/layers
GET /bff/water-network/assets/search
GET /bff/water-network/assets/{assetId}/overview
GET /bff/water-network/incidents/open
GET /bff/water-network/dashboard/summary
```

---

# 6. Roadmap tổng thể

```text
Phase 0 — Platform Foundation
Phase 1 — Network GIS + Asset Core
Phase 2 — Design + Import Workflow
Phase 3 — Topology + Incident
Phase 4 — Maintenance
Phase 5 — Observation/Telemetry
Phase 6 — Hydraulic Modeling
Phase 7 — Customer Impact + Reporting
```

Mỗi phase dưới đây có User Stories và Acceptance Criteria rõ ràng.

---

# 7. Phase 0 — Platform Foundation

## 7.1 Mục tiêu

Thiết lập nền kỹ thuật chung để các microservices Water Network có thể phát triển thống nhất: service skeleton, multi-tenancy, auth context, observability, event bus, outbox/inbox, health checks, testing infrastructure và local development environment.

## 7.2 Services/components liên quan

- API Gateway.
- Keycloak/IAM integration.
- Event Bus abstraction.
- Outbox/Inbox building blocks.
- Multi-tenancy building blocks.
- Observability building blocks.
- Local Docker Compose.
- Testcontainers setup.

## 7.3 User Stories

### US-P0-01 — Khởi tạo service skeleton chuẩn

**As a** backend developer,  
**I want** một service skeleton chuẩn theo kiến trúc DDD/CQRS/event-driven,  
**So that** mọi microservice Water Network có cùng cấu trúc và convention.

**Acceptance Criteria:**

- Given một service mới được scaffold từ template, when build solution, then build thành công không lỗi.
- Given service skeleton, then có các layer hoặc module tương đương: Api, Application, Domain, Infrastructure, Contracts, Tests.
- Given Domain layer, then không phụ thuộc Api/Application/Infrastructure.
- Given Application layer, then command/query/validator/port/handler được đặt đúng vị trí theo convention hiện có.
- Given Infrastructure layer, then persistence, repository, event bus, outbox/inbox adapter được cô lập khỏi Domain.
- Given test projects, then có ít nhất unit test mẫu và integration test mẫu chạy được.

---

### US-P0-02 — Chuẩn hóa tenant context

**As a** platform architect,  
**I want** mọi request/command/event có tenant context,  
**So that** platform có thể vận hành multi-tenant ngay từ đầu.

**Acceptance Criteria:**

- Given HTTP request có tenant header/claim hợp lệ, when vào service, then `TenantContext` được resolve thành công.
- Given command được xử lý, then command context có `tenantId`, `organizationId` optional, `branchId` optional.
- Given integration event được publish, then event envelope có `tenantId` và `correlationId`.
- Given thiếu tenant context ở endpoint yêu cầu tenant, then API trả lỗi chuẩn `400/401/403` theo policy của template.
- Given logs được ghi, then log scope có `tenantId` và `correlationId`.

---

### US-P0-03 — Reliable messaging với Outbox/Inbox

**As a** backend developer,  
**I want** publish integration event qua Outbox và consume event idempotent,  
**So that** service không mất event khi transaction DB thành công nhưng broker lỗi.

**Acceptance Criteria:**

- Given một command tạo domain event, when transaction commit, then outbox message được lưu trong cùng transaction.
- Given outbox dispatcher chạy, when broker sẵn sàng, then message được publish và mark processed.
- Given broker lỗi tạm thời, then outbox message vẫn còn trạng thái pending/retry.
- Given cùng một integration event được deliver hai lần, then inbox/idempotent consumer chỉ xử lý một lần.
- Given consumer xử lý lỗi, then lỗi được log với correlation context và event không bị mất thầm lặng.

---

### US-P0-04 — Observability baseline

**As an** operations engineer,  
**I want** mọi service có health check, logging, tracing và metrics baseline,  
**So that** có thể vận hành và debug khi hệ thống phân tán.

**Acceptance Criteria:**

- Given service chạy, when gọi `/health`, then trả trạng thái DB/broker/cache cơ bản.
- Given một request đi qua service, then log có request id/correlation id/tenant id.
- Given command handler chạy, then trace span thể hiện command name và duration.
- Given exception phát sinh, then lỗi được chuẩn hóa theo problem details hoặc error contract của template.
- Given service dependency lỗi, then health check phản ánh degraded/unhealthy theo cấu hình.

---

## 7.4 Phase Acceptance Criteria

Phase 0 hoàn thành khi:

1. Có scaffold convention được xác nhận trên ít nhất một service mẫu.
2. Multi-tenancy context hoạt động qua HTTP, command và event.
3. Outbox/Inbox chạy được bằng integration test.
4. Local Docker Compose có DB, broker, Redis nếu cần.
5. Observability baseline hoạt động.
6. Testcontainers chạy được trong CI/local.
7. Agent có tài liệu mapping template convention sang Water Network services.

## 7.5 Out of Scope

- Không implement domain Water Network thật.
- Không tạo đủ tất cả microservices.
- Không tối ưu performance nâng cao.

---

# 8. Phase 1 — Network GIS + Asset Core

## 8.1 Mục tiêu

Xây dựng lõi backend đầu tiên cho bản đồ mạng lưới: quản lý node/pipe/device geometry trong `water-network-gis-be`, quản lý asset profile/lifecycle tối giản trong `water-network-asset-be`, và cung cấp BFF/read composition tối thiểu cho FE xem bản đồ liên thông.

## 8.2 Services liên quan

- `water-network-gis-be`
- `water-network-asset-be`
- `water-network-bff` tối giản
- Event bus
- PostGIS

## 8.3 User Stories

### US-P1-01 — Đăng ký network node

**As a** GIS editor/system integrator,  
**I want** đăng ký một node mạng lưới với tọa độ và loại node,  
**So that** node được quản lý trên bản đồ mạng nước.

**Acceptance Criteria:**

- Given request `RegisterNode` có `assetCode`, `nodeType`, `location`, `tenantId`, when gửi vào GIS service, then tạo `NetworkNode` thành công.
- Given `assetCode` đã tồn tại trong cùng tenant, when đăng ký node mới, then trả lỗi validation/conflict.
- Given location không hợp lệ hoặc thiếu SRID/lat/lng, when đăng ký, then trả lỗi validation.
- Given node tạo thành công, then domain event `NodeRegistered` được phát sinh.
- Given transaction commit, then integration event `network.node.registered` được lưu Outbox.
- Given event được publish, then asset service có thể consume để tạo asset profile tối giản.
- Given gọi query detail, then trả đúng thông tin node vừa tạo.

---

### US-P1-02 — Đăng ký network pipe

**As a** GIS editor/system integrator,  
**I want** đăng ký một tuyến ống nối hai node đã tồn tại,  
**So that** mạng lưới có topology cơ bản.

**Acceptance Criteria:**

- Given `fromNodeId` và `toNodeId` tồn tại, when gửi `RegisterPipe`, then pipe được tạo.
- Given `fromNodeId` không tồn tại, then trả lỗi business rule.
- Given `toNodeId` không tồn tại, then trả lỗi business rule.
- Given `fromNodeId == toNodeId`, then trả lỗi business rule.
- Given geometry không phải `LineString`, then trả lỗi validation.
- Given diameter <= 0, then trả lỗi validation.
- Given pipe tạo thành công, then length được tính từ geometry hoặc lưu theo rule được chọn.
- Given pipe tạo thành công, then publish `network.pipe.registered` qua Outbox.

---

### US-P1-03 — Cài đặt network device

**As a** GIS editor/system integrator,  
**I want** cài đặt thiết bị như valve, flow meter, pressure sensor vào pipe hoặc node,  
**So that** thiết bị được hiển thị và liên kết đúng trên mạng lưới.

**Acceptance Criteria:**

- Given `deviceType`, `assetCode`, `location` hợp lệ, when install device, then tạo `NetworkDevice` thành công.
- Given `hostPipeId` được cung cấp, then pipe phải tồn tại.
- Given `hostNodeId` được cung cấp, then node phải tồn tại.
- Given không có hostPipeId và hostNodeId cho loại device bắt buộc có host, then trả lỗi business rule.
- Given device tạo thành công, then publish `network.device.installed`.

---

### US-P1-04 — Spatial query theo bounding box

**As a** map viewer,  
**I want** lấy assets nằm trong viewport/bounding box,  
**So that** frontend có thể render bản đồ hiệu quả.

**Acceptance Criteria:**

- Given bbox hợp lệ, when gọi `GetAssetsInBbox`, then trả nodes/pipes/devices nằm trong bbox.
- Given bbox thiếu hoặc min/max sai, then trả lỗi validation.
- Given `types` filter, then chỉ trả asset types tương ứng.
- Given `maxPoints` hoặc limit, then kết quả không vượt quá limit.
- Given asset đã soft delete, then không xuất hiện trong kết quả mặc định.
- Given local asset state projection có status, then response có status nếu available.
- Given query chạy trên PostGIS, then có spatial index migration tương ứng.

---

### US-P1-05 — Asset profile tối giản từ GIS event

**As an** asset manager,  
**I want** asset profile được tạo khi GIS đăng ký node/pipe/device,  
**So that** lifecycle service có hồ sơ tài sản tương ứng.

**Acceptance Criteria:**

- Given asset service consume `network.node.registered`, then tạo asset profile với type `Node`.
- Given asset service consume `network.pipe.registered`, then tạo asset profile với type `Pipe`.
- Given asset service consume `network.device.installed`, then tạo asset profile với type `Device`.
- Given event bị deliver lại, then asset profile không bị duplicate.
- Given asset profile được tạo, then publish `asset.registered`.
- Given asset status mặc định, then status là `Active` hoặc trạng thái mặc định được business chốt.

---

### US-P1-06 — Đồng bộ asset status về GIS read projection

**As a** map viewer,  
**I want** thấy trạng thái vận hành của asset trên bản đồ,  
**So that** tôi biết asset đang active, maintenance hay decommissioned.

**Acceptance Criteria:**

- Given asset service publish `asset.status.changed`, when GIS consume event, then cập nhật `network_asset_states` local projection.
- Given `asset.decommissioned`, then GIS projection có status `Decommissioned`.
- Given spatial query, then kết quả join với projection để trả status.
- Given event duplicate, then projection update idempotent.
- Given projection chưa có status, then query vẫn trả asset với status null/default theo contract.

---

### US-P1-07 — BFF asset overview tối giản

**As a** FE Network Map miniapp,  
**I want** một API overview tổng hợp cho asset được chọn,  
**So that** UI có thể xem thông tin liên thông mà không gọi nhiều service trực tiếp.

**Acceptance Criteria:**

- Given `assetId`, when gọi `/bff/water-network/assets/{assetId}/overview`, then trả identity, geometry summary và lifecycle summary nếu có.
- Given asset không tồn tại, then trả 404 chuẩn.
- Given GIS có asset nhưng asset service chưa sync xong, then response vẫn trả geometry và lifecycle null.
- Given user không có quyền read, then trả 403.
- Given response, then không expose internal DB schema hoặc EF entity.

---

## 8.4 Phase Acceptance Criteria

Phase 1 hoàn thành khi:

1. `water-network-gis-be` có Node/Pipe/Device aggregate cơ bản.
2. CRUD create/read và soft delete cơ bản hoạt động.
3. PostGIS migration có geometry columns và GiST indexes.
4. Spatial bbox query chạy bằng PostGIS/Dapper hoặc read DAO hiệu quả.
5. Domain events và integration events publish qua Outbox.
6. `water-network-asset-be` consume GIS registered events và tạo asset profile tối giản.
7. Asset status projection trong GIS hoạt động.
8. BFF overview tối giản hoạt động.
9. Unit tests cho value objects/business rules.
10. Integration tests với Testcontainers PostGIS.
11. Contract tests cho integration events chính.
12. Không có cross-service DB access.

## 8.5 Out of Scope

- Chưa cần full import workflow.
- Chưa cần topology Rust hoàn chỉnh.
- Chưa cần incident/maintenance/hydraulic.
- Chưa cần vector tile/server-side clustering.

---

# 9. Phase 2 — Design + Import Workflow

## 9.1 Mục tiêu

Xây dựng workflow thiết kế và import có kiểm soát: upload tài liệu/dữ liệu, tạo draft assets, validate, review, approve và publish sang GIS bằng event/command boundary rõ ràng.

## 9.2 Services liên quan

- `water-network-design-be`
- `water-network-gis-be`
- `file-storage-be`
- `master-data-be` nếu cần danh mục

## 9.3 User Stories

### US-P2-01 — Tạo design project

**As a** design engineer,  
**I want** tạo dự án thiết kế mạng lưới,  
**So that** tôi có nơi quản lý bản vẽ, revision và draft assets.

**Acceptance Criteria:**

- Given request có tên dự án, tenant, branch/zone, when create project, then `DesignProject` được tạo.
- Given thiếu tên dự án, then trả validation error.
- Given project created, then publish `design.project.created`.
- Given query project detail, then trả metadata và status ban đầu.

---

### US-P2-02 — Upload design document

**As a** design engineer,  
**I want** upload tài liệu thiết kế như PDF/DWG/CAD/GeoJSON,  
**So that** hệ thống lưu file và liên kết với design project.

**Acceptance Criteria:**

- Given file hợp lệ, when upload, then file được lưu qua `file-storage-be` hoặc storage adapter.
- Given file vượt size/type policy, then trả lỗi validation.
- Given upload thành công, then `DesignDocument` được tạo với file reference.
- Given document created, then publish `design.document.uploaded`.
- Given storage lỗi, then design metadata không được commit nửa chừng.

---

### US-P2-03 — Tạo draft network asset

**As a** design engineer,  
**I want** tạo draft node/pipe/device từ dữ liệu thiết kế,  
**So that** dữ liệu có thể được review trước khi publish sang GIS.

**Acceptance Criteria:**

- Given draft asset có geometry hợp lệ, when create draft, then lưu trong design service.
- Given draft pipe tham chiếu draft nodes chưa tồn tại, then trả validation error hoặc warning theo mode.
- Given draft asset tạo thành công, then status là `Draft`.
- Given query preview, then trả danh sách draft assets theo project/revision.

---

### US-P2-04 — Validate import/draft dataset

**As a** reviewer,  
**I want** validate dữ liệu import/draft trước khi approve,  
**So that** lỗi topology/geometry/field mapping được phát hiện sớm.

**Acceptance Criteria:**

- Given dataset có duplicate asset code, then validation trả error.
- Given pipe tham chiếu node thiếu, then validation trả error.
- Given geometry invalid, then validation trả error.
- Given optional attributes thiếu, then validation trả warning nếu không bắt buộc.
- Given validation success, then revision có thể submit for approval.
- Given validation result, then có machine-readable errors/warnings.

---

### US-P2-05 — Approve design revision

**As an** authorized approver,  
**I want** approve một revision thiết kế,  
**So that** draft assets đủ điều kiện publish sang GIS.

**Acceptance Criteria:**

- Given revision đã validate thành công, when approver approve, then status chuyển `Approved`.
- Given user thiếu quyền `network-design:approve`, then trả 403.
- Given revision chưa validate hoặc có blocking errors, then không cho approve.
- Given approve thành công, then publish `design.revision.approved`.
- Given approve action, then audit log có actor, timestamp, correlation id.

---

### US-P2-06 — Publish approved draft assets sang GIS

**As a** design engineer,  
**I want** publish approved draft assets sang GIS,  
**So that** dữ liệu thiết kế trở thành dữ liệu mạng lưới chính thức.

**Acceptance Criteria:**

- Given revision approved, when publish, then design service publish `design.asset.ready-for-gis` hoặc gọi GIS command qua adapter được chốt.
- Given GIS nhận draft node, then tạo `NetworkNode` hoặc map theo command `RegisterNodeFromDraft`.
- Given GIS nhận draft pipe, then tạo `NetworkPipe` nếu dependencies hợp lệ.
- Given publish một phần lỗi, then result phải thể hiện imported/failed/errors.
- Given publish thành công, then design revision status chuyển `Published`.
- Given duplicate event, then không tạo asset duplicate.

---

## 9.4 Phase Acceptance Criteria

Phase 2 hoàn thành khi:

1. Design project/document/revision/draft asset được quản lý riêng trong design service.
2. File upload không nằm trong GIS service.
3. Validate/approve/publish workflow có status rõ ràng.
4. GIS không xử lý PDF/DWG/CAD trực tiếp.
5. Publish sang GIS đi qua event/command boundary rõ ràng.
6. Audit trail cho approve/publish có đủ actor/timestamp.
7. Integration tests cho publish flow pass.
8. Không có shared DB giữa design và GIS.

## 9.5 Out of Scope

- Không cần OCR/CAD parsing tự động hoàn chỉnh ở phase này.
- Không cần branch/merge design nâng cao.
- Không cần full topology validation nặng nếu Rust topology chưa hoàn thiện.

---

# 10. Phase 3 — Topology + Incident

## 10.1 Mục tiêu

Thêm năng lực graph/topology computation bằng Rust service và xây dựng incident workflow cơ bản: report incident, gắn asset, request isolation analysis, confirm isolation plan.

## 10.2 Services liên quan

- `water-network-topology-rs`
- `water-network-incident-be`
- `water-network-gis-be`
- `water-network-observation-be` nếu đã có alert source mock/tối giản

## 10.3 User Stories

### US-P3-01 — Build topology graph từ GIS events

**As a** topology engine,  
**I want** nhận network events để build graph in-memory,  
**So that** các analysis chạy nhanh mà không query GIS liên tục.

**Acceptance Criteria:**

- Given `network.node.registered`, topology graph thêm node tương ứng.
- Given `network.pipe.registered`, topology graph thêm edge nếu endpoints tồn tại.
- Given `network.device.installed` với valve, topology graph lưu valve metadata.
- Given `network.pipe.rerouted`, graph update edge geometry/connectivity.
- Given event duplicate, graph state không bị duplicate.
- Given service restart, graph có thể warm-up từ snapshot/API/event replay theo strategy được chọn.

---

### US-P3-02 — Validate network topology

**As a** network engineer,  
**I want** validate topology để phát hiện node mồ côi, pipe đứt kết nối, geometry bất thường,  
**So that** dữ liệu mạng lưới đủ tin cậy.

**Acceptance Criteria:**

- Given graph có orphan node, when validate, then result có issue type `OrphanNode`.
- Given pipe tham chiếu endpoint thiếu, then result có issue type `MissingEndpoint`.
- Given disconnected subgraph, then result mô tả component hoặc affected assets.
- Given validation completed, then publish `topology.validation.completed` nếu cần.
- Given GIS/BFF request validation result, then response không expose internal graph implementation.

---

### US-P3-03 — Report incident

**As an** operator,  
**I want** báo sự cố vỡ ống/giảm áp/mất nước,  
**So that** hệ thống theo dõi và xử lý sự cố có quy trình.

**Acceptance Criteria:**

- Given incident request có category, location/asset reference và severity, when submit, then tạo `NetworkIncident`.
- Given thiếu category hoặc severity, then validation error.
- Given incident created, then status là `Reported` hoặc `Open` theo workflow chốt.
- Given incident created, then publish `incident.reported`.
- Given linked asset không tồn tại theo GIS/BFF validation strategy, then trả lỗi hoặc warning theo rule được chốt.

---

### US-P3-04 — Request isolation analysis

**As an** operator,  
**I want** yêu cầu phân tích vùng cô lập cho sự cố,  
**So that** hệ thống đề xuất van cần đóng và assets bị ảnh hưởng.

**Acceptance Criteria:**

- Given incident có linked pipe/node/device hợp lệ, when request isolation, then incident service gọi topology service qua gRPC/adapter.
- Given topology trả affected nodes/pipes/valves, then incident service lưu `IsolationPlan`.
- Given topology service timeout, then incident lưu trạng thái analysis failed/retryable.
- Given isolation plan created, then publish `incident.isolation-plan-created` hoặc event tương đương.
- Given operator query incident detail, then thấy isolation result.

---

### US-P3-05 — Confirm isolation plan

**As an** authorized operator,  
**I want** xác nhận phương án cô lập,  
**So that** incident có thể chuyển sang xử lý thực địa hoặc tạo work order.

**Acceptance Criteria:**

- Given isolation plan exists, when confirm, then incident status cập nhật theo workflow.
- Given user thiếu quyền, then trả 403.
- Given confirm thành công, then publish `incident.isolation-plan-confirmed`.
- Given confirm thành công và cần sửa chữa, then publish `maintenance.work-order-requested`.
- Given confirm action, then audit log có actor/timestamp.

---

## 10.4 Phase Acceptance Criteria

Phase 3 hoàn thành khi:

1. Rust topology service có graph model tối thiểu.
2. GIS events update topology graph idempotent.
3. Validate topology trả issues machine-readable.
4. Incident service quản lý incident lifecycle cơ bản.
5. Incident có thể gọi topology để compute isolation zone.
6. Isolation plan được lưu trong incident service, không trong topology service.
7. Có contract/integration tests cho gRPC topology.
8. Có failure handling cho topology timeout/error.

## 10.5 Out of Scope

- Chưa cần customer impact chính thức.
- Chưa cần maintenance workflow đầy đủ.
- Chưa cần hydraulic simulation.

---

# 11. Phase 4 — Maintenance

## 11.1 Mục tiêu

Xây dựng service quản lý work order, phân công, lịch sửa chữa/bảo trì, ghi nhận kết quả và vật tư.

## 11.2 Services liên quan

- `water-network-maintenance-be`
- `water-network-incident-be`
- `water-network-asset-be`
- `notification-be` tối giản

## 11.3 User Stories

### US-P4-01 — Tạo work order từ incident

**As an** incident operator,  
**I want** tạo work order từ sự cố đã xác nhận,  
**So that** đội hiện trường có nhiệm vụ xử lý rõ ràng.

**Acceptance Criteria:**

- Given event `maintenance.work-order-requested`, maintenance service tạo work order tương ứng.
- Given event duplicate, then không tạo work order duplicate.
- Given work order created, then publish `work-order.created`.
- Given incident id/asset id trong event, then work order lưu reference nhưng không đọc DB incident trực tiếp.

---

### US-P4-02 — Phân công kỹ thuật viên

**As a** maintenance coordinator,  
**I want** phân công kỹ thuật viên/đội thi công cho work order,  
**So that** công việc có người chịu trách nhiệm.

**Acceptance Criteria:**

- Given work order ở trạng thái assignable, when assign technician/team, then status hoặc assignment được cập nhật.
- Given technician/team không hợp lệ theo adapter/danh mục, then trả validation error.
- Given assign thành công, then publish `work-order.assigned`.
- Given notification service consume event, then có thể tạo notification assignment.

---

### US-P4-03 — Bắt đầu và hoàn thành work order

**As a** field technician,  
**I want** start và complete work order,  
**So that** hệ thống ghi nhận tiến độ sửa chữa/bảo trì.

**Acceptance Criteria:**

- Given work order assigned, when start, then status chuyển `InProgress`.
- Given work order chưa assigned nhưng workflow không cho phép start, then trả business error.
- Given complete request có result summary, then status chuyển `Completed`.
- Given complete thành công, then publish `work-order.completed`.
- Given work order completed, then asset service có thể consume để update status nếu rule yêu cầu.

---

### US-P4-04 — Ghi nhận repair result và material usage

**As a** field technician,  
**I want** ghi nhận kết quả sửa chữa và vật tư sử dụng,  
**So that** có hồ sơ công việc đầy đủ.

**Acceptance Criteria:**

- Given work order in progress, when record repair result, then repair record được lưu.
- Given material usage có item/quantity/unit hợp lệ, then lưu thành công.
- Given quantity <= 0, then validation error.
- Given record thành công, then publish `repair.recorded` và/hoặc `material.used`.

---

## 11.4 Phase Acceptance Criteria

Phase 4 hoàn thành khi:

1. Maintenance service quản lý work order lifecycle cơ bản.
2. Work order có thể tạo từ incident event.
3. Assignment/start/complete hoạt động có business rules.
4. Repair record/material usage được lưu.
5. Events publish đúng.
6. Incident/asset không bị truy cập DB trực tiếp.
7. Notification hook tối giản hoạt động hoặc có contract rõ.

## 11.5 Out of Scope

- Không cần mobile field app đầy đủ.
- Không cần inventory/warehouse service sâu.
- Không cần scheduling tối ưu tự động.

---

# 12. Phase 5 — Observation/Telemetry

## 12.1 Mục tiêu

Xây dựng ingestion và query telemetry: pressure, flow, valve state, pump state, latest reading, history, threshold và abnormal detection cơ bản.

## 12.2 Services liên quan

- `water-network-observation-be`
- `water-network-gis-be`
- `water-network-incident-be`
- Time-series database

## 12.3 User Stories

### US-P5-01 — Register telemetry device mapping

**As an** integration engineer,  
**I want** map telemetry device vào network asset,  
**So that** dữ liệu đo được liên kết với tài sản trên bản đồ.

**Acceptance Criteria:**

- Given telemetry device id và asset id hợp lệ, when register mapping, then mapping được lưu.
- Given asset đã decommissioned theo projection/adapter, then mapping bị từ chối hoặc warning theo policy.
- Given duplicate mapping, then trả conflict hoặc update theo mode chốt.
- Given mapping created, then query latest reading by asset có thể dùng mapping.

---

### US-P5-02 — Ingest pressure/flow reading

**As a** telemetry gateway,  
**I want** gửi pressure/flow readings vào observation service,  
**So that** hệ thống lưu dữ liệu vận hành.

**Acceptance Criteria:**

- Given reading có device id, timestamp, value, unit, when ingest, then lưu vào time-series store.
- Given timestamp quá cũ/quá tương lai theo policy, then validation warning/error.
- Given unit không hỗ trợ, then validation error.
- Given duplicate reading id, then idempotent ingest.
- Given ingest thành công, then publish `pressure.reading.received` hoặc `flow.reading.received`.

---

### US-P5-03 — Latest telemetry summary

**As a** map viewer/BFF,  
**I want** lấy latest telemetry summary theo asset,  
**So that** FE hiển thị trạng thái vận hành mới nhất.

**Acceptance Criteria:**

- Given asset có mapped telemetry device, when query latest, then trả latest pressure/flow/valve state nếu có.
- Given không có reading, then trả empty/null summary theo contract.
- Given query nhiều assets, then có batch endpoint hoặc query tối ưu để tránh N+1.
- Given user thiếu quyền observation read, then trả 403.

---

### US-P5-04 — Abnormal detection

**As an** operations system,  
**I want** phát hiện áp lực/lưu lượng bất thường theo threshold,  
**So that** có thể tạo cảnh báo hoặc đề xuất incident.

**Acceptance Criteria:**

- Given threshold profile cho zone/device, when reading vượt ngưỡng, then tạo observation alert.
- Given alert created, then publish `pressure.abnormal-detected` hoặc `flow.abnormal-detected`.
- Given reading trở lại bình thường, then alert có thể auto-resolve hoặc giữ open theo policy chốt.
- Given duplicate abnormal readings trong debounce window, then không spam events quá mức.

---

## 12.4 Phase Acceptance Criteria

Phase 5 hoàn thành khi:

1. Telemetry device mapping hoạt động.
2. Pressure/flow/valve readings ingest idempotent.
3. Latest summary query hoạt động.
4. History query cơ bản hoạt động.
5. Threshold/abnormal detection cơ bản hoạt động.
6. Observation events có thể kích hoạt incident workflow.
7. Time-series store có migration/config/testcontainers hoặc strategy rõ.

## 12.5 Out of Scope

- Không cần SCADA integration đầy đủ.
- Không cần stream processing phức tạp.
- Không cần ML anomaly detection.

---

# 13. Phase 6 — Hydraulic Modeling

## 13.1 Mục tiêu

Xây dựng hydraulic service để quản lý mô hình thủy lực, scenario, EPANET export/import và simulation result.

## 13.2 Services liên quan

- `water-network-hydraulic-be`
- `water-network-gis-be`
- `water-network-topology-rs`
- `water-network-observation-be`
- `file-storage-be`

## 13.3 User Stories

### US-P6-01 — Create hydraulic model from network snapshot

**As a** hydraulic engineer,  
**I want** tạo hydraulic model từ network snapshot,  
**So that** tôi có baseline model cho mô phỏng.

**Acceptance Criteria:**

- Given selected network scope, when create model, then hydraulic service lưu model metadata.
- Given GIS/topology payload không đủ dữ liệu, then model status là `Incomplete` kèm validation issues.
- Given model created, then publish `hydraulic.model.created`.
- Given model detail query, then trả nodes/pipes/devices summary cần thiết.

---

### US-P6-02 — Configure simulation scenario

**As a** hydraulic engineer,  
**I want** tạo scenario với demand pattern và boundary conditions,  
**So that** có thể chạy mô phỏng theo kịch bản.

**Acceptance Criteria:**

- Given model exists, when create scenario, then scenario được lưu.
- Given demand pattern invalid, then validation error.
- Given boundary condition thiếu, then scenario status là incomplete hoặc validation error theo policy.
- Given scenario created, then publish `hydraulic.scenario.created`.

---

### US-P6-03 — Export EPANET INP

**As a** hydraulic engineer,  
**I want** export mô hình sang EPANET INP,  
**So that** có thể dùng công cụ thủy lực bên ngoài.

**Acceptance Criteria:**

- Given model/scenario valid, when export INP, then file được sinh và lưu vào file storage.
- Given export thành công, then tạo `EpanetExportJob` với status completed.
- Given export lỗi, then job status failed với error message.
- Given export completed, then publish `hydraulic.epanet.exported`.

---

### US-P6-04 — Store simulation result

**As a** hydraulic engineer,  
**I want** import/lưu simulation result,  
**So that** FE có thể hiển thị áp lực/lưu lượng mô phỏng trên bản đồ.

**Acceptance Criteria:**

- Given result file hoặc result payload hợp lệ, when import, then lưu simulation result.
- Given result tham chiếu asset không tồn tại trong model, then validation issue.
- Given import thành công, then publish `hydraulic.simulation.completed` hoặc `result.imported` theo event catalog.
- Given query result by asset, then trả pressure/flow simulated values nếu có.

---

## 13.4 Phase Acceptance Criteria

Phase 6 hoàn thành khi:

1. Hydraulic model/scenario lifecycle cơ bản hoạt động.
2. EPANET export tạo file qua file-storage.
3. Simulation result lưu và query được.
4. Hydraulic service không sở hữu geometry gốc.
5. Có validation issues cho model incomplete.
6. Có integration contract với GIS/topology rõ.

## 13.5 Out of Scope

- Không cần tự chạy solver thủy lực nâng cao nếu chưa chốt engine.
- Không cần calibration tự động.
- Không cần optimization nâng cao.

---

# 14. Phase 7 — Customer Impact + Reporting

## 14.1 Mục tiêu

Bổ sung phân tích ảnh hưởng khách hàng/kết nối dịch vụ và reporting tổng hợp cho incident, maintenance, asset, telemetry, hydraulic.

## 14.2 Services liên quan

- `water-network-customer-impact-be`
- `reporting-be`
- `notification-be`
- `water-network-incident-be`
- `water-network-maintenance-be`
- Customer/CRM projection nếu có

## 14.3 User Stories

### US-P7-01 — Compute customer impact from isolation plan

**As an** operations manager,  
**I want** tính khách hàng/kết nối dịch vụ bị ảnh hưởng từ isolation plan,  
**So that** có thể đánh giá mức độ sự cố và thông báo phù hợp.

**Acceptance Criteria:**

- Given `incident.isolation-plan-confirmed`, when customer impact service consume event, then tạo impact analysis.
- Given affected assets/zones, then service xác định affected service connections từ projection/adapter.
- Given critical customers affected, then result đánh dấu critical impact.
- Given computation completed, then publish `customer-impact.computed`.
- Given thiếu customer projection, then analysis status là partial/incomplete với warnings.

---

### US-P7-02 — Confirm impact snapshot

**As an** operator,  
**I want** xác nhận snapshot khách hàng bị ảnh hưởng,  
**So that** notification/reporting dùng dữ liệu ổn định tại thời điểm sự cố.

**Acceptance Criteria:**

- Given impact analysis computed, when confirm, then status chuyển `Confirmed`.
- Given user thiếu quyền, then trả 403.
- Given confirm thành công, then publish `customer-impact.confirmed`.
- Given cần thông báo, then publish `customer-impact.notification-required`.

---

### US-P7-03 — Generate operational report

**As a** manager,  
**I want** tạo báo cáo tổng hợp tài sản/sự cố/bảo trì,  
**So that** có thể theo dõi hiệu quả vận hành.

**Acceptance Criteria:**

- Given report type và date range hợp lệ, when request report, then tạo report job.
- Given report completed, then file PDF/Excel được lưu trong file storage.
- Given report query, then trả trạng thái job và download link.
- Given report source thiếu dữ liệu, then report có warning section.
- Given user thiếu quyền report, then trả 403.

---

## 14.4 Phase Acceptance Criteria

Phase 7 hoàn thành khi:

1. Customer impact service tính được affected service connections/customers từ isolation plan.
2. Impact snapshot có trạng thái computed/confirmed.
3. Notification event được phát khi cần.
4. Reporting service tạo được ít nhất asset/incident/maintenance report.
5. Reports được lưu qua file-storage.
6. Không duplicate dữ liệu khách hàng gốc nếu CRM/customer service riêng tồn tại.

## 14.5 Out of Scope

- Không cần customer CRM đầy đủ nếu chưa có.
- Không cần notification channel production đầy đủ ở tất cả kênh.
- Không cần BI warehouse hoàn chỉnh.

---

# 15. Cross-cutting User Stories

## US-X-01 — Permission enforcement

**As a** security architect,  
**I want** service enforce permission theo command/query,  
**So that** user không thể thực hiện nghiệp vụ ngoài quyền.

**Acceptance Criteria:**

- Given user thiếu permission required, then endpoint trả 403.
- Given user có permission nhưng sai tenant/branch scope, then endpoint trả 403.
- Given service-to-service call, then system identity được xác thực/ủy quyền theo policy.
- Given command handler, then actor id được lưu trong audit fields.

---

## US-X-02 — API error contract

**As a** frontend developer,  
**I want** lỗi API có contract thống nhất,  
**So that** FE xử lý validation/business/system errors ổn định.

**Acceptance Criteria:**

- Given validation error, then response có field-level errors.
- Given business rule violation, then response có code machine-readable.
- Given conflict, then trả 409.
- Given not found, then trả 404.
- Given unhandled exception, then trả 500 sanitized, không leak stacktrace.
- Given correlation id, then response header/body có reference để debug.

---

## US-X-03 — Contract testing for events

**As a** platform maintainer,  
**I want** event contracts được version hóa và test,  
**So that** service producer/consumer không phá nhau khi thay đổi schema.

**Acceptance Criteria:**

- Given integration event contract mới, then có version field.
- Given producer test, then event payload match schema.
- Given consumer test, then consumer xử lý được current version.
- Given breaking change, then phải tạo version mới hoặc migration strategy.
- Given unknown event version, then consumer log warning/error theo policy, không crash toàn service.

---

# 16. Event catalog v1 đề xuất

```text
network.node.registered
network.node.relocated
network.node.removed
network.pipe.registered
network.pipe.rerouted
network.pipe.removed
network.device.installed
network.device.relocated
network.device.removed
network.geometry.changed
network.gis-import.completed

asset.registered
asset.activated
asset.status.changed
asset.maintenance-marked
asset.decommissioned
asset.ownership.transferred
asset.technical-profile.updated

design.project.created
design.document.uploaded
design.revision.submitted
design.revision.approved
design.revision.rejected
design.asset.ready-for-gis
network.asset.drafted

zone.created
zone.boundary.updated
zone.asset.assigned
zone.asset.removed
zone.deactivated

topology.graph.updated
topology.validation.completed
topology.isolation.computed

incident.reported
incident.classified
incident.isolation-requested
incident.isolation-plan-confirmed
incident.handling-started
incident.resolved
incident.cancelled
maintenance.work-order-requested

work-order.created
work-order.assigned
work-order.scheduled
work-order.started
work-order.completed
work-order.cancelled
repair.recorded
material.used

pressure.reading.received
flow.reading.received
valve.state.changed
pump.state.changed
pressure.abnormal-detected
flow.abnormal-detected
sensor.offline-detected
observation.alert.acknowledged

hydraulic.model.created
hydraulic.scenario.created
hydraulic.simulation.started
hydraulic.simulation.completed
hydraulic.simulation.failed
hydraulic.epanet.exported

customer-impact.computed
customer-impact.confirmed
customer-impact.notification-required
```

Event envelope chuẩn:

```json
{
  "eventId": "uuid",
  "eventType": "network.pipe.registered",
  "eventVersion": 1,
  "occurredAt": "2026-06-11T00:00:00Z",
  "tenantId": "tenant-001",
  "organizationId": "org-001",
  "branchId": "branch-001",
  "correlationId": "corr-001",
  "causationId": "cmd-001",
  "producer": "water-network-gis-be",
  "payload": {}
}
```

---

# 17. Definition of Done chung

Một story backend được coi là Done khi:

1. Domain model/rule được implement đúng layer.
2. Command/query handler có validation.
3. API endpoint hoặc consumer được expose nếu story yêu cầu.
4. Persistence migration được tạo nếu có thay đổi DB.
5. Domain event/integration event được publish nếu story yêu cầu.
6. Outbox/inbox/idempotency được áp dụng cho event integration.
7. Unit tests pass.
8. Integration tests pass nếu có DB/broker/external adapter.
9. Contract tests pass nếu có API/event/gRPC contract.
10. Observability/logging/correlation không bị bỏ qua.
11. Authorization/tenant context được kiểm tra.
12. Không vi phạm cross-service DB access.
13. README hoặc docs được cập nhật nếu public behavior thay đổi.

---

# 18. Agent implementation protocol

Khi agent nhận SPEC này, agent phải trả về plan trước khi code.

Plan phải có:

1. Repository architecture summary.
2. Template convention phát hiện được.
3. Mapping SPEC services vào project structure hiện tại.
4. Các service/module cần tạo trước.
5. Phase implementation order.
6. Story breakdown cho phase đầu tiên.
7. Files/folders dự kiến thay đổi.
8. Database migrations dự kiến.
9. Event contracts dự kiến.
10. Tests dự kiến.
11. Risks và assumptions.

Agent không được:

- Implement toàn bộ platform trong một lần.
- Tạo service rỗng hàng loạt không có slice nghiệp vụ.
- Copy/paste code trùng lặp giữa services.
- Tạo shared domain model giữa services.
- Đưa lifecycle vào GIS service.
- Đưa incident/maintenance/hydraulic vào GIS service.
- Bỏ qua tests.
- Bỏ qua tenant/correlation context.

---

# 19. Recommended first implementation slice

Slice đầu tiên nên làm:

```text
Phase 1 / US-P1-01 — Register NetworkNode
```

Scope cụ thể:

- `NetworkNode` aggregate.
- `NodeId`, `AssetCode`, `GeoPoint`, `NodeType`.
- `RegisterNodeCommand`.
- `RegisterNodeCommandValidator`.
- `RegisterNodeCommandHandler`.
- `INetworkNodeRepository`.
- EF/PostGIS persistence.
- Migration `network_nodes`.
- Domain event `NodeRegistered`.
- Integration event `network.node.registered`.
- Outbox mapping.
- API endpoint `POST /api/network/nodes`.
- Query `GET /api/network/nodes/{id}`.
- Unit tests for value objects and business rules.
- Integration test with PostGIS Testcontainers.

Acceptance for first slice:

1. Register valid node returns 201/OK with node id.
2. Duplicate asset code returns conflict.
3. Invalid location returns validation error.
4. Node persisted with geometry SRID 4326.
5. Domain event generated.
6. Outbox message created.
7. Get node detail returns created node.
8. Tests pass.

---

# 20. Open decisions cần con người chốt

Agent có thể đề xuất nhưng không tự quyết nếu ảnh hưởng lớn:

1. Message broker chính: RabbitMQ hay Kafka.
2. EventBus library: MassTransit hay custom abstraction.
3. Full event sourcing hay domain events + outbox cho từng service.
4. Database schema per service hay database instance per service.
5. Geometry CRS: chỉ EPSG:4326 hay hỗ trợ VN-2000 import conversion ngay phase 1.
6. Zone service tách riêng từ đầu hay module trong GIS ở MVP.
7. Hydraulic engine: chỉ EPANET export hay chạy solver backend.
8. Time-series store: TimescaleDB hay InfluxDB.
9. Naming convention chính xác theo repo template.
10. API style: Controllers, Minimal APIs, Carter, FastEndpoints hoặc convention hiện có.

---

# 21. Final target outcome

Khi triển khai đầy đủ theo SPEC này, Water Network Backend Platform sẽ có:

- Microservices tách biệt theo bounded context.
- DDD/CQRS/event-driven rõ ràng.
- Database-per-service.
- Reliable messaging với Outbox/Inbox.
- Multi-tenancy context thống nhất.
- GIS service không bị biến thành God Service.
- FE có thể xem dữ liệu liên thông qua BFF/read composition.
- Mỗi nghiệp vụ write có service owner rõ ràng.
- Có roadmap phát triển từng phase và acceptance criteria kiểm thử được.

